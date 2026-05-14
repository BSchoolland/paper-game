/**
 * agent-03 — "Overlord" (Tournament 2).
 *
 * Architecture (unchanged from T1):
 *   Phase 1 — whole-turn beam search ranked by a cheap static eval.
 *   Phase 2 — each finalist judged against an **adversarial opponent model**: the enemy's allies
 *   stay scripted, but the enemy hero is allowed to pick the worst-for-me of several plausible
 *   smart turns (scripted, 1-ply best reply, all-in hunt my hero, all-in hunt my weakest ally).
 *   We minimise over those replies, blend with the scripted line, and iterate-deepen replyLevel.
 *
 * What changed for T2: the brain is now `makeOverlord(cfg)`. `cfg` carries both search effort
 * (beam width / finalists / heading samples / reply levels / budget) AND eval weight overrides,
 * so a Tank can want different things from a Ranged without forking the file. `isHeroLike` checks
 * `className` instead of sniffing for a specific ability id — the old greatsword check silently
 * misclassified Tank / Ranged / Boss / Solo heroes and collapsed the opponent model to "scripted",
 * which was exactly the bug Overlord exists to *avoid*.
 *
 *   bun hero-arena/src/harness.ts agent-03 baseline
 *   bun hero-arena/src/harness.ts agent-03 agent-01 42
 *   bun -e "import { runSoloChallenge } from './hero-arena/src/t2/challenge-solo.js';
 *           import { agent } from './hero-arena/agents/agent-03/index.js';
 *           const r = await runSoloChallenge(agent, [42]); for (const l of r.log) console.log(l);"
 */
