/**
 * Sovereign — agent-02's hero brain.
 *
 * Not a greedy turn-builder like the reference bot: a small game engine. Each turn it runs a
 * **beam search over whole-turn plans** (so it finds 2–3-action combos the greedy bot can't —
 * e.g. step into the cluster *then* sweep, or pommel-knockback a foe into a wall *then* finish
 * it), ranking partial plans by a cheap static evaluation, then re-evaluates the surviving
 * full-turn candidates with a **1-round rollout against a pessimistic opponent** (my scripted
 * allies move, the turn ends, and the opponent replies with the *worst-for-me* of a couple of
 * plausible enemy turns) and plays the best one.
 *
 * The evaluation is the actual "engine strength": team HP & body count (the `basicScore` core),
 * the hero weighted far above the interchangeable allies, hero "king safety" (incoming damage that
 * can reach the hero next turn), hero initiative (damage the hero can threaten), and enemy
 * clustering (free value for our AoE allies — there's no friendly fire). Weights live in
 * {@link DEFAULT_WEIGHTS} and are tuned by self-play (see `tune.ts`).
 */
import type { HeroController } from "../../src/types.js";
import type {
  AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction, TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { add, normalize, scale, sub } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, basicScore,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "../../src/toolkit.js";

// ---------------------------------------------------------------------------
// Tunable weights for the static evaluation. Self-play tuner adjusts these.
// ---------------------------------------------------------------------------

export interface Weights {
  /** Hero HP+barrier as a fraction of max — the irreplaceable piece. */
  heroHp: number;
  /** Penalty when the hero is dead (on top of losing its HP and the body-count term). */
  heroDead: number;
  /** Penalty per (incoming damage reachable to the hero next enemy turn) / heroMaxHp. */
  heroThreat: number;
  /** Bonus per (damage the hero can threaten next turn) / heroMaxHp. */
  heroOffense: number;
  /** Bonus for enemies bunched up (mean fraction of foes within an AoE radius of their centroid). */
  enemyCluster: number;
  /** Drift: penalty per (hero distance to nearest foe) / 1000, so the hero walks into the fight. */
  heroDrift: number;
  /** Cohesion: penalty per (hero distance to the ally centroid) / 1000 — fight as a pack, don't solo-kite. */
  heroCohesion: number;
  /** Bonus per ally HP+barrier fraction kept above the bare body-count term (keeping allies topped up). */
  allyHp: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  heroHp: 0.8,
  heroDead: 2.0,
  heroThreat: 0.45,
  heroOffense: 0.7,
  enemyCluster: 0.25,
  heroDrift: 1.1,
  heroCohesion: 0.8,
  allyHp: 0.15,
};

// ---------------------------------------------------------------------------
// Search parameters.
// ---------------------------------------------------------------------------

const MAX_STEPS = 6;          // hero abilities per turn (banked energy can buy ~5; cap a touch above)
const BEAM_WIDTH = 12;        // partial-turn plans kept between expansion rounds
const FINALISTS = 28;         // max full-turn candidates that get the (expensive) rollout eval
const AOE_RADIUS = 90;        // greatsword-sweep reach — the yardstick for "are the enemies clustered"
const KITE_RING = 0.85;       // when repositioning to fire, aim for this fraction of our attack range
const SAFETY_MS = 60;         // stop searching this far before the deadline

// ---------------------------------------------------------------------------

interface PartialPlan {
  state: GameState;           // board after the plan's actions, still our turn
  plan: PlayerAction[];       // hero actions so far (no endTurn)
  /** Once true the plan is "complete" — it survives to the next round unchanged and won't expand. */
  done: boolean;
}

export function makeSovereign(w: Weights): HeroController {
  return (ctx) => {
    const myTeam = teamOf(ctx.state, ctx.heroId);
    const heroStart = ctx.state.entities.get(ctx.heroId);
    if (!heroStart || heroStart.dead) return [];
    const deadline = ctx.deadlineMs - SAFETY_MS;
    const timeUp = () => Date.now() >= deadline;

    // --- phase 1: beam search over whole-turn plans, ranked by the cheap static eval ----------
    let beam: PartialPlan[] = [{ state: ctx.state, plan: [], done: false }];
    const finals: PartialPlan[] = [];

    for (let step = 0; step < MAX_STEPS && !timeUp(); step++) {
      const next: PartialPlan[] = [];
      let anyExpanded = false;
      for (const node of beam) {
        if (node.done || node.state.winner) { finals.push(node); continue; }
        // "stop here" is always an option.
        finals.push({ ...node, done: true });
        const hero = node.state.entities.get(ctx.heroId);
        if (!hero || hero.dead) continue;
        for (const action of heroCandidates(node.state, hero)) {
          if (timeUp()) break;
          const after = tryAction(node.state, action);
          if (!after) continue;
          anyExpanded = true;
          next.push({ state: after, plan: [...node.plan, action], done: !!after.winner });
        }
      }
      if (!anyExpanded) break;
      // keep the most promising partial plans (cheap eval — no rollout yet)
      next.sort((a, b) => staticEval(b.state, ctx.heroId, myTeam, w) - staticEval(a.state, ctx.heroId, myTeam, w));
      beam = next.slice(0, BEAM_WIDTH);
    }
    for (const node of beam) finals.push({ ...node, done: true });

    // dedup finals by their action signature, then keep the best handful by static eval
    const seen = new Set<string>();
    const uniqueFinals: PartialPlan[] = [];
    for (const f of finals) {
      const key = f.plan.map(sig).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueFinals.push(f);
    }
    uniqueFinals.sort((a, b) => staticEval(b.state, ctx.heroId, myTeam, w) - staticEval(a.state, ctx.heroId, myTeam, w));
    // always keep the "do nothing" plan in the running — passing can be the right answer and the
    // pre-reply static eval (drift / offense terms) would otherwise prune it before the rollout.
    const passNode: PartialPlan = { state: ctx.state, plan: [], done: true };
    const candidates = [passNode, ...uniqueFinals.filter(f => f.plan.length > 0)].slice(0, FINALISTS);

    // --- phase 2: rollout each finalist a round forward against a pessimistic opponent --------
    let best = passNode;
    let bestValue = -Infinity;
    for (const c of candidates) {
      const v = c.state.winner === myTeam ? 1e6 : rolloutValue(c.state, ctx.heroId, myTeam, w, timeUp);
      if (v > bestValue) { bestValue = v; best = c; }
      if (timeUp()) break;
    }
    return best.plan;
  };
}

/** Default export wrapper used by `index.ts`. */
export const sovereignHero: HeroController = makeSovereign(DEFAULT_WEIGHTS);

// ---------------------------------------------------------------------------
// Rollout: my allies move, the turn ends, the opponent replies with the worst (for me)
// of a few plausible enemy turns; score the resulting position.
// ---------------------------------------------------------------------------

function rolloutValue(state: GameState, heroId: EntityId, myTeam: TeamId, w: Weights, timeUp: () => boolean): number {
  const afterAllies = simulateMyAlliesTurn(state, heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  if (afterEnd.winner) return staticEval(afterEnd, heroId, myTeam, w);
  // pessimistic opponent: take the worst over a small set of plausible enemy turns.
  let worst = Infinity;
  for (const reply of opponentReplies(afterEnd, heroId, timeUp)) {
    const v = staticEval(reply, heroId, myTeam, w);
    if (v < worst) worst = v;
    if (timeUp()) break;
  }
  return Number.isFinite(worst) ? worst : staticEval(afterEnd, heroId, myTeam, w);
}

/** A couple of plausible whole-turn replies by the enemy side (whose hero brain we can't see). */
function opponentReplies(state: GameState, myHeroId: EntityId, timeUp: () => boolean): GameState[] {
  const out: GameState[] = [];
  // 1) everyone (including their hero) plays the stock scripted strategy — the safe baseline.
  out.push(simulateScriptedTurn(state));
  if (timeUp()) return out;
  // 2) their allies play scripted, but their hero goes all-in on *my* hero (charge + biggest hit).
  const enemyTeam: TeamId = state.activeTeam;
  const enemyHero = [...state.entities.values()].find(e => e.teamId === enemyTeam && !e.dead && e.id !== myHeroId && isHeroLike(e));
  if (enemyHero) {
    let s = greedyHuntTurn(state, enemyHero.id, myHeroId);
    for (const u of [...s.entities.values()].filter(e => e.teamId === enemyTeam && !e.dead && e.id !== enemyHero.id)
      .sort((a, b) => closest(a, s) - closest(b, s))) {
      if (s.entities.get(u.id)?.dead) continue;
      const live = s.entities.get(u.id)!;
      for (const action of strategyForEntity(live).planActions(live, s)) s = resolveAction(s, action);
    }
    out.push(resolveAction(s, { type: "endTurn" }));
  }
  return out;
}

/** The enemy hero, greedily: keep moving toward my hero and hitting it until out of energy / steps. */
function greedyHuntTurn(state: GameState, attackerId: EntityId, victimId: EntityId): GameState {
  let s = state;
  for (let step = 0; step < MAX_STEPS; step++) {
    const a = s.entities.get(attackerId);
    const v = s.entities.get(victimId);
    if (!a || a.dead || !v || v.dead) break;
    // try the biggest attack that connects with the victim
    let acted = false;
    const atks = attackAbilities(a).filter(x => canAffordAbility(a, x)).sort((x, y) => y.damage - x.damage);
    for (const atk of atks) {
      const aim = sub(v.position, a.position);
      if (!aim.x && !aim.y) continue;
      if (attackHits(s, a, atk, aim).some(h => h.id === victimId)) {
        const after = tryAction(s, { type: "ability", entityId: attackerId, abilityId: atk.id, aimDirection: aim });
        if (after) { s = after; acted = true; break; }
      }
    }
    if (acted) continue;
    // else step toward the victim
    const mv = moveAbility(a);
    if (mv && canAffordAbility(a, mv)) {
      const dest = pathToward(s, attackerId, v.position);
      if (dest) {
        const after = tryAction(s, { type: "ability", entityId: attackerId, abilityId: mv.id, destination: dest });
        if (after && after !== s) { s = after; continue; }
      }
    }
    break;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Candidate hero actions for one beam-expansion step.
// ---------------------------------------------------------------------------

function heroCandidates(state: GameState, hero: Entity): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // non-aimed abilities (shield block, etc.) — just cast them
  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a)) out.push({ type: "ability", entityId: hero.id, abilityId: a.id });
  }

  // attacks: aim at each foe, the cluster, and — for knockback moves — a few "slam" aims that
  // shove a foe toward a wall / map edge (the engine's physics gives bonus damage on a cut-short throw).
  const aimPoints: Vec2[] = [...enemies.map(e => e.position), cluster];
  for (const atk of atks) {
    const points = atk.knockback && atk.knockback > 0
      ? [...aimPoints, ...slamAimPoints(state, hero, enemies)]
      : aimPoints;
    const seenAim = new Set<string>();
    for (const targetPos of points) {
      const aim = sub(targetPos, hero.position);
      if (!aim.x && !aim.y) continue;
      const k = `${Math.round(Math.atan2(aim.y, aim.x) * 64)}`;
      if (seenAim.has(k)) continue;
      seenAim.add(k);
      if (attackHits(state, hero, atk, aim).length > 0) {
        out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
      }
    }
  }

  // moves: toward each foe / the cluster, a kite ring & a full retreat from the nearest foe, and
  // a bodyblock spot covering our weakest ally.
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const range = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const targets: Vec2[] = [...enemies.map(e => e.position), cluster];
    const away = normalize(sub(hero.position, near.position));
    if (away.x || away.y) {
      if (range > 1) targets.push(add(near.position, scale(away, range * KITE_RING)));
      targets.push(add(hero.position, scale(away, mv.distance)));
    }
    const block = bodyblockSpot(state, hero);
    if (block) targets.push(block);
    const seen = new Set<string>();
    for (const target of targets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x / 8)},${Math.round(dest.y / 8)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  return out;
}

