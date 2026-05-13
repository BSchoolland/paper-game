/**
 * Overlord — the configurable variant of agent-03's hero brain.
 *
 * Same architecture as agent-03 (whole-turn beam search → adversarial-rollout judging on the
 * surviving finalists, with king-safety + reachable-damage + immediate-damage eval), but the
 * **search-effort knobs are exposed** as an `OverlordConfig` and fed in by `makeOverlord(cfg)`.
 * The *evaluation* — what the bot wants — stays fixed; only how hard it thinks is dialled. So
 * presets feel like the same player at different skill levels, not different personalities.
 *
 * Intended use: pick a preset for an NPC by intent ("a smart-but-not-tournament miniboss"), not
 * by guessing weights. Cheap presets are still strictly stronger than the scripted strategies
 * (whole-turn lookahead with a real eval beats greedy one-action heuristics) but won't out-think
 * a player the way the tournament tier does.
 *
 *   import { makeOverlord, PRESETS } from "./overlord.js";
 *   export const hero = makeOverlord(PRESETS.skilled);
 */
import type { HeroController } from "../../src/types.js";
import type {
  AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction, TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { add, sub, scale, normalize, length } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, basicScore, effectiveHp,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "../../src/toolkit.js";

// ===========================================================================
// Configuration — the "how hard does this hero think" knobs
// ===========================================================================

export interface OverlordConfig {
  /** Self-imposed wall-clock cap per turn (ms). Capped further by the harness deadline. */
  softBudgetMs: number;
  /** Hero abilities considered per turn — the depth of the beam. Engine energy bounds it tighter. */
  maxSteps: number;
  /** Partial-turn plans kept between beam-expansion rounds (the search width). */
  beamWidth: number;
  /** Full-turn candidates that get the (expensive) adversarial rollout — the depth of phase 2. */
  finalists: number;
  /** Move headings fanned around the hero — broader = more candidate positions to consider. */
  headingSamples: number;
  /** How many adversarial-reply lines to mix in (1..3). Higher = considers smarter opponent turns. */
  replyLevels: 1 | 2 | 3;
}

/**
 * Skill ladder. The eval (Overlord's *intent*) is unchanged across presets — only the search
 * width / depth / time / opponent-model depth. Any preset is strictly better than the scripted
 * strategies; the tournament preset matches `agent-03` exactly.
 *
 * Rough costs (a typical turn on a desktop CPU): novice ~30–80 ms, skilled ~150–400 ms,
 * expert ~600–1500 ms, tournament ~2.5–3.5 s.
 */
export const PRESETS = {
  /** Cheap: shallow beam, no rollout deepening. Still notably better than the scripted AI —
   *  it does whole-turn lookahead and king-safety — but won't out-think a careful player. */
  novice:     { softBudgetMs: 250,  maxSteps: 3, beamWidth: 3,  finalists: 5,  headingSamples: 4,  replyLevels: 1 },
  /** Mid-tier: a real beam, one rollout level. Punishes obvious blunders, plays a clean fight. */
  skilled:    { softBudgetMs: 600,  maxSteps: 4, beamWidth: 6,  finalists: 12, headingSamples: 6,  replyLevels: 1 },
  /** Strong: wide beam, two-level adversarial rollout. Handles knockback combos and trades. */
  expert:     { softBudgetMs: 1500, maxSteps: 5, beamWidth: 9,  finalists: 18, headingSamples: 8,  replyLevels: 2 },
  /** Tournament-tier — identical search to agent-03. Burns most of the 5-s turn budget. */
  tournament: { softBudgetMs: 3500, maxSteps: 6, beamWidth: 12, finalists: 28, headingSamples: 10, replyLevels: 3 },
} as const satisfies Record<string, OverlordConfig>;

export type IntelligenceLevel = keyof typeof PRESETS;

// --- engine constants (NOT intelligence — these define Overlord's identity) -------------------
const SAFETY_MS = 450;        // pull back from the harness deadline (machine-jitter buffer)
const AOE_RADIUS = 90;        // greatsword-sweep reach — yardstick for "are the enemies clustered"
const KITE_RING = 0.85;       // when repositioning to fire, aim for this fraction of our reach

// --- evaluation weights (also identity — same across presets) ---------------------------------
const W_HERO_HP = 1.0;
const W_HERO_DEAD = 2.6;
const W_HERO_THREAT = 0.75;
const W_HERO_OFFENSE = 0.4;
const W_ENEMY_HERO_DEAD = 1.8;
const W_ENEMY_HERO_SUPPRESS = 0.85;
const W_CLUSTER = 0.25;
const W_ALLY_HP = 0.16;
const W_DRIFT = 1.0;
const W_IN_RANGE = 0.12;
const W_IMM_DMG = 0.7;
const W_IMM_KILL = 0.7;

// ===========================================================================
// Factory
// ===========================================================================

export function makeOverlord(cfg: OverlordConfig): HeroController {
  return (ctx) => {
    const myTeam = teamOf(ctx.state, ctx.heroId);
    const me = ctx.state.entities.get(ctx.heroId);
    if (!me || me.dead) return [];
    if (livingEnemies(ctx.state, ctx.heroId).length === 0) return [];

    const start = Date.now();
    const deadline = Math.min(ctx.deadlineMs - SAFETY_MS, start + cfg.softBudgetMs);
    const timeUp = () => Date.now() >= deadline;
    // Give the beam search a sub-budget so the adversarial rollouts always get a real share.
    const phase1Deadline = Math.min(deadline, start + Math.max(80, (deadline - start) * 0.4));
    const phase1Up = () => Date.now() >= phase1Deadline;

    // --- phase 1: beam search over whole-turn plans, ranked by the cheap static eval ----------
    const finals = beamSearch(ctx.state, ctx.heroId, myTeam, cfg, phase1Up);
    const seen = new Set<string>();
    const pass: PlayerAction[] = [];
    const cand: PlayerAction[][] = [pass];
    for (const f of finals) {
      if (f.plan.length === 0) continue;
      const key = f.plan.map(sig).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      cand.push(f.plan);
      if (cand.length >= cfg.finalists) break;
    }

    // --- phase 2: judge each finalist against the adversarial opponent model ------------------
    // `replyLevel` widens the set of enemy-hero replies we minimise over; bigger = more pessimistic
    // but slower. Iterative-deepen up to `cfg.replyLevels`, keeping the best plan from the
    // deepest level we *finished*.
    const foe0 = foeTotals(ctx.state, myTeam);
    let best = pass;
    for (let replyLevel = 1; replyLevel <= cfg.replyLevels; replyLevel++) {
      if (timeUp()) break;
      let levelBest: PlayerAction[] | null = null;
      let levelBestVal = -Infinity;
      for (const plan of cand) {
        if (timeUp()) break;
        let s: GameState = ctx.state;
        for (const a of plan) s = resolveAction(s, a);
        const foe1 = foeTotals(s, myTeam);
        const immediate = W_IMM_DMG * (foe0.hp - foe1.hp) / Math.max(1, foe0.max) + W_IMM_KILL * (foe0.alive - foe1.alive);
        const v = (s.winner === myTeam ? 1e6 : adversarialValue(s, ctx.heroId, myTeam, replyLevel, cfg, timeUp)) + immediate;
        if (v > levelBestVal) { levelBestVal = v; levelBest = plan; }
      }
      if (levelBest && !timeUp()) best = levelBest;
      else if (levelBest && best === pass) best = levelBest;
    }
    return best;
  };
}

// ===========================================================================
// Phase 1 — beam search
// ===========================================================================

interface Node { state: GameState; plan: PlayerAction[]; }

function beamSearch(root: GameState, heroId: EntityId, myTeam: TeamId, cfg: OverlordConfig, timeUp: () => boolean): Node[] {
  let beam: Node[] = [{ state: root, plan: [] }];
  const finals: Node[] = [{ state: root, plan: [] }];

  for (let step = 0; step < cfg.maxSteps; step++) {
    if (timeUp()) break;
    const next: Node[] = [];
    for (const node of beam) {
      const h = node.state.entities.get(heroId);
      if (!h || h.dead || node.state.winner) { finals.push(node); continue; }
      let expanded = false;
      for (const action of heroCandidates(node.state, h, cfg)) {
        if (timeUp()) break;
        const after = tryAction(node.state, action);
        if (!after) continue;
        expanded = true;
        next.push({ state: after, plan: [...node.plan, action] });
      }
      if (!expanded || step === cfg.maxSteps - 1) finals.push(node);
    }
    if (next.length === 0) break;
    next.sort((a, b) => staticEval(b.state, heroId, myTeam) - staticEval(a.state, heroId, myTeam));
    const seen = new Set<string>();
    beam = [];
    for (const n of next) {
      const k = stateKey(n.state, heroId);
      if (seen.has(k)) continue;
      seen.add(k);
      beam.push(n);
      if (beam.length >= cfg.beamWidth) break;
    }
    for (const n of beam) finals.push(n);
  }
  finals.sort((a, b) => staticEval(b.state, heroId, myTeam) - staticEval(a.state, heroId, myTeam));
  return finals;
}

function stateKey(s: GameState, heroId: EntityId): string {
  const h = s.entities.get(heroId)!;
  let alive = 0, foeHp = 0;
  for (const e of s.entities.values()) { if (!e.dead) { alive++; if (e.teamId !== h.teamId) foeHp += e.hp + e.barrier; } }
  return `${Math.round(h.position.x / 8)},${Math.round(h.position.y / 8)},${h.energy.red},${h.energy.blue},${Math.round((h.hp + h.barrier) / 4)},${alive},${Math.round(foeHp / 6)}`;
}

// ===========================================================================
// Phase 2 — adversarial rollout
// ===========================================================================

function adversarialValue(state: GameState, heroId: EntityId, myTeam: TeamId, replyLevel: number, cfg: OverlordConfig, timeUp: () => boolean): number {
  const afterAllies = simulateMyAlliesTurn(state, heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  if (afterEnd.winner) return staticEval(afterEnd, heroId, myTeam);

  const enemyTeam = afterEnd.activeTeam;
  const enemyHero = [...afterEnd.entities.values()].find(e => !e.dead && e.teamId === enemyTeam && isHeroLike(e)) ?? null;

  const scriptedVal = staticEval(simulateScriptedTurn(afterEnd), heroId, myTeam);
  let worst = scriptedVal;

  if (enemyHero && !timeUp()) {
    worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, bestReplyPlan(afterEnd, enemyHero.id, heroId, myTeam, cfg, timeUp)), heroId, myTeam));
  }
  if (enemyHero && replyLevel >= 2 && !timeUp()) {
    worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, heroId, cfg)), heroId, myTeam));
  }
  if (enemyHero && replyLevel >= 3 && !timeUp()) {
    const myAllies = [...afterEnd.entities.values()].filter(e => !e.dead && e.teamId === myTeam && e.id !== heroId);
    if (myAllies.length > 0) {
      const weak = myAllies.reduce((a, b) => ((a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b));
      worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, weak.id, cfg)), heroId, myTeam));
    }
  }
  return 0.5 * scriptedVal + 0.5 * worst;
}