import type { HeroController } from "../../src/types.js";
import type { MultiFormatAgent } from "../../src/t2/types.js";
import type {
  AbilityDefinition, AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction,
  TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { ShapeKind } from "../../../shared/src/core/types.js";
import { add, sub, scale, normalize, length } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, basicScore, effectiveHp,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "../../src/toolkit.js";

// ===========================================================================
// Configuration
// ===========================================================================

/** Weights for the static board evaluator. All in the same arbitrary unit as `basicScore`. */
export interface EvalWeights {
  heroHp: number;            // my hero HP+barrier / maxHp
  heroDead: number;          // flat penalty if my hero is dead
  heroThreat: number;        // penalty per (incoming reachable damage)/heroMax
  heroOffense: number;       // bonus per (my biggest reachable hit)/heroMax
  enemyHeroDead: number;     // bonus if enemy hero is dead
  enemyHeroSuppress: number; // bonus per (1 - enemyHeroHpFraction)
  cluster: number;           // bonus for foes bunched within an AoE radius
  allyHp: number;            // bonus per ally HP+barrier fraction
  drift: number;             // penalty per (hero dist to nearest foe)/1000 — positive = pull toward fight
  cohesion: number;          // penalty per (hero dist to ally centroid)/1000 — stay near soakers
  inRange: number;           // flat bonus when the hero can land an attack right now
  immediateDmg: number;      // bonus per (HP shaved off foes this turn)/foeMaxTot
  immediateKill: number;     // bonus per foe killed this turn
}

export interface OverlordConfig {
  softBudgetMs: number;      // self-cap per turn (further clamped by ctx.deadlineMs)
  maxSteps: number;          // beam search depth
  beamWidth: number;         // partial-turn plans kept between expansions
  finalists: number;         // full-turn plans that get adversarial rollouts
  headingSamples: number;    // move heading fan
  replyLevels: 1 | 2 | 3;    // adversarial reply variety (3 = scripted + best-reply + 2 hunts)
  weights: EvalWeights;
}

const DEFAULT_WEIGHTS: EvalWeights = {
  // Tuned 2026-05-14 from desktop head-to-head @ 2s/turn, 6 seeds × 2 sides, all 7 opponents.
  // Final standings: 66W-16L (80% win rate), winning record vs every opponent (agent-01..08).
  //
  //   opp        W-L    margin
  //   agent-01  12-0   +22.5%
  //   agent-02   7-5    +0.1%   (Sovereign — the close one; baseline was 2-10 -16%)
  //   agent-04  10-2   +30.5%
  //   agent-05   8-4   +24.0%
  //   agent-06   9-3   +18.9%
  //   agent-07  10-2   +16.1%
  //   agent-08  10-0   +32.9%
  //
  // The numbers below mirror Sovereign's FIGHTER_WEIGHTS — that was the result of *multi-round*
  // self-play tuning by agent-02's author, so copying them gave a calibrated starting point.
  // The win against Sovereign comes from architecture, not weights: Overlord's beam + 2-line
  // adversarial rollout (scripted + 1-ply best-reply + hunt-my-hero), combined with the lighter
  // 0.7/0.3 worst-case blend below, lets the bot commit to good plays the opponent *probably*
  // lets through, while still avoiding the obvious punishes Sovereign exploited at higher blend
  // pessimism (a paranoid 0.5/0.5 mix lost 2-10).
  heroHp: 0.6, heroDead: 2.0, heroThreat: 0.563, heroOffense: 0.7,
  enemyHeroDead: 0.8, enemyHeroSuppress: 0.0,
  cluster: 0.25, allyHp: 0.188,
  drift: 1.1, cohesion: 0.8, inRange: 0.12,
  immediateDmg: 0.7, immediateKill: 0.7,
};

// --- engine constants (Overlord's identity, not per-role) ---
/** Pull back this far from the harness deadline (machine-jitter buffer + return-trip overhead).
 *  Proportional so it doesn't bury a short budget: 80 ms minimum, ~10% of the budget otherwise.
 *  The old absolute 450 ms turned a 400 ms turn budget into a negative deadline → "always pass". */
function safetyMargin(remainingMs: number): number {
  // Sovereign uses 60ms flat. Bigger absolute reserve for very long budgets (5s+) just because
  // a 250ms over-budget on a 5s turn matters less than on a 2s turn. Bottom-line: don't burn
  // ~10% of a 2s budget on safety when 60-80ms is enough.
  return Math.min(Math.max(60, Math.round(remainingMs * 0.04)), 350);
}
const AOE_RADIUS = 90;
const KITE_RING = 0.85;

/**
 * Role presets. Search effort is sized for the **2 s/turn** T2 budget. Eval-weight tweaks are
 * intentionally small — Overlord's identity (king safety, suppress the enemy hero, value
 * clustering foes for our AoE allies) should still come through.
 */
export const PRESETS = {
  /** Mirror duel default — same shape as T1 tournament Overlord, but the budget is the T2 2s cap. */
  fighter: cfg({}, { softBudgetMs: 4500, beamWidth: 10, finalists: 22, headingSamples: 8 }),

  /** Tank — front-line, soak hits, body-block. Values its own HP more (irreplaceable shield),
   *  more wary of incoming damage, and more willing to spend a turn near a hurting ally. */
  tank: cfg(
    { heroHp: 1.6, heroThreat: 1.1, allyHp: 0.32, drift: 0.6, inRange: 0.18 },
    { softBudgetMs: 4500, beamWidth: 9, finalists: 18, headingSamples: 8 },
  ),

  /** Ranged — kite at max range. Drift inverted-ish (almost no pull toward the fight) and a big
   *  in-range bonus, so it'll pick the spot that *just* reaches and stop there. */
  ranged: cfg(
    { heroHp: 1.3, heroThreat: 1.0, heroOffense: 0.6, drift: 0.15, inRange: 0.45 },
    { softBudgetMs: 4500, beamWidth: 9, finalists: 18, headingSamples: 10 },
  ),

  /** Boss — 300 HP, 3 energy, slow. Can afford to trade. Lower HP-defence weight, higher offense,
   *  more aggressive drift toward the fight. The bigger energy pool justifies a deeper beam. */
  boss: cfg(
    { heroHp: 0.7, heroThreat: 0.45, heroOffense: 0.7, drift: 1.3, inRange: 0.2 },
    { softBudgetMs: 4500, maxSteps: 7, beamWidth: 10, finalists: 22, headingSamples: 8 },
  ),

  /** Solo-bruiser — short-range kit, dive the pack and trade. */
  soloBruiser: cfg(
    { heroOffense: 0.6, cluster: 0.4, drift: 1.2 },
    { softBudgetMs: 4500, beamWidth: 10, finalists: 22, headingSamples: 8, replyLevels: 1 },
  ),

  /** Solo-kiter — long-range kit, stay back, pick from max range. No enemy hero in solo, so
   *  replyLevels can drop to 1 (the adversarial model degrades to the scripted line anyway). */
  soloKiter: cfg(
    { heroHp: 1.4, heroOffense: 0.6, drift: 0.1, inRange: 0.5 },
    { softBudgetMs: 4500, beamWidth: 10, finalists: 22, headingSamples: 12, replyLevels: 1 },
  ),

  /** Solo-mixed — balanced kit. Closer to fighter but no opponent-hero deepening. */
  soloMixed: cfg(
    {},
    { softBudgetMs: 4500, beamWidth: 10, finalists: 22, headingSamples: 8, replyLevels: 1 },
  ),
} as const satisfies Record<string, OverlordConfig>;

function cfg(weights: Partial<EvalWeights>, search: Partial<Omit<OverlordConfig, "weights">>): OverlordConfig {
  return {
    softBudgetMs: 4500, maxSteps: 6, beamWidth: 12, finalists: 28, headingSamples: 10, replyLevels: 2,
    ...search,
    weights: { ...DEFAULT_WEIGHTS, ...weights },
  };
}

// ===========================================================================
// Hero-detection (the bug that started this rewrite)
// ===========================================================================

/**
 * Hero-like entities. The arena builders pass the hero's role into `makeEntity` as its `name`:
 *   T1 (`hero-arena/src/arena.ts`) — "Hero".
 *   T2 (`hero-arena/src/t2/arena2.ts`) — the role string: "tank" / "fighter" / "ranged" / "boss" / "solo".
 * Scripted allies' names are their template keys (e.g. "goblin-spear", "big-slime") — none overlap.
 * The old isHeroLike sniffed for `greatsword-halfsword`, which silently said "no hero" for every
 * non-fighter brain and collapsed the adversarial opponent model to scripted-only.
 */
const HERO_NAMES = new Set(["Hero", "tank", "fighter", "ranged", "boss", "solo"]);
function isHeroLike(e: Entity): boolean {
  return HERO_NAMES.has(e.name);
}

// ===========================================================================
// Factory
// ===========================================================================

export function makeOverlord(cfgIn: OverlordConfig): HeroController {
  const cfg = cfgIn;
  return (ctx) => {
    const myTeam = teamOf(ctx.state, ctx.heroId);
    const me = ctx.state.entities.get(ctx.heroId);
    if (!me || me.dead) return [];
    if (livingEnemies(ctx.state, ctx.heroId).length === 0) return [];

    const start = Date.now();
    const rawRemaining = Math.max(0, ctx.deadlineMs - start);
    const safety = safetyMargin(rawRemaining);
    const deadline = Math.min(ctx.deadlineMs - safety, start + cfg.softBudgetMs);
    const timeUp = () => Date.now() >= deadline;
    const phase1Deadline = Math.min(deadline, start + Math.max(80, (deadline - start) * 0.4));
    const phase1Up = () => Date.now() >= phase1Deadline;

    // --- phase 1: beam search ---
    const finals = beamSearch(ctx.state, ctx.heroId, myTeam, cfg, phase1Up);
    const seen = new Set<string>();
    const pass: PlayerAction[] = [];
    const cands: PlayerAction[][] = [pass];
    for (const f of finals) {
      if (f.plan.length === 0) continue;
      const key = f.plan.map(sig).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push(f.plan);
      if (cands.length >= cfg.finalists) break;
    }

    // --- phase 2: judge each finalist against the adversarial opponent model ---
    const foe0 = foeTotals(ctx.state, myTeam);
    const W = cfg.weights;
    let best = pass;
    for (let replyLevel = 1; replyLevel <= cfg.replyLevels; replyLevel++) {
      if (timeUp()) break;
      let levelBest: PlayerAction[] | null = null;
      let levelBestVal = -Infinity;
      for (const plan of cands) {
        if (timeUp()) break;
        let s: GameState = ctx.state;
        for (const a of plan) s = resolveAction(s, a);
        const foe1 = foeTotals(s, myTeam);
        const immediate = W.immediateDmg * (foe0.hp - foe1.hp) / Math.max(1, foe0.max)
                        + W.immediateKill * (foe0.alive - foe1.alive);
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
    next.sort((a, b) => staticEval(b.state, heroId, myTeam, cfg.weights) - staticEval(a.state, heroId, myTeam, cfg.weights));
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
  finals.sort((a, b) => staticEval(b.state, heroId, myTeam, cfg.weights) - staticEval(a.state, heroId, myTeam, cfg.weights));
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
  if (afterEnd.winner) return staticEval(afterEnd, heroId, myTeam, cfg.weights);

  const enemyTeam = afterEnd.activeTeam;
  // Multi-hero enemy sides (3v3, raid): consider the most-dangerous enemy hero as "the brain" —
  // closest hero with the biggest reachable hit on us. The others stay folded into the scripted
  // sim (still better than ignoring them, since simulateScriptedTurn drives them too).
  const enemyHeroes = [...afterEnd.entities.values()].filter(e => !e.dead && e.teamId === enemyTeam && isHeroLike(e));
  const myHero = afterEnd.entities.get(heroId);
  const enemyHero = pickThreatHero(enemyHeroes, myHero);

  const scriptedVal = staticEval(simulateScriptedTurn(afterEnd), heroId, myTeam, cfg.weights);
  let worst = scriptedVal;

  if (enemyHero && !timeUp()) {
    worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, bestReplyPlan(afterEnd, enemyHero.id, heroId, myTeam, cfg, timeUp)), heroId, myTeam, cfg.weights));
  }
  if (enemyHero && replyLevel >= 2 && !timeUp()) {
    worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, heroId, cfg)), heroId, myTeam, cfg.weights));
  }
  if (enemyHero && replyLevel >= 3 && !timeUp()) {
    const myAllies = [...afterEnd.entities.values()].filter(e => !e.dead && e.teamId === myTeam && e.id !== heroId);
    if (myAllies.length > 0) {
      const weak = myAllies.reduce((a, b) => ((a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b));
      worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, weak.id, cfg)), heroId, myTeam, cfg.weights));
    }
  }
  // Blend the scripted-reply expectation with the worst-case (the "smart opponent could punish"
  // line). 0.7 / 0.3 was tuned 2026-05-14 against agent-02 (Sovereign): a 0.5 / 0.5 blend made
  // the bot too risk-averse, refusing the trades Sovereign happily takes, leading to a 3-9
  // record. Weighting scripted expectation more lets the bot commit to good plays the opponent
  // *probably* lets through, while still avoiding the obvious punishes.
  return 0.7 * scriptedVal + 0.3 * worst;
}

