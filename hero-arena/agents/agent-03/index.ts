/**
 * agent-03 — "Overlord".
 *
 * The other strong bots in this arena (Beamblade, Sovereign) both run a whole-turn beam search and
 * then judge each candidate turn by playing the round out against a *scripted* (or lightly
 * pessimistic) opponent. Overlord keeps the beam search but spends its turn budget on the part
 * that actually decides a mirror duel: it judges every finalist against an **adversarial opponent
 * model** — the enemy's dumb allies stay scripted, but the enemy *hero* (the only brain on that
 * side) is allowed to pick the worst-for-me of several plausible smart turns: pure scripted, an
 * all-in hunt on my hero, an all-in hunt on my weakest ally, and a 1-ply best-reply. We then take
 * the *minimum* over those replies. So Overlord never walks into a square a competent opponent can
 * punish — which both of the other bots, assuming a scripted reply, sometimes do.
 *
 * On top of that: broad candidate generation (every attack aimed at every foe / the cluster / pair
 * midpoints / the enemy hero, plus a fan of move headings at full and half range, kite rings,
 * retreats, regroup and bodyblock spots — so knockback slams and step-then-swing combos surface),
 * and a king-safety + initiative + enemy-hero-suppression + enemy-clustering evaluation with the
 * hero weighted far above the interchangeable allies. Iterative: it widens the opponent model and
 * re-judges as long as there's time left, keeping the best answer found so far.
 *
 *   bun hero-arena/src/harness.ts agent-03 baseline
 *   bun hero-arena/src/harness.ts agent-03 agent-01 42
 *   bun hero-arena/src/harness.ts agent-03 agent-02 7
 */