function enemyTurnWithHeroPlan(afterEnd: GameState, enemyHeroId: EntityId, heroPlan: PlayerAction[]): GameState {
  let s = afterEnd;
  for (const a of heroPlan) s = resolveAction(s, a);
  if (s.winner) return s;
  s = simulateMyAlliesTurn(s, enemyHeroId);
  return resolveAction(s, { type: "endTurn" });
}

function huntPlan(state: GameState, attackerId: EntityId, victimId: EntityId, cfg: OverlordConfig): PlayerAction[] {
  const plan: PlayerAction[] = [];
  let s = state;
  for (let step = 0; step < cfg.maxSteps; step++) {
    const a = s.entities.get(attackerId), v = s.entities.get(victimId);
    if (!a || a.dead || !v || v.dead || s.winner) break;
    let acted = false;
    for (const atk of attackAbilities(a).filter(x => canAffordAbility(a, x)).sort((x, y) => y.damage - x.damage)) {
      const aim = sub(v.position, a.position);
      if (!aim.x && !aim.y) continue;
      if (attackHits(s, a, atk, aim).some(h => h.id === victimId)) {
        const act: PlayerAction = { type: "ability", entityId: attackerId, abilityId: atk.id, aimDirection: aim };
        const after = tryAction(s, act);
        if (after) { plan.push(act); s = after; acted = true; break; }
      }
    }
    if (acted) continue;
    const mv = moveAbility(a);
    if (mv && canAffordAbility(a, mv)) {
      const dest = pathToward(s, attackerId, v.position);
      if (dest) {
        const act: PlayerAction = { type: "ability", entityId: attackerId, abilityId: mv.id, destination: dest };
        const after = tryAction(s, act);
        if (after) { plan.push(act); s = after; continue; }
      }
    }
    break;
  }
  return plan;
}