/** Aim points that push the nearest few foes toward the closest wall / map edge. */
function slamAimPoints(state: GameState, hero: Entity, enemies: Entity[]): Vec2[] {
  const out: Vec2[] = [];
  const g = state.grid;
  const mapW = g.width * g.cellSize, mapH = g.height * g.cellSize;
  const sorted = [...enemies].sort((a, b) => dist(hero.position, a.position) - dist(hero.position, b.position)).slice(0, 3);
  for (const e of sorted) {
    // direction from hero through the foe is the knockback direction; we want a foe whose
    // continuation quickly meets an obstacle. Sample the four cardinal "toward the nearest edge"
    // intents by nudging the aim so the foe gets shoved that way.
    const edges: Vec2[] = [
      { x: 0, y: e.position.y }, { x: mapW, y: e.position.y },
      { x: e.position.x, y: 0 }, { x: e.position.x, y: mapH },
    ];
    let bestEdge: Vec2 | null = null, bestD = Infinity;
    for (const edge of edges) { const d = dist(e.position, edge); if (d < bestD) { bestD = d; bestEdge = edge; } }
    if (bestEdge && bestD < 160) {
      // we need the hero->foe line to point roughly at the edge; only useful if the hero is on the
      // far side. Aim "through" the foe toward the edge: pick the foe position offset toward the edge.
      const dir = normalize(sub(bestEdge, e.position));
      out.push(add(e.position, scale(dir, 1))); // aiming at the foe still knocks along hero->foe; this
      // is a cheap heuristic — the real check is attackHits + the eval after tryAction.
    }
    // also: aim that lines the foe up between the hero and another foe (knock one into the other).
    for (const o of enemies) {
      if (o.id === e.id) continue;
      // if hero, e, o are roughly colinear with e nearer, hitting e knocks it toward o.
      const he = normalize(sub(e.position, hero.position));
      const eo = normalize(sub(o.position, e.position));
      if (he.x * eo.x + he.y * eo.y > 0.6 && dist(e.position, o.position) < 80) out.push(e.position);
    }
  }
  return out;
}

