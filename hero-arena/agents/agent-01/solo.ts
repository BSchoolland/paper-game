/**
 * Solo PvE hero brain.
 *
 * Whole-turn beam search with broad candidate generation and a PvE-tuned leaf eval. The eval
 * weights enemy kills (each dead enemy = one fewer turn of incoming damage) much more than raw
 * HP%, and treats the hero as irreplaceable. After every candidate plan we simulate the enemy's
 * scripted reply so we don't walk into focus-fire range.
 */
import type { HeroContext, HeroController } from "../../src/types.js";
import type { AbilityDefinition, AttackAbility, Entity, EntityId, GameState, PlayerAction, TeamId, Vec2 } from "../../../shared/src/index.js";
import { canAffordAbility } from "../../../shared/src/index.js";
import { add, normalize, scale, sub } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, effectiveHp, simulateScriptedTurn,
} from "../../src/toolkit.js";

const MAX_DEPTH = 4;
const BEAM_WIDTH = 4;
const KITE_RING = 0.85;
const SAFETY_MARGIN_MS = 300; // reserve for outer harness overhead

// Cheap candidate cap per beam node — keep generation broad but evaluation focused.
const PER_NODE_CANDIDATE_CAP = 22;

interface Node {
  state: GameState;
  actions: PlayerAction[];
  cachedScore?: number;
}

export const soloHero: HeroController = (ctx) => {
  return planSoloTurn(ctx);
};

export function planSoloTurn(ctx: HeroContext): PlayerAction[] {
  const heroId = ctx.heroId;
  const team = teamOf(ctx.state, heroId);
  const deadline = ctx.deadlineMs - SAFETY_MARGIN_MS;

  // Take a quick read of the initial enemy stats for accurate kill-counting in the eval.
  const initialEnemyStats = snapshotEnemies(ctx.state, team);

  const evalNode = (n: Node): number => {
    if (n.cachedScore !== undefined) return n.cachedScore;
    n.cachedScore = leafEval(n.state, heroId, team, initialEnemyStats);
    return n.cachedScore;
  };

  let beam: Node[] = [{ state: ctx.state, actions: [] }];
  let bestNode: Node = beam[0]!;
  let bestScore = evalNode(bestNode);

  // Warm-start: run a quick greedy plan so we always have a sensible fallback if the search
  // gets time-starved before it can expand a single beam node.
  const warmPlan = greedyPlan(ctx.state, heroId, deadline);
  if (warmPlan.state !== ctx.state) {
    const wScore = evalNode(warmPlan);
    if (wScore > bestScore) { bestScore = wScore; bestNode = warmPlan; }
    beam.push(warmPlan);
  }

  outer: for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (Date.now() > deadline) break;
    const next: Node[] = [];
    let expanded = false;
    for (const node of beam) {
      const hero = node.state.entities.get(heroId);
      if (!hero || hero.dead || node.state.winner) continue;
      const candidates = soloCandidates(node.state, hero).slice(0, PER_NODE_CANDIDATE_CAP);
      for (const a of candidates) {
        if (Date.now() > deadline) break outer;
        const after = tryAction(node.state, a);
        if (!after) continue;
        expanded = true;
        const child: Node = { state: after, actions: [...node.actions, a] };
        const s = evalNode(child);
        if (s > bestScore) { bestScore = s; bestNode = child; }
        next.push(child);
      }
    }
    if (!expanded) break;
    next.sort((a, b) => evalNode(b) - evalNode(a));
    beam = next.slice(0, BEAM_WIDTH);
  }

  return bestNode.actions;
};

/** Fast greedy plan: repeatedly take the single action that fires this hero's biggest landed
 *  attack at the enemy with the lowest HP; otherwise close distance. Used as a warm-start so the
 *  beam search has a sensible baseline if its budget evaporates. */