function bestReplyPlan(state: GameState, attackerId: EntityId, myHeroId: EntityId, myTeam: TeamId, cfg: OverlordConfig, timeUp: () => boolean): PlayerAction[] {
  const plan: PlayerAction[] = [];
  let s = state;
  // The opponent-model depth is bounded by our own search depth — at higher tiers we let it
  // think one more step, so the "smart opponent" stays a credible threat as we get smarter.
  const maxSteps = Math.min(3, cfg.maxSteps);
  for (let step = 0; step < maxSteps; step++) {
    const a = s.entities.get(attackerId);
    if (!a || a.dead || s.winner || timeUp()) break;
    let bestAct: PlayerAction | null = null;
    let bestVal = staticEval(s, myHeroId, myTeam);
    for (const action of heroCandidates(s, a, cfg)) {
      if (timeUp()) break;
      const after = tryAction(s, action);
      if (!after) continue;
      const v = after.winner && after.winner !== myTeam ? -1e6 : staticEval(after, myHeroId, myTeam);
      if (v < bestVal - 1e-9) { bestVal = v; bestAct = action; }
    }
    if (!bestAct) break;
    plan.push(bestAct);
    s = tryAction(s, bestAct)!;
  }
  return plan;
}

// ===========================================================================
// Candidate generation
// ===========================================================================