import type { HeroController } from "../../src/types.js";
import type {
  AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction, TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { add, sub, scale, normalize, length } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, basicScore,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "../../src/toolkit.js";

// --- tunables ---------------------------------------------------------------
const SAFETY_MS = 450;        // stop this far before the hard deadline (tournament machines vary)
const SOFT_BUDGET_MS = 3500;  // try to finish a turn within this even if the deadline is further off
const MAX_STEPS = 6;          // hero abilities per turn (banked energy buys ~5; cap a touch above)
const BEAM_WIDTH = 12;        // partial-turn plans kept between beam-expansion rounds
const FINALISTS = 28;         // full-turn candidates that get the (expensive) adversarial rollout
const HEADING_SAMPLES = 10;   // move headings fanned around the hero
const AOE_RADIUS = 90;        // greatsword-sweep reach — the "are the enemies clustered" yardstick
const KITE_RING = 0.85;       // when repositioning to fire, aim for this fraction of our reach

// --- evaluation weights -----------------------------------------------------
const W_HERO_HP = 1.0;        // my hero HP+barrier fraction (irreplaceable piece)
const W_HERO_DEAD = 2.6;      // extra penalty if my hero is dead (on top of the HP / body-count loss)
const W_HERO_THREAT = 0.75;   // penalty per (incoming damage that can reach my hero next turn)/heroMax
const W_HERO_OFFENSE = 0.4;   // bonus per (damage my hero can threaten next turn)/heroMax
const W_ENEMY_HERO_DEAD = 1.8;// bonus if the enemy hero is dead (collapses them to pure scripted AI)
const W_ENEMY_HERO_SUPPRESS = 0.85; // bonus per (1 - enemyHeroHpFraction)
const W_CLUSTER = 0.25;       // bonus for foes bunched within an AoE radius (free value for our allies)
const W_ALLY_HP = 0.16;       // bonus per ally HP+barrier fraction above the bare body-count term
const W_DRIFT = 1.0;          // pull toward the fight: penalty per (hero dist to nearest foe)/1000 —
                              //   strong enough that the hero closes in, but won't override a real trade
const W_IN_RANGE = 0.12;      // flat bonus when the hero can land an attack right now (no move needed)
const W_IMM_DMG = 0.7;        // bonus per (HP the hero's own actions shaved off foes this turn)/foeMaxTot
const W_IMM_KILL = 0.7;       // bonus per foe the hero's own actions killed this turn

// ===========================================================================

export const hero: HeroController = (ctx) => {
  const myTeam = teamOf(ctx.state, ctx.heroId);
  const me = ctx.state.entities.get(ctx.heroId);
  if (!me || me.dead) return [];
  if (livingEnemies(ctx.state, ctx.heroId).length === 0) return [];

  const start = Date.now();
  const deadline = Math.min(ctx.deadlineMs - SAFETY_MS, start + SOFT_BUDGET_MS);
  const timeUp = () => Date.now() >= deadline;
  // Give the beam search a sub-budget so phase 2 (the adversarial rollouts — the part that judges
  // a candidate against a *smart* opponent rather than a scripted one) always gets a real share.
  const phase1Deadline = Math.min(deadline, start + Math.max(800, (deadline - start) * 0.4));
  const phase1Up = () => Date.now() >= phase1Deadline;

  // --- phase 1: beam search over whole-turn plans, ranked by the cheap static eval ------------
  const finals = beamSearch(ctx.state, ctx.heroId, myTeam, phase1Up);
  // dedup by action signature, keep the most promising handful, always keep the pass.
  const seen = new Set<string>();
  const pass: PlayerAction[] = [];
  const cand: PlayerAction[][] = [pass];
  for (const f of finals) {
    if (f.plan.length === 0) continue;
    const key = f.plan.map(sig).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    cand.push(f.plan);
    if (cand.length >= FINALISTS) break;
  }

  // --- phase 2: judge each finalist against the adversarial opponent model --------------------
  // `replyLevel` widens the set of enemy-hero replies we minimise over; bigger = more pessimistic
  // but slower. Iterative-deepen it, keeping the best plan from the deepest level we finished.
  const foe0 = foeTotals(ctx.state, myTeam);   // foes before our turn — for the "damage we dealt" term
  let best = pass;
  for (let replyLevel = 1; replyLevel <= 3; replyLevel++) {
    if (timeUp()) break;
    let levelBest: PlayerAction[] | null = null;
    let levelBestVal = -Infinity;
    for (const plan of cand) {
      if (timeUp()) break;
      let s: GameState = ctx.state;
      for (const a of plan) s = resolveAction(s, a);
      // a noise-free reward for what the hero just did, measured before the rollout muddies it.
      const foe1 = foeTotals(s, myTeam);
      const immediate = W_IMM_DMG * (foe0.hp - foe1.hp) / Math.max(1, foe0.max) + W_IMM_KILL * (foe0.alive - foe1.alive);
      const v = (s.winner === myTeam ? 1e6 : adversarialValue(s, ctx.heroId, myTeam, replyLevel, timeUp)) + immediate;
      if (v > levelBestVal) { levelBestVal = v; levelBest = plan; }
    }
    if (levelBest && !timeUp()) best = levelBest;          // only adopt a fully-completed level
    else if (levelBest && best === pass) best = levelBest; // ...unless we have nothing better yet
  }
  return best;
};

// ===========================================================================
// Phase 1 — beam search
// ===========================================================================

interface Node { state: GameState; plan: PlayerAction[]; }

function beamSearch(root: GameState, heroId: EntityId, myTeam: TeamId, timeUp: () => boolean): Node[] {
  let beam: Node[] = [{ state: root, plan: [] }];
  const finals: Node[] = [{ state: root, plan: [] }]; // passing is always a finalist

  for (let step = 0; step < MAX_STEPS; step++) {
    if (timeUp()) break;
    const next: Node[] = [];
    for (const node of beam) {
      const h = node.state.entities.get(heroId);
      if (!h || h.dead || node.state.winner) { finals.push(node); continue; }
      let expanded = false;
      for (const action of heroCandidates(node.state, h)) {
        if (timeUp()) break;
        const after = tryAction(node.state, action);
        if (!after) continue;
        expanded = true;
        next.push({ state: after, plan: [...node.plan, action] });
      }
      if (!expanded || step === MAX_STEPS - 1) finals.push(node);
    }
    if (next.length === 0) break;
    // rank partial plans by the cheap static eval (no rollout yet); dedupe near-identical states.
    next.sort((a, b) => staticEval(b.state, heroId, myTeam) - staticEval(a.state, heroId, myTeam));
    const seen = new Set<string>();
    beam = [];
    for (const n of next) {
      const k = stateKey(n.state, heroId);
      if (seen.has(k)) continue;
      seen.add(k);
      beam.push(n);
      if (beam.length >= BEAM_WIDTH) break;
    }
    for (const n of beam) finals.push(n);
  }
  // rank finalists by static eval so phase 2 sees the most promising ones first (it may time out).
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

/** Value of the board after my hero's turn (given as `state`, still my turn) once: my dumb allies
 *  take their scripted turn, the turn ends, and the enemy replies with the worst-for-me of a set of
 *  plausible enemy turns (widened by `replyLevel`). */
function adversarialValue(state: GameState, heroId: EntityId, myTeam: TeamId, replyLevel: number, timeUp: () => boolean): number {
  const afterAllies = simulateMyAlliesTurn(state, heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  if (afterEnd.winner) return staticEval(afterEnd, heroId, myTeam);

  const enemyTeam = afterEnd.activeTeam;
  const enemyHero = [...afterEnd.entities.values()].find(e => !e.dead && e.teamId === enemyTeam && isHeroLike(e)) ?? null;

  // The pure-scripted reply (everyone, including their hero, plays the stock AI) — the "expected" line.
  const scriptedVal = staticEval(simulateScriptedTurn(afterEnd), heroId, myTeam);
  let worst = scriptedVal;

  if (enemyHero && !timeUp()) {
    // their hero plays a 1-ply best reply (the move that minimises my static eval right now);
    // their allies play scripted. This is the realistic "smart opponent" line.
    worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, bestReplyPlan(afterEnd, enemyHero.id, heroId, myTeam, timeUp)), heroId, myTeam));
  }
  if (enemyHero && replyLevel >= 2 && !timeUp()) {
    // worst-case bound: their hero goes all-in on my hero; their allies play scripted.
    worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, heroId)), heroId, myTeam));
  }
  if (enemyHero && replyLevel >= 3 && !timeUp()) {
    // ...or all-in on my weakest living ally (clearing my board / orchestrating their AoE).
    const myAllies = [...afterEnd.entities.values()].filter(e => !e.dead && e.teamId === myTeam && e.id !== heroId);
    if (myAllies.length > 0) {
      const weak = myAllies.reduce((a, b) => ((a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b));
      worst = Math.min(worst, staticEval(enemyTurnWithHeroPlan(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, weak.id)), heroId, myTeam));
    }
  }
  // expect the scripted line, but stay wary of the punish: blend the expected and worst-case values.
  return 0.5 * scriptedVal + 0.5 * worst;
}