function greedyPlan(state: GameState, heroId: EntityId, deadline: number): Node {
  let s = state;
  const actions: PlayerAction[] = [];
  for (let step = 0; step < 5; step++) {
    if (Date.now() > deadline) break;
    const hero = s.entities.get(heroId);
    if (!hero || hero.dead || s.winner) break;
    const enemies = livingEnemies(s, heroId);
    if (enemies.length === 0) break;
    const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

    // Try every (attack, target) and pick the one that deals the most TOTAL damage; ties broken
    // by killing-blow preference (any hit that brings target to ≤0 hp).
    let bestAction: PlayerAction | null = null;
    let bestScore = -Infinity;
    for (const atk of atks) {
      for (const target of enemies) {
        const aim = sub(target.position, hero.position);
        if (!aim.x && !aim.y) continue;
        const hits = attackHits(s, hero, atk, aim);
        if (hits.length === 0) continue;
        // Each hit's damage = atk.damage; killed = hit's hp - barrier - damage <= 0.
        let killBonus = 0;
        for (const h of hits) {
          if (h.hp + h.barrier - atk.damage <= 0) killBonus += 100;
        }
        const score = hits.length * atk.damage + killBonus;
        if (score > bestScore) { bestScore = score; bestAction = { type: "ability", entityId: heroId, abilityId: atk.id, aimDirection: aim }; }
      }
    }
    // If no attack lands, try to close.
    if (!bestAction) {
      const mv = moveAbility(hero);
      if (!mv || !canAffordAbility(hero, mv)) break;
      const near = nearest(hero.position, enemies)!;
      const dest = pathToward(s, hero.id, near.position);
      if (!dest) break;
      bestAction = { type: "ability", entityId: heroId, abilityId: mv.id, destination: dest };
    }
    const after = tryAction(s, bestAction);
    if (!after) break;
    s = after;
    actions.push(bestAction);
  }
  return { state: s, actions };
}

// ── Candidate generation ─────────────────────────────────────────────────────