function heroCandidates(state: GameState, hero: Entity, cfg: OverlordConfig): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const allies = livingAllies(state, hero.id);
  const out: PlayerAction[] = [];

  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const enemyHero = enemies.find(isHeroLike) ?? null;
  const allyCentroid = allies.length > 0 ? centroid(allies) : hero.position;

  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a)) out.push({ type: "ability", entityId: hero.id, abilityId: a.id });
  }

  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  const aimTargets: Vec2[] = [...enemies.map(e => e.position), cluster];
  if (enemyHero) aimTargets.push(enemyHero.position);
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      if (dist(enemies[i]!.position, enemies[j]!.position) <= 170) {
        aimTargets.push({ x: (enemies[i]!.position.x + enemies[j]!.position.x) / 2, y: (enemies[i]!.position.y + enemies[j]!.position.y) / 2 });
      }
    }
  }
  for (const atk of atks) {
    const seenAim = new Set<string>();
    for (const tp of aimTargets) {
      const aim = sub(tp, hero.position);
      if (!aim.x && !aim.y) continue;
      const k = `${atk.id}:${Math.round(Math.atan2(aim.y, aim.x) * 24)}`;
      if (seenAim.has(k)) continue;
      seenAim.add(k);
      if (attackHits(state, hero, atk, aim).length > 0) out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
    }
  }

  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const myReach = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0)
      || attackAbilities(hero).reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const away = normalize(sub(hero.position, near.position));
    const targets: Vec2[] = [];
    for (const e of enemies) targets.push(e.position);
    targets.push(cluster);
    if (enemyHero) {
      targets.push(enemyHero.position);
      const perp = { x: -away.y, y: away.x };
      targets.push(add(enemyHero.position, scale(perp, 55)));
      targets.push(add(enemyHero.position, scale(perp, -55)));
    }
    targets.push(allyCentroid);
    const block = bodyblockSpot(hero, allies, enemies);
    if (block) targets.push(block);
    if (length(away) > 0) {
      if (myReach > 1) for (const f of [0.7, 0.95, 1.2]) targets.push(add(near.position, scale(away, Math.max(40, myReach * f * KITE_RING / 0.85))));
      targets.push(add(hero.position, scale(away, mv.distance)));
    }
    for (let k = 0; k < cfg.headingSamples; k++) {
      const ang = (k / cfg.headingSamples) * Math.PI * 2;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      targets.push(add(hero.position, scale(dir, mv.distance)));
      targets.push(add(hero.position, scale(dir, mv.distance * 0.5)));
    }

    const seen = new Set<string>();
    for (const target of targets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x / 7)},${Math.round(dest.y / 7)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  return out;
}