/** A point that puts the hero between our lowest-HP ally and the nearest enemy to it (tank for it). */
function bodyblockSpot(state: GameState, hero: Entity): Vec2 | null {
  const allies = livingAllies(state, hero.id);
  if (allies.length === 0) return null;
  const weak = allies.reduce((a, b) => ((a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b));
  if ((weak.hp + weak.barrier) / weak.maxHp > 0.6) return null; // only bother when an ally is actually hurting
  const foes = livingEnemies(state, hero.id);
  const threat = nearest(weak.position, foes);
  if (!threat) return null;
  // a third of the way from the ally toward the threat
  return add(weak.position, scale(sub(threat.position, weak.position), 0.33));
}

// ---------------------------------------------------------------------------
// Evaluation.
// ---------------------------------------------------------------------------

/** Static board value from `myTeam`'s view. Used both mid-beam (rank partial plans) and as the
 *  rollout leaf. Roughly: `basicScore` + hero weighting + king-safety + initiative + clustering. */
export function staticEval(s: GameState, heroId: EntityId, myTeam: TeamId, w: Weights): number {
  let v = basicScore(s, myTeam);
  const hero = s.entities.get(heroId);
  if (!hero || hero.dead) {
    v -= w.heroDead;
  } else {
    const hpFrac = (hero.hp + hero.barrier) / hero.maxHp;
    v += w.heroHp * hpFrac;

    const enemies = livingEnemies(s, heroId);
    // king safety: damage that can reach the hero next enemy turn.
    let incoming = 0;
    for (const e of enemies) {
      const reach = enemyMoveReach(e) + enemyAttackReach(e);
      const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
      if (d <= reach) incoming += enemyBestDamage(e);
    }
    v -= w.heroThreat * (incoming / hero.maxHp);

    // initiative: damage the hero could threaten next turn (move + best attack).
    if (enemies.length > 0) {
      const myReach = enemyMoveReach(hero) + Math.max(0, ...attackAbilities(hero).map(attackRange));
      let threatenable = false;
      for (const e of enemies) {
        const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
        if (d <= myReach) { threatenable = true; break; }
      }
      if (threatenable) v += w.heroOffense * (enemyBestDamage(hero) / hero.maxHp);

      // drift toward the fight, and stay with the pack (don't solo-kite into a corner).
      let nearestD = Infinity;
      for (const e of enemies) nearestD = Math.min(nearestD, dist(e.position, hero.position));
      v -= w.heroDrift * (nearestD / 1000);
      const mates = [...s.entities.values()].filter(e => e.teamId === hero.teamId && !e.dead && e.id !== heroId);
      if (mates.length > 0) v -= w.heroCohesion * (dist(hero.position, centroid(mates)) / 1000);

      // enemy clustering — free value for our AoE allies.
      if (enemies.length > 1) {
        const c = centroid(enemies);
        let within = 0;
        for (const e of enemies) if (dist(e.position, c) <= AOE_RADIUS) within++;
        v += w.enemyCluster * (within / enemies.length);
      }
    }
  }
  // keeping the allies topped up (above the bare body-count term in basicScore).
  const allies = [...s.entities.values()].filter(e => e.teamId === myTeam && e.id !== heroId);
  if (allies.length > 0) {
    let hp = 0, max = 0;
    for (const e of allies) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
    if (max > 0) v += w.allyHp * (hp / max);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function isHeroLike(e: Entity): boolean {
  // the arena's heroes carry the greatsword kit; "greatsword-halfsword" is unique to it.
  return e.abilities.some(a => a.id === "greatsword-halfsword");
}

function enemyMoveReach(e: Entity): number {
  const mv = e.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  return mv ? getEffectiveDistance(e, mv.distance) : 0;
}
function enemyAttackReach(e: Entity): number {
  let r = 0;
  for (const a of e.abilities) if (a.kind === "attack") r = Math.max(r, attackRange(a as AttackAbility));
  return r;
}
function enemyBestDamage(e: Entity): number {
  let d = 0;
  for (const a of e.abilities) if (a.kind === "attack") d = Math.max(d, (a as AttackAbility).damage);
  return d;
}

function closest(e: Entity, s: GameState): number {
  let best = Infinity;
  for (const o of s.entities.values()) if (!o.dead && o.teamId !== e.teamId) best = Math.min(best, dist(e.position, o.position));
  return best;
}

function sig(a: PlayerAction): string {
  if (a.type === "endTurn") return "end";
  const aim = a.aimDirection ? `@${Math.round(Math.atan2(a.aimDirection.y, a.aimDirection.x) * 32)}` : "";
  const dst = a.destination ? `>${Math.round(a.destination.x / 8)},${Math.round(a.destination.y / 8)}` : "";
  return `${a.abilityId}${aim}${dst}`;
}