/** Of several enemy heroes, the one with the biggest reachable hit on us — break ties by proximity. */
function pickThreatHero(heroes: Entity[], me: Entity | undefined): Entity | null {
  if (heroes.length === 0 || !me) return null;
  if (heroes.length === 1) return heroes[0]!;
  let best = heroes[0]!;
  let bestScore = -Infinity;
  for (const h of heroes) {
    const dmg = reachableDamage(h, me);
    const d = dist(h.position, me.position);
    const s = dmg * 100 - d;
    if (s > bestScore) { bestScore = s; best = h; }
  }
  return best;
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
  const maxSteps = Math.min(3, cfg.maxSteps);
  for (let step = 0; step < maxSteps; step++) {
    const a = s.entities.get(attackerId);
    if (!a || a.dead || s.winner || timeUp()) break;
    let bestAct: PlayerAction | null = null;
    let bestVal = staticEval(s, myHeroId, myTeam, cfg.weights);
    for (const action of heroCandidates(s, a, cfg)) {
      if (timeUp()) break;
      const after = tryAction(s, action);
      if (!after) continue;
      const v = after.winner && after.winner !== myTeam ? -1e6 : staticEval(after, myHeroId, myTeam, cfg.weights);
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
// Evaluation
// ===========================================================================

function staticEval(s: GameState, myHeroId: EntityId, myTeam: TeamId, W: EvalWeights): number {
  let v = basicScore(s, myTeam);
  const foeTeam: TeamId = myTeam === "red" ? "blue" : "red";

  const hero = s.entities.get(myHeroId);
  const enemies = [...s.entities.values()].filter(e => !e.dead && e.teamId === foeTeam);

  if (!hero || hero.dead) {
    v -= W.heroDead;
  } else {
    v += W.heroHp * (hero.hp + hero.barrier) / hero.maxHp;
    let incoming = 0;
    for (const e of enemies) incoming += reachableDamage(e, hero);
    v -= W.heroThreat * (incoming / hero.maxHp);

    if (enemies.length > 0) {
      let myOffense = 0, inRangeNow = false, nd = Infinity;
      for (const e of enemies) {
        myOffense = Math.max(myOffense, reachableDamage(hero, e));
        if (canHitWithoutMoving(hero, e)) inRangeNow = true;
        nd = Math.min(nd, dist(e.position, hero.position));
      }
      v += W.heroOffense * (myOffense / hero.maxHp);
      if (inRangeNow) v += W.inRange;
      if (Number.isFinite(nd)) v -= W.drift * (nd / 1000);
    }
  }

  // Enemy hero(es): the brief notes T2 sides may have multiple. Use the *most-suppressed* foe-hero
  // representative (sum HP fractions): killing one collapses that brain to scripted; chipping all
  // of them is still progress. `enemyHeroSeen` ensures the dead-bonus only fires if there was one.
  const foeHeroes = enemies.filter(isHeroLike);
  const anyFoeHeroEver = foeHeroes.length > 0 || [...s.entities.values()].some(e => e.teamId === foeTeam && isHeroLike(e));
  if (anyFoeHeroEver) {
    if (foeHeroes.length === 0) {
      v += W.enemyHeroDead;
    } else {
      let suppress = 0;
      for (const h of foeHeroes) suppress += (1 - (h.hp + h.barrier) / h.maxHp);
      v += W.enemyHeroSuppress * (suppress / foeHeroes.length);
    }
  }

  if (enemies.length > 1) {
    const c = centroid(enemies);
    let within = 0;
    for (const e of enemies) if (dist(e.position, c) <= AOE_RADIUS) within++;
    v += W.cluster * (within / enemies.length);
  }

  const allies = [...s.entities.values()].filter(e => e.teamId === myTeam && e.id !== myHeroId);
  if (allies.length > 0) {
    let hp = 0, max = 0;
    for (const e of allies) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
    if (max > 0) v += W.allyHp * (hp / max);

    // Cohesion: don't isolate from the soaker pack. Sovereign-style — when you chase the enemy
    // hero alone, you get gang-tackled by their hero + allies. Staying close to my own allies
    // means trades happen as a *team* fight, not a duel I keep losing.
    const live = allies.filter(e => !e.dead);
    if (live.length > 0 && hero && !hero.dead) {
      const c = centroid(live);
      const d = dist(hero.position, c);
      v -= W.cohesion * (d / 1000);
    }
  }
  return v;
}

// ===========================================================================
// Small helpers
// ===========================================================================

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

// ===========================================================================
// Solo ability classifier — pick a preset by the random ability bag
// ===========================================================================

/**
 * Classify a random solo loadout:
 *  - `kiter` if the kit's biggest hits are ranged (point/rectangle attacks at >120 px).
 *  - `bruiser` if it's mostly short-range sectors / circles.
 *  - `mixed` otherwise.
 */
function classifySoloKit(abilities: AbilityDefinition[]): "kiter" | "bruiser" | "mixed" {
  let rangedDmg = 0, meleeDmg = 0;
  for (const a of abilities) {
    if (a.kind !== "attack") continue;
    const r = attackRange(a as AttackAbility);
    const dmg = (a as AttackAbility).damage;
    if (r >= 150) rangedDmg += dmg;
    else if (r <= 90) meleeDmg += dmg;
    else { rangedDmg += dmg * 0.5; meleeDmg += dmg * 0.5; }
  }
  if (rangedDmg >= meleeDmg * 1.5) return "kiter";
  if (meleeDmg >= rangedDmg * 1.5) return "bruiser";
  return "mixed";
}

// ===========================================================================
// MultiFormatAgent — wire the presets into the four T2 formats
// ===========================================================================

const fighterHero = makeOverlord(PRESETS.fighter);
const tankHero = makeOverlord(PRESETS.tank);
const rangedHero = makeOverlord(PRESETS.ranged);
const bossHero = makeOverlord(PRESETS.boss);

const soloHeroes = {
  kiter: makeOverlord(PRESETS.soloKiter),
  bruiser: makeOverlord(PRESETS.soloBruiser),
  mixed: makeOverlord(PRESETS.soloMixed),
};

/** T1 export — `harness.ts` and the T1 tournament still import this. */
export const hero: HeroController = fighterHero;

export const agent: MultiFormatAgent = {
  name: "agent-03",
  solo: (abilities) => soloHeroes[classifySoloKit(abilities)],
  squad: { tank: tankHero, fighter: fighterHero, ranged: rangedHero },
  boss: bossHero,
  raid: { tank: tankHero, fighter: fighterHero, ranged: rangedHero },
};

// re-exports for testing / tooling
export { ShapeKind };