function bodyblockSpot(hero: Entity, allies: Entity[], enemies: Entity[]): Vec2 | null {
  if (allies.length === 0) return null;
  const weak = allies.reduce((a, b) => ((a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b));
  if ((weak.hp + weak.barrier) / weak.maxHp > 0.6) return null;
  const threat = nearest(weak.position, enemies);
  if (!threat) return null;
  return add(weak.position, scale(sub(threat.position, weak.position), 0.33));
}

// ===========================================================================
// Evaluation (cfg-independent — Overlord's identity)
// ===========================================================================

function staticEval(s: GameState, myHeroId: EntityId, myTeam: TeamId): number {
  let v = basicScore(s, myTeam);
  const foeTeam: TeamId = myTeam === "red" ? "blue" : "red";

  const hero = s.entities.get(myHeroId);
  const enemies = [...s.entities.values()].filter(e => !e.dead && e.teamId === foeTeam);

  if (!hero || hero.dead) {
    v -= W_HERO_DEAD;
  } else {
    v += W_HERO_HP * (hero.hp + hero.barrier) / hero.maxHp;
    let incoming = 0;
    for (const e of enemies) incoming += reachableDamage(e, hero);
    v -= W_HERO_THREAT * (incoming / hero.maxHp);

    if (enemies.length > 0) {
      let myOffense = 0, inRangeNow = false, nd = Infinity;
      for (const e of enemies) {
        myOffense = Math.max(myOffense, reachableDamage(hero, e));
        if (canHitWithoutMoving(hero, e)) inRangeNow = true;
        nd = Math.min(nd, dist(e.position, hero.position));
      }
      v += W_HERO_OFFENSE * (myOffense / hero.maxHp);
      if (inRangeNow) v += W_IN_RANGE;
      if (Number.isFinite(nd)) v -= W_DRIFT * (nd / 1000);
    }
  }

  const enemyHero = enemies.find(isHeroLike) ?? null;
  const enemyHeroSeen = enemyHero || [...s.entities.values()].some(e => e.teamId === foeTeam && isHeroLike(e));
  if (enemyHeroSeen) {
    if (!enemyHero) v += W_ENEMY_HERO_DEAD;
    else v += W_ENEMY_HERO_SUPPRESS * (1 - (enemyHero.hp + enemyHero.barrier) / enemyHero.maxHp);
  }

  if (enemies.length > 1) {
    const c = centroid(enemies);
    let within = 0;
    for (const e of enemies) if (dist(e.position, c) <= AOE_RADIUS) within++;
    v += W_CLUSTER * (within / enemies.length);
  }

  const allies = [...s.entities.values()].filter(e => e.teamId === myTeam && e.id !== myHeroId);
  if (allies.length > 0) {
    let hp = 0, max = 0;
    for (const e of allies) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
    if (max > 0) v += W_ALLY_HP * (hp / max);
  }
  return v;
}

// ===========================================================================
// Small helpers
// ===========================================================================

function isHeroLike(e: Entity): boolean {
  return e.abilities.some(a => a.id === "greatsword-halfsword");
}
function moveReach(e: Entity): number {
  const mv = e.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  return mv ? getEffectiveDistance(e, mv.distance) : 0;
}
function reachableDamage(attacker: Entity, target: Entity): number {
  if (attacker.dead || target.dead) return 0;
  const gap = dist(attacker.position, target.position) - attacker.collisionRadius - target.collisionRadius;
  const afterMove = Math.max(0, gap - moveReach(attacker));
  let best = 0;
  for (const a of attacker.abilities) {
    if (a.kind !== "attack") continue;
    if (afterMove <= attackRange(a as AttackAbility)) best = Math.max(best, (a as AttackAbility).damage);
  }
  return best;
}
function canHitWithoutMoving(attacker: Entity, target: Entity): boolean {
  const gap = dist(attacker.position, target.position) - attacker.collisionRadius - target.collisionRadius;
  for (const a of attacker.abilities) if (a.kind === "attack" && gap <= attackRange(a as AttackAbility)) return true;
  return false;
}
function foeTotals(s: GameState, myTeam: TeamId): { hp: number; max: number; alive: number } {
  let hp = 0, max = 0, alive = 0;
  for (const e of s.entities.values()) {
    if (e.teamId === myTeam) continue;
    max += e.maxHp;
    if (!e.dead) { hp += effectiveHp(e); alive++; }
  }
  return { hp, max, alive };
}
function sig(a: PlayerAction): string {
  if (a.type !== "ability") return a.type;
  const aim = a.aimDirection ? `@${Math.round(Math.atan2(a.aimDirection.y, a.aimDirection.x) * 32)}` : "";
  const dst = a.destination ? `>${Math.round(a.destination.x / 7)},${Math.round(a.destination.y / 7)}` : "";
  return `${a.abilityId}${aim}${dst}`;
}