/** Apply `heroPlan` for the enemy hero, then run that side's scripted allies, then end the turn. */
function enemyTurnWithHeroPlan(afterEnd: GameState, enemyHeroId: EntityId, heroPlan: PlayerAction[]): GameState {
  let s = afterEnd;
  for (const a of heroPlan) s = resolveAction(s, a);
  if (s.winner) return s;
  s = simulateMyAlliesTurn(s, enemyHeroId); // scripted teammates of the enemy hero
  return resolveAction(s, { type: "endTurn" });
}

/** Greedily hunt `victimId`: keep stepping toward it and hitting it with the biggest attack that
 *  connects, until out of energy / steps. Returns the action list (no `endTurn`). */
function huntPlan(state: GameState, attackerId: EntityId, victimId: EntityId): PlayerAction[] {
  const plan: PlayerAction[] = [];
  let s = state;
  for (let step = 0; step < MAX_STEPS; step++) {
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

/** A 1-ply best-reply for the enemy hero: build its turn one action at a time, each step taking the
 *  candidate that minimises my (the original team's) static eval. Cheap — no nested rollout. */
function bestReplyPlan(state: GameState, attackerId: EntityId, myHeroId: EntityId, myTeam: TeamId, timeUp: () => boolean): PlayerAction[] {
  const plan: PlayerAction[] = [];
  let s = state;
  for (let step = 0; step < 3; step++) {
    const a = s.entities.get(attackerId);
    if (!a || a.dead || s.winner || timeUp()) break;
    let bestAct: PlayerAction | null = null;
    let bestVal = staticEval(s, myHeroId, myTeam); // value of the enemy stopping here (lower is better for them)
    for (const action of heroCandidates(s, a)) {
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
// Candidate generation (used for our hero and, in the opponent model, for theirs)
// ===========================================================================

function heroCandidates(state: GameState, hero: Entity): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const allies = livingAllies(state, hero.id);
  const out: PlayerAction[] = [];

  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const enemyHero = enemies.find(isHeroLike) ?? null;
  const allyCentroid = allies.length > 0 ? centroid(allies) : hero.position;

  // non-aimed abilities (shield block, etc.) — just offer casting them.
  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a)) out.push({ type: "ability", entityId: hero.id, abilityId: a.id });
  }

  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // attack in place — aim at each foe, the cluster, the enemy hero, and pair midpoints (so line /
  // sector hits catch two). Keep only aims that actually connect; dedupe by heading.
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

  // moves
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const myReach = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0)
      || attackAbilities(hero).reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const away = normalize(sub(hero.position, near.position));
    const targets: Vec2[] = [];
    for (const e of enemies) targets.push(e.position);          // close in on each foe
    targets.push(cluster);                                       // dive the pack
    if (enemyHero) {
      targets.push(enemyHero.position);
      const perp = { x: -away.y, y: away.x };
      targets.push(add(enemyHero.position, scale(perp, 55)));
      targets.push(add(enemyHero.position, scale(perp, -55)));
    }
    targets.push(allyCentroid);                                  // regroup with allies
    const block = bodyblockSpot(state, hero, allies, enemies);
    if (block) targets.push(block);
    if (length(away) > 0) {                                      // kite rings / full retreat
      if (myReach > 1) for (const f of [0.7, 0.95, 1.2]) targets.push(add(near.position, scale(away, Math.max(40, myReach * f * KITE_RING / 0.85))));
      targets.push(add(hero.position, scale(away, mv.distance)));
    }
    for (let k = 0; k < HEADING_SAMPLES; k++) {                  // generic coverage: a fan of headings
      const ang = (k / HEADING_SAMPLES) * Math.PI * 2;
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

/** A point between our weakest hurting ally and the foe nearest it (stand in the way). */
function bodyblockSpot(state: GameState, hero: Entity, allies: Entity[], enemies: Entity[]): Vec2 | null {
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

/** Static board value from `myTeam`'s view: basicScore (HP% + body count + decisive ±10) plus
 *  hero weighting, king safety, initiative, enemy-hero suppression, enemy clustering, ally HP and
 *  a tiny drift toward the fight. */
function staticEval(s: GameState, myHeroId: EntityId, myTeam: TeamId): number {
  let v = basicScore(s, myTeam);
  const foeTeam: TeamId = myTeam === "red" ? "blue" : "red";

  const hero = s.entities.get(myHeroId);
  const enemies = [...s.entities.values()].filter(e => !e.dead && e.teamId === foeTeam);

  if (!hero || hero.dead) {
    v -= W_HERO_DEAD;
  } else {
    v += W_HERO_HP * (hero.hp + hero.barrier) / hero.maxHp;

    // king safety: damage that can actually *land* on the hero next enemy turn — for each foe, the
    // biggest attack whose range (plus that foe's move) reaches the hero. Standing at precision-shot
    // distance therefore costs far less than standing in greatsword reach.
    let incoming = 0;
    for (const e of enemies) incoming += reachableDamage(e, hero);
    v -= W_HERO_THREAT * (incoming / hero.maxHp);

    if (enemies.length > 0) {
      // initiative: the biggest hit my hero can land on *some* foe next turn (a move + an attack),
      // a flat bonus if it can hit one *without* moving, and a pull toward the fight.
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

  // enemy hero: killing it (or suppressing it) collapses them to pure scripted AI.
  const enemyHero = enemies.find(isHeroLike) ?? null;
  const enemyHeroSeen = enemyHero || [...s.entities.values()].some(e => e.teamId === foeTeam && isHeroLike(e));
  if (enemyHeroSeen) {
    if (!enemyHero) v += W_ENEMY_HERO_DEAD;
    else v += W_ENEMY_HERO_SUPPRESS * (1 - (enemyHero.hp + enemyHero.barrier) / enemyHero.maxHp);
  }

  // enemy clustering — free value for our AoE allies (no friendly fire).
  if (enemies.length > 1) {
    const c = centroid(enemies);
    let within = 0;
    for (const e of enemies) if (dist(e.position, c) <= AOE_RADIUS) within++;
    v += W_CLUSTER * (within / enemies.length);
  }

  // keep our allies topped up (above the bare body-count term in basicScore).
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

/** The arena's heroes carry the greatsword kit; `greatsword-halfsword` is unique to it. */
function isHeroLike(e: Entity): boolean {
  return e.abilities.some(a => a.id === "greatsword-halfsword");
}
function moveReach(e: Entity): number {
  const mv = e.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  return mv ? getEffectiveDistance(e, mv.distance) : 0;
}
/** The biggest-damage attack `attacker` could land on `target` next turn (one move toward it, then
 *  the attack) — i.e. the worst hit `target` should expect from this attacker. 0 if none reaches. */
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
/** Could `attacker` land an attack on `target` right now, without moving? */
function canHitWithoutMoving(attacker: Entity, target: Entity): boolean {
  const gap = dist(attacker.position, target.position) - attacker.collisionRadius - target.collisionRadius;
  for (const a of attacker.abilities) if (a.kind === "attack" && gap <= attackRange(a as AttackAbility)) return true;
  return false;
}
/** Sum of HP+barrier / max-HP / living count for `myTeam`'s foes. */
function foeTotals(s: GameState, myTeam: TeamId): { hp: number; max: number; alive: number } {
  let hp = 0, max = 0, alive = 0;
  for (const e of s.entities.values()) {
    if (e.teamId === myTeam) continue;
    max += e.maxHp;
    if (!e.dead) { hp += e.hp + e.barrier; alive++; }
  }
  return { hp, max, alive };
}
function sig(a: PlayerAction): string {
  if (a.type !== "ability") return a.type;
  const aim = a.aimDirection ? `@${Math.round(Math.atan2(a.aimDirection.y, a.aimDirection.x) * 32)}` : "";
  const dst = a.destination ? `>${Math.round(a.destination.x / 7)},${Math.round(a.destination.y / 7)}` : "";
  return `${a.abilityId}${aim}${dst}`;
}