function soloCandidates(state: GameState, hero: Entity): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const cluster = centroid(enemies);
  const near = nearest(hero.position, enemies)!;
  const atks: AttackAbility[] = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // Barriers: always consider — Block, Shield Wall, etc.
  for (const a of hero.abilities)
    if (a.kind === "barrier" && canAffordAbility(hero, a))
      out.push({ type: "ability", entityId: hero.id, abilityId: a.id });

  // Attacks: aim at each enemy, plus pair midpoints, plus cluster, plus "best aim" hill-climb.
  const aimTargets: Vec2[] = enemies.map(e => e.position);
  if (enemies.length > 1) {
    aimTargets.push(cluster);
    // Pair midpoints between the 4 closest enemies — tries to catch multi-hits with AoE.
    const sorted = [...enemies].sort((a, b) => dist(hero.position, a.position) - dist(hero.position, b.position)).slice(0, 4);
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!.position, b = sorted[j]!.position;
        aimTargets.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
  }

  for (const atk of atks) {
    let bestHitCount = 0;
    const seenAims = new Set<string>();
    for (const tp of aimTargets) {
      const aim = sub(tp, hero.position);
      if (!aim.x && !aim.y) continue;
      const hits = attackHits(state, hero, atk, aim);
      if (hits.length === 0) continue;
      const ang = Math.round(Math.atan2(aim.y, aim.x) * 100) / 100;
      const key = `${atk.id}@${ang}`;
      if (seenAims.has(key)) continue;
      seenAims.add(key);
      out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
      if (hits.length > bestHitCount) bestHitCount = hits.length;
    }
  }

  // Moves: toward each enemy, cluster, kite ring at our max attack range, full retreat from nearest.
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const range = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const moveTargets: Vec2[] = [...enemies.map(e => e.position), cluster];
    const away = normalize(sub(hero.position, near.position));
    if (away.x || away.y) {
      if (range > 1) moveTargets.push(add(near.position, scale(away, range * KITE_RING)));
      moveTargets.push(add(hero.position, scale(away, mv.distance)));
    }
    // Also: a "short step" toward the cluster keyed off blue economy (since short moves are 1 blue).
    const towardCluster = normalize(sub(cluster, hero.position));
    if (towardCluster.x || towardCluster.y)
      moveTargets.push(add(hero.position, scale(towardCluster, 60)));

    const seen = new Set<string>();
    for (const target of moveTargets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x / 10)},${Math.round(dest.y / 10)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  return out;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

interface EnemySnap { id: EntityId; hp: number; maxHp: number; }

function snapshotEnemies(s: GameState, myTeam: TeamId): EnemySnap[] {
  const out: EnemySnap[] = [];
  for (const e of s.entities.values())
    if (e.teamId !== myTeam) out.push({ id: e.id, hp: e.dead ? 0 : effectiveHp(e), maxHp: e.maxHp });
  return out;
}

/**
 * Leaf eval after the candidate plan + the enemy's scripted reply.
 *
 * Components (rough scale):
 *   +10 if we've already won
 *   -1000 if the hero is dead (irreplaceable)
 *   per enemy killed: +3 (a dead enemy is a deleted turn — far better than partial damage)
 *   per enemy damaged: + (hpLost / maxHp) * 1.5
 *   hero hp + barrier fraction * 1.0
 *   minor positional drift toward the cluster so we don't idle out of range
 */
function leafEval(state: GameState, heroId: EntityId, team: TeamId, initialEnemies: EnemySnap[]): number {
  const foe: TeamId = team === "red" ? "blue" : "red";
  const myHeroPre = state.entities.get(heroId);

  // Compute pre-reply nearest-enemy distance and max effective attack range for the hero.
  let preDistToNearest = Infinity;
  if (myHeroPre && !myHeroPre.dead) {
    for (const e of state.entities.values())
      if (!e.dead && e.teamId !== team) preDistToNearest = Math.min(preDistToNearest, dist(e.position, myHeroPre.position));
  }
  if (!Number.isFinite(preDistToNearest)) preDistToNearest = 0;

  let maxRange = 0;
  if (myHeroPre) {
    for (const a of myHeroPre.abilities) {
      if (a.kind === "attack") maxRange = Math.max(maxRange, attackRange(a));
    }
  }

  // Roll forward: end my turn, then the enemy's scripted reply.
  let afterReply: GameState = state;
  if (!afterReply.winner) {
    afterReply = resolveAction(afterReply, { type: "endTurn" });
    if (!afterReply.winner) afterReply = simulateScriptedTurn(afterReply);
  }

  if (afterReply.winner === team) return 1e6;
  if (afterReply.winner === foe) return -1e6;

  const hero = afterReply.entities.get(heroId);
  if (!hero || hero.dead) return -1e5;

  let kills = 0;
  let damageFrac = 0;
  for (const snap of initialEnemies) {
    const cur = afterReply.entities.get(snap.id);
    const curHp = !cur || cur.dead ? 0 : effectiveHp(cur);
    if (snap.hp > 0 && curHp === 0) kills++;
    if (snap.maxHp > 0) damageFrac += Math.max(0, (snap.hp - curHp) / snap.maxHp);
  }

  const heroFrac = (hero.hp + hero.barrier) / hero.maxHp;

  // Distance pressure: pull the hero forward when nothing else differentiates.
  // Ranged kits stay back a touch; melee kits charge in.
  const rangePref = maxRange > 200 ? 0.5 : 1.0;
  const distWeight = 0.003 * rangePref;

  return (
    kills * 3.0 +
    damageFrac * 1.5 +
    heroFrac * 1.2 -
    preDistToNearest * distWeight
  );
}

// ── Adapter for the MultiFormatAgent.solo factory ────────────────────────────

export function makeSoloController(_abilities: AbilityDefinition[]): HeroController {
  // The candidate generator already inspects the hero's actual abilities every turn, so we don't
  // need to special-case by ability kit at construction time. The hook is reserved for opening books.
  return soloHero;
}
