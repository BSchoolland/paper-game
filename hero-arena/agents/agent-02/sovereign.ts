/**
 * Sovereign — agent-02's hero brain.
 *
 * A small game engine: beam-search over whole-turn plans, ranked by a cheap static eval, then the
 * surviving full-turn candidates get a 1-round rollout against a pessimistic opponent (my scripted
 * allies move, the turn ends, the opponent replies with the worst-for-me of a couple of plausible
 * enemy turns) and the best one is played.
 *
 * The same engine handles every Tournament-2 role (Tank / Fighter / Ranged / Boss / Solo) by
 * combining two pieces of config:
 *   - a {@link Weights} vector that controls the static evaluation (king-safety, initiative,
 *     clustering, drift/cohesion, ally-upkeep, hero-HP/dead);
 *   - a {@link SearchParams} struct that controls the search (beam width, finalists, max plan
 *     length, safety margin) — multi-hero formats give 2s budgets so each role can dial these
 *     down for efficiency.
 *
 * Presets for each role are exported below; the random-loadout Solo controller picks its preset
 * based on whether the abilities are ranged-leaning, mixed, or melee.
 */
import type { HeroController } from "../../src/types.js";
import type {
  AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction, TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { ShapeKind } from "../../../shared/src/core/types.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { add, normalize, scale, sub } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, pathFloodFor, basicScore,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "../../src/toolkit.js";

// ---------------------------------------------------------------------------
// Tunable weights for the static evaluation.
// ---------------------------------------------------------------------------

export interface Weights {
  /** Hero HP+barrier as a fraction of max — the irreplaceable piece. */
  heroHp: number;
  /** Penalty when the hero is dead (on top of losing its HP and the body-count term). */
  heroDead: number;
  /** Penalty per (incoming damage reachable to the hero next enemy turn) / hero.maxHp. */
  heroThreat: number;
  /** Bonus per (damage the hero can threaten next turn) / hero.maxHp. */
  heroOffense: number;
  /** Bonus per (damage dealt to the shared focus target this turn) / 100. Focus is the enemy hero
   *  in PvP, or the lowest-HP enemy in PvE — gives the 3 squad heroes implicit focus-fire coord. */
  enemyHeroSuppress: number;
  /** Bonus for enemies bunched up (mean fraction of foes within an AoE radius of their centroid). */
  enemyCluster: number;
  /** Drift: penalty per (hero distance to nearest foe) / 1000. Positive => walk into the fight. */
  heroDrift: number;
  /** Cohesion: penalty per (hero distance to ally centroid) / 1000 — fight as a pack. */
  heroCohesion: number;
  /** Bonus per ally HP+barrier fraction kept above the bare body-count term. */
  allyHp: number;
}

// ---------------------------------------------------------------------------
// Search parameters.
// ---------------------------------------------------------------------------

export interface SearchParams {
  /** Hero abilities to consider per turn. Banked energy bounds ~5; this caps the depth a touch above. */
  maxSteps: number;
  /** Partial-turn plans kept between expansion rounds. */
  beamWidth: number;
  /** Max full-turn candidates that get the (expensive) rollout eval. */
  finalists: number;
  /** Yardstick for "are the enemies clustered" — defaults to the hero's biggest AoE radius. */
  aoeRadius?: number;
  /** Stop searching this far before the deadline (ms). */
  safetyMs: number;
  /** When repositioning to fire, aim for this fraction of our attack range. */
  kiteRing: number;
  /** Randomly choose from the top-N fraction of scored plans (e.g. 0.20 = top 20%) instead of
   *  always picking the best. Pool size is `max(1, ceil(scored.length * topFraction))`. */
  topFraction: number;
  /** Self-imposed wall-clock cap per turn (ms). */
  softBudgetMs: number;
}

export const DEFAULT_PARAMS: SearchParams = {
  maxSteps: 6, beamWidth: 12, finalists: 28, safetyMs: 60, kiteRing: 0.85,
  topFraction: 0.20, softBudgetMs: 2000,
};
// Backwards-compat alias for older multi-hero contexts.
export const FAST_PARAMS: SearchParams = DEFAULT_PARAMS;

// ---------------------------------------------------------------------------
// Intelligence presets — same brain, dialled randomness band.
// ---------------------------------------------------------------------------
//
// All three share identical search settings; they differ only in how strict the picker is
// about choosing from the top-scored plans. Tighter band = stronger, more predictable.
// Wider band = more variance, occasional visible "mistakes" (plans the brain itself rated
// lower). Same compute cost, distinct playstyles.

export const PRESETS = {
  /** Wide pick (top 40%). Coherent but unpredictable — picks plans the brain rates well but not
   *  always the best. Use for low-tier mooks where "makes mistakes" is a feature. */
  crazy:   { ...DEFAULT_PARAMS, topFraction: 0.40 },
  /** Standard (top 20%). The default — strong, with subtle variance so the AI doesn't feel
   *  perfectly mechanical. Use for hirelings, generic competent NPCs, most enemies. */
  crafty:  { ...DEFAULT_PARAMS, topFraction: 0.20 },
  /** Tight (top 10%). Sharp picks, low variance. Use for bosses, named rivals, prestige fights. */
  genius:  { ...DEFAULT_PARAMS, topFraction: 0.10 },
} as const satisfies Record<string, SearchParams>;

export type IntelligencePreset = keyof typeof PRESETS;

// ---------------------------------------------------------------------------
// Weight presets per role.
// ---------------------------------------------------------------------------

// Fighter / default — the self-play-tuned values from the prior champion. focus-fire (formerly 0)
// is added as a coordination bonus when an enemy drops below 70% HP.
export const FIGHTER_WEIGHTS: Weights = {
  heroHp: 0.6,
  heroDead: 2.0,
  heroThreat: 0.563,
  heroOffense: 0.7,
  enemyHeroSuppress: 0.0,    // disabled — destabilizes positioning in PvE; enabled in raid presets
  enemyCluster: 0.25,
  heroDrift: 1.1,
  heroCohesion: 0.8,
  allyHp: 0.188,
};

// Tank (raid PvP) — survive, body-block, lead the line.
export const TANK_WEIGHTS: Weights = {
  heroHp: 0.9,
  heroDead: 2.5,
  heroThreat: 0.7,
  heroOffense: 0.55,
  enemyHeroSuppress: 0.4,
  enemyCluster: 0.2,
  heroDrift: 1.0,
  heroCohesion: 0.7,
  allyHp: 0.2,
};

// Ranged — kite at range, value clustering for AoE staff casts.
export const RANGED_WEIGHTS: Weights = {
  heroHp: 0.7,
  heroDead: 2.2,
  heroThreat: 0.85,       // cautious — a melee whack to a 120HP frame is bad
  heroOffense: 0.85,
  enemyHeroSuppress: 0.55,
  enemyCluster: 0.4,
  heroDrift: -0.15,       // very mild "prefer distance", don't flee off the map
  heroCohesion: 0.5,
  allyHp: 0.18,
};

// Boss — 300HP, 3 red / 3 blue. Threat/offense are /maxHp normalized, so for boss (/300) the
// raw weight values need to be larger to feel like equivalent fighter caution. With boss the
// raid heroes are squishies — high focus-fire and offense values pay off fast.
export const BOSS_WEIGHTS: Weights = {
  heroHp: 0.8,
  heroDead: 3.0,
  heroThreat: 1.0,
  heroOffense: 1.4,
  enemyHeroSuppress: 0.9,
  enemyCluster: 0.35,
  heroDrift: 0.9,
  heroCohesion: 0.4,
  allyHp: 0.1,
};

// Solo (melee-leaning kit) — no allies, so allyHp/cohesion vanish, drift positive (close the
// gap), heroHp / heroDead heavier because the hero is everything.
export const SOLO_MELEE_WEIGHTS: Weights = {
  heroHp: 0.9,
  heroDead: 3.0,
  heroThreat: 0.75,
  heroOffense: 0.85,
  enemyHeroSuppress: 0.0,    // one hero, no coordination — focus risks pulling toward a far target
  enemyCluster: 0.3,
  heroDrift: 1.0,
  heroCohesion: 0.0,
  allyHp: 0.0,
};

// Solo (ranged-leaning kit) — kite at range.
export const SOLO_RANGED_WEIGHTS: Weights = {
  heroHp: 0.9,
  heroDead: 3.0,
  heroThreat: 0.95,
  heroOffense: 1.0,
  enemyHeroSuppress: 0.0,
  enemyCluster: 0.4,
  heroDrift: -0.2,
  heroCohesion: 0.0,
  allyHp: 0.0,
};

// Backwards compat for tune.ts.
export const DEFAULT_WEIGHTS: Weights = FIGHTER_WEIGHTS;

// ---------------------------------------------------------------------------

interface PartialPlan {
  state: GameState;
  plan: PlayerAction[];
  done: boolean;
}

export function makeSovereign(w: Weights, params: SearchParams = DEFAULT_PARAMS): HeroController {
  return (ctx) => {
    const myTeam = teamOf(ctx.state, ctx.heroId);
    const heroStart = ctx.state.entities.get(ctx.heroId);
    if (!heroStart || heroStart.dead) return [];
    const start = Date.now();
    const softCap = params.softBudgetMs !== undefined ? start + params.softBudgetMs : ctx.deadlineMs;
    const deadline = Math.min(ctx.deadlineMs, softCap) - params.safetyMs;
    const timeUp = () => Date.now() >= deadline;
    // The clustering yardstick: this hero's biggest AoE radius (Sector/Circle), falling back to
    // 90 (greatsword) if the kit is point-only.
    const aoeRadius = params.aoeRadius ?? bestAoeRadius(heroStart) ?? 90;
    const focusId = findFocusTarget(ctx.state, myTeam, ctx.heroId);
    const focusBaselineHp = focusId
      ? ((ctx.state.entities.get(focusId)?.hp ?? 0) + (ctx.state.entities.get(focusId)?.barrier ?? 0))
      : 0;
    const ctxEval: EvalCtx = { heroId: ctx.heroId, myTeam, w, aoeRadius, focusId, focusBaselineHp };

    // --- phase 1: beam search over whole-turn plans ----------
    let beam: PartialPlan[] = [{ state: ctx.state, plan: [], done: false }];
    const finals: PartialPlan[] = [];

    for (let step = 0; step < params.maxSteps && !timeUp(); step++) {
      const next: PartialPlan[] = [];
      let anyExpanded = false;
      for (const node of beam) {
        if (node.done || node.state.winner) { finals.push(node); continue; }
        finals.push({ ...node, done: true });
        const hero = node.state.entities.get(ctx.heroId);
        if (!hero || hero.dead) continue;
        for (const action of heroCandidates(node.state, hero, params.kiteRing)) {
          if (timeUp()) break;
          const after = tryAction(node.state, action);
          if (!after) continue;
          anyExpanded = true;
          next.push({ state: after, plan: [...node.plan, action], done: !!after.winner });
        }
      }
      if (!anyExpanded) break;
      next.sort((a, b) => staticEval(b.state, ctxEval) - staticEval(a.state, ctxEval));
      beam = next.slice(0, params.beamWidth);
    }
    for (const node of beam) finals.push({ ...node, done: true });

    const seen = new Set<string>();
    const uniqueFinals: PartialPlan[] = [];
    for (const f of finals) {
      const key = f.plan.map(sig).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueFinals.push(f);
    }
    uniqueFinals.sort((a, b) => staticEval(b.state, ctxEval) - staticEval(a.state, ctxEval));
    const passNode: PartialPlan = { state: ctx.state, plan: [], done: true };
    const candidates = [passNode, ...uniqueFinals.filter(f => f.plan.length > 0)].slice(0, params.finalists);

    // --- phase 2: rollout each finalist ----------
    let scored: Array<{ plan: PartialPlan; value: number }> = [];
    for (const c of candidates) {
      const v = c.state.winner === myTeam ? 1e6 : rolloutValue(c.state, ctxEval, timeUp);
      scored.push({ plan: c, value: v });
      if (timeUp()) break;
    }
    if (scored.length === 0) return passNode.plan;

    scored.sort((a, b) => b.value - a.value);
    const topN = Math.max(1, Math.ceil(scored.length * params.topFraction));
    const pool = scored.slice(0, Math.min(topN, scored.length));
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    return pick.plan.plan;
  };
}

/** Default export wrapper used by `index.ts` and `tune.ts`. */
export const sovereignHero: HeroController = makeSovereign(FIGHTER_WEIGHTS);

// ---------------------------------------------------------------------------
// Rollout
// ---------------------------------------------------------------------------

interface EvalCtx {
  heroId: EntityId;
  myTeam: TeamId;
  w: Weights;
  aoeRadius: number;
  focusId: EntityId | null;
  focusBaselineHp: number;
}

function rolloutValue(state: GameState, ec: EvalCtx, timeUp: () => boolean): number {
  const afterAllies = simulateMyAlliesTurn(state, ec.heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  if (afterEnd.winner) return staticEval(afterEnd, ec);
  let worst = Infinity;
  for (const reply of opponentReplies(afterEnd, ec.heroId, timeUp)) {
    const v = staticEval(reply, ec);
    if (v < worst) worst = v;
    if (timeUp()) break;
  }
  return Number.isFinite(worst) ? worst : staticEval(afterEnd, ec);
}

function opponentReplies(state: GameState, myHeroId: EntityId, timeUp: () => boolean): GameState[] {
  const out: GameState[] = [];
  out.push(simulateScriptedTurn(state));
  if (timeUp()) return out;
  const enemyTeam: TeamId = state.activeTeam;
  const enemyHero = [...state.entities.values()].find(
    e => e.teamId === enemyTeam && !e.dead && e.id !== myHeroId && isHeroLike(e)
  );
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

function greedyHuntTurn(state: GameState, attackerId: EntityId, victimId: EntityId): GameState {
  let s = state;
  for (let step = 0; step < 6; step++) {
    const a = s.entities.get(attackerId);
    const v = s.entities.get(victimId);
    if (!a || a.dead || !v || v.dead) break;
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

function heroCandidates(state: GameState, hero: Entity, kiteRing: number): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // non-aimed abilities (block / shield-wall / etc.) — just cast them
  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a)) {
      out.push({ type: "ability", entityId: hero.id, abilityId: a.id });
    }
  }

  // attacks: aim at each foe + the cluster + slam-points (knockback abilities).
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

  // moves
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const range = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const targets: Vec2[] = [...enemies.map(e => e.position), cluster];
    const away = normalize(sub(hero.position, near.position));
    if (away.x || away.y) {
      if (range > 1) targets.push(add(near.position, scale(away, range * kiteRing)));
      targets.push(add(hero.position, scale(away, mv.distance)));
    }
    // Short-step candidates (≤ half the move distance → 1 blue cost). Lets plans combine
    // a small advance with a barrier/attack on the same turn.
    const shortStep = Math.max(40, Math.floor(mv.distance / 2) - 5);
    const towardCluster = normalize(sub(cluster, hero.position));
    if (towardCluster.x || towardCluster.y) {
      targets.push(add(hero.position, scale(towardCluster, shortStep)));
    }
    const towardNear = normalize(sub(near.position, hero.position));
    if (towardNear.x || towardNear.y) {
      targets.push(add(hero.position, scale(towardNear, shortStep)));
    }
    const block = bodyblockSpot(state, hero);
    if (block) targets.push(block);
    // One Dijkstra flood from the hero answers every target lookup below.
    const fc = pathFloodFor(state, hero.id);
    if (fc) {
      const seen = new Set<string>();
      for (const target of targets) {
        const dest = fc.flood.pathTo(target, fc.cap);
        if (!dest) continue;
        const k = `${Math.round(dest.x / 8)},${Math.round(dest.y / 8)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
      }
    }
  }
  return out;
}

function slamAimPoints(state: GameState, hero: Entity, enemies: Entity[]): Vec2[] {
  const out: Vec2[] = [];
  const g = state.grid;
  const mapW = g.width * g.cellSize, mapH = g.height * g.cellSize;
  const sorted = [...enemies].sort((a, b) => dist(hero.position, a.position) - dist(hero.position, b.position)).slice(0, 3);
  for (const e of sorted) {
    const edges: Vec2[] = [
      { x: 0, y: e.position.y }, { x: mapW, y: e.position.y },
      { x: e.position.x, y: 0 }, { x: e.position.x, y: mapH },
    ];
    let bestEdge: Vec2 | null = null, bestD = Infinity;
    for (const edge of edges) { const d = dist(e.position, edge); if (d < bestD) { bestD = d; bestEdge = edge; } }
    if (bestEdge && bestD < 160) {
      const dir = normalize(sub(bestEdge, e.position));
      out.push(add(e.position, scale(dir, 1)));
    }
    for (const o of enemies) {
      if (o.id === e.id) continue;
      const he = normalize(sub(e.position, hero.position));
      const eo = normalize(sub(o.position, e.position));
      if (he.x * eo.x + he.y * eo.y > 0.6 && dist(e.position, o.position) < 80) out.push(e.position);
    }
  }
  return out;
}

function bodyblockSpot(state: GameState, hero: Entity): Vec2 | null {
  const allies = livingAllies(state, hero.id);
  if (allies.length === 0) return null;
  const weak = allies.reduce((a, b) => ((a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b));
  if ((weak.hp + weak.barrier) / weak.maxHp > 0.6) return null;
  const foes = livingEnemies(state, hero.id);
  const threat = nearest(weak.position, foes);
  if (!threat) return null;
  return add(weak.position, scale(sub(threat.position, weak.position), 0.33));
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function staticEval(s: GameState, ec: EvalCtx): number {
  const { heroId, myTeam, w, aoeRadius } = ec;
  let v = basicScore(s, myTeam);
  const hero = s.entities.get(heroId);
  if (!hero || hero.dead) {
    v -= w.heroDead;
  } else {
    const hpFrac = (hero.hp + hero.barrier) / hero.maxHp;
    v += w.heroHp * hpFrac;

    const enemies = livingEnemies(s, heroId);
    let incoming = 0;
    for (const e of enemies) {
      const reach = enemyMoveReach(e) + enemyAttackReach(e);
      const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
      if (d <= reach) incoming += enemyBestDamage(e);
    }
    v -= w.heroThreat * (incoming / hero.maxHp);

    if (enemies.length > 0) {
      const myReach = enemyMoveReach(hero) + Math.max(0, ...attackAbilities(hero).map(attackRange));
      let threatenable = false;
      for (const e of enemies) {
        const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
        if (d <= myReach) { threatenable = true; break; }
      }
      if (threatenable) v += w.heroOffense * (enemyBestDamage(hero) / hero.maxHp);

      let nearestD = Infinity;
      for (const e of enemies) nearestD = Math.min(nearestD, dist(e.position, hero.position));
      v -= w.heroDrift * (nearestD / 1000);
      const mates = [...s.entities.values()].filter(e => e.teamId === hero.teamId && !e.dead && e.id !== heroId);
      if (mates.length > 0) v -= w.heroCohesion * (dist(hero.position, centroid(mates)) / 1000);

      if (enemies.length > 1) {
        const c = centroid(enemies);
        let within = 0;
        for (const e of enemies) if (dist(e.position, c) <= aoeRadius) within++;
        v += w.enemyCluster * (within / enemies.length);
      }
    }
  }

  // Focus-fire bonus — damage we've dealt to the shared focus target this turn (vs baseline).
  // In PvP this is the enemy hero; in PvE it's the lowest-HP enemy. All squad heroes compute the
  // same focus deterministically from the (sequentially-mutated) state, giving implicit coordination.
  if (ec.focusId) {
    const f = s.entities.get(ec.focusId);
    if (!f || f.dead) v += w.enemyHeroSuppress * 1.0;
    else v += w.enemyHeroSuppress * Math.max(0, ec.focusBaselineHp - (f.hp + f.barrier)) / 100;
  }

  const allies = [...s.entities.values()].filter(e => e.teamId === myTeam && e.id !== heroId);
  if (allies.length > 0) {
    let hp = 0, max = 0;
    for (const e of allies) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
    if (max > 0) v += w.allyHp * (hp / max);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Heroes are 120+HP units in the arena; goblins/slimes/etc. are <80. Some enemy bosses (Stone
 *  Golem 220, Massive Slime 360) also clear 120 — they're hero-equivalent for "hunt the king"
 *  purposes anyway, so the rollout's greedy-hunt-the-hero reply works on them too.
 */
function isHeroLike(e: Entity): boolean {
  // Heroes are flagged with strategy === "smart" (or left undefined on legacy templates).
  // HP fallback catches any miswired template — old name-sniffing fallbacks live in git history.
  if (e.strategy === "smart" || e.strategy === undefined) return true;
  return e.maxHp >= 120;
}

function findFocusTarget(s: GameState, myTeam: TeamId, myHeroId: EntityId): EntityId | null {
  // Prefer a heavy opponent (heroes 120+, enemy bosses Stone Golem 220+, Massive Slime 360+).
  // Otherwise fall back to a meaningfully-wounded enemy (<70% HP) — focus-fire to finish off
  // pieces. Skipped if no one is wounded so the bonus doesn't bias against full-HP foes; with
  // sequential hero turns this kicks in naturally after the first attack lands.
  let heavy: Entity | null = null, wounded: Entity | null = null;
  for (const e of s.entities.values()) {
    if (e.teamId === myTeam || e.id === myHeroId || e.dead) continue;
    if (e.maxHp >= 120) {
      if (!heavy || e.maxHp > heavy.maxHp) heavy = e;
    } else if ((e.hp + e.barrier) < e.maxHp * 0.7) {
      const hp = e.hp + e.barrier;
      const w = wounded ? wounded.hp + wounded.barrier : Infinity;
      if (hp < w) wounded = e;
    }
  }
  return (heavy ?? wounded)?.id ?? null;
}

/** Biggest AoE footprint in the kit (Sector radius, Circle radius). Used as the clustering
 *  yardstick so a tiny pommel kit doesn't compare itself to a wide sweep. */
export function bestAoeRadius(hero: Entity): number | null {
  let best = 0;
  for (const a of hero.abilities) {
    if (a.kind !== "attack") continue;
    const s = a.shape;
    if (s.kind === ShapeKind.Sector) best = Math.max(best, s.radius);
    else if (s.kind === ShapeKind.Circle) best = Math.max(best, s.radius);
  }
  return best > 0 ? best : null;
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
