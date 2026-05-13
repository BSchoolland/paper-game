/**
 * Helpers for hero bots. All of these wrap the real engine and never mutate anything — pass a
 * state in, get a (new) state or a value out. Import what you need:
 *
 *   import { resolveAction, pathToward, simulateScriptedTurn, livingEnemies, aimAt } from "../../src/toolkit.js";
 */
import {
  resolveAction as engineResolve,
  pathfindMove,
  getEffectiveDistance,
  getTemplateRegistry,
} from "../../shared/src/index.js";
import type {
  AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction, TeamId, Vec2,
} from "../../shared/src/index.js";
import { ShapeKind } from "../../shared/src/core/types.js";
import { resolveWeaponAttack } from "../../shared/src/combat/combat.js";
import { strategyForEntity } from "../../shared/src/ai/strategy.js";

// --- the engine, re-exported -----------------------------------------------

/** Run an action against `s`; returns the resulting state, or the SAME object `s` if rejected. */
export function resolveAction(s: GameState, action: PlayerAction): GameState {
  return engineResolve(s, action).state;
}

/** Like {@link resolveAction} but returns `null` instead of the unchanged state on rejection. */
export function tryAction(s: GameState, action: PlayerAction): GameState | null {
  const next = engineResolve(s, action).state;
  return next === s ? null : next;
}

// --- board queries ---------------------------------------------------------

export function entity(s: GameState, id: EntityId): Entity | undefined { return s.entities.get(id); }
export function teamOf(s: GameState, id: EntityId): TeamId { return s.entities.get(id)!.teamId; }

export function livingAllies(s: GameState, of: EntityId): Entity[] {
  const team = teamOf(s, of);
  return [...s.entities.values()].filter(e => !e.dead && e.teamId === team && e.id !== of);
}
export function livingEnemies(s: GameState, of: EntityId): Entity[] {
  const team = teamOf(s, of);
  return [...s.entities.values()].filter(e => !e.dead && e.teamId !== team);
}
export function livingTeam(s: GameState, team: TeamId): Entity[] {
  return [...s.entities.values()].filter(e => !e.dead && e.teamId === team);
}
export function nearest(from: Vec2, candidates: Entity[]): Entity | null {
  let best: Entity | null = null, bestD = Infinity;
  for (const c of candidates) { const d = dist(from, c.position); if (d < bestD) { bestD = d; best = c; } }
  return best;
}
export function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export function centroid(es: Entity[]): Vec2 {
  let x = 0, y = 0; for (const e of es) { x += e.position.x; y += e.position.y; }
  return { x: x / es.length, y: y / es.length };
}

// --- abilities -------------------------------------------------------------

export function moveAbility(e: Entity): MoveAbility | null {
  const a = e.abilities.find(a => a.kind === "move"); return a ? a as MoveAbility : null;
}
export function attackAbilities(e: Entity): AttackAbility[] {
  return e.abilities.filter(a => a.kind === "attack") as AttackAbility[];
}
export function attackRange(a: AttackAbility): number {
  switch (a.shape.kind) {
    case ShapeKind.Point: return a.shape.range;
    case ShapeKind.Sector: return a.shape.radius;
    case ShapeKind.Rectangle: return a.shape.length;
    case ShapeKind.Circle: return a.shape.range + a.shape.radius;
  }
}
/** An `ability` action aiming `attackerId`'s `abilityId` straight at `target`. */
export function aimAt(attackerId: EntityId, abilityId: string, attackerPos: Vec2, target: Vec2): PlayerAction {
  return { type: "ability", entityId: attackerId, abilityId, aimDirection: { x: target.x - attackerPos.x, y: target.y - attackerPos.y } };
}
/** Which entities (foes only) would `attacker` firing `ability` aimed at `aim` actually hit, in `s`? */
export function attackHits(s: GameState, attacker: Entity, ability: AttackAbility, aim: Vec2): Entity[] {
  if (!aim.x && !aim.y) return [];
  return resolveWeaponAttack(attacker, aim, s.entities, ability, s.grid);
}

// --- movement --------------------------------------------------------------

/** A* a reachable point toward `target` for `entityId`, capped to its (status-adjusted) move range
 *  unless you pass `maxDistance`. Returns `null` if it can't make meaningful progress. */
export function pathToward(s: GameState, entityId: EntityId, target: Vec2, maxDistance?: number): Vec2 | null {
  const e = s.entities.get(entityId);
  if (!e) return null;
  const mv = moveAbility(e);
  const cap = maxDistance ?? (mv ? getEffectiveDistance(e, mv.distance) : 0);
  if (cap < 1) return null;
  return pathfindMove(e, target, s.grid, s.entities, cap);
}

// --- simulating the scripted units -----------------------------------------

/**
 * Play the *active team's* whole turn the way the engine's `AiController` would — treating every
 * unit on that team (including its hero!) as one of the dumb scripted strategies — then end the
 * turn. Returns the resulting state (turn now on the other side, or `state.winner` set).
 *
 * Use it to predict what the opponent's dumb allies will do, and — as a baseline — what the
 * opponent's hero will do (you can't see their brain; "assume they're scripted" is the safe default).
 */
export function simulateScriptedTurn(state: GameState): GameState {
  return resolveAction(runScriptedActions(state, state.activeTeam, null), { type: "endTurn" });
}

/**
 * Like {@link simulateScriptedTurn} but only runs the scripted allies of `heroId` (NOT the hero,
 * NOT `endTurn`) — i.e. "if I freeze the board here, what do my dumb teammates do this turn?".
 * Apply your candidate hero actions first, then call this to see the team state your turn ends in.
 */
export function simulateMyAlliesTurn(state: GameState, heroId: EntityId): GameState {
  return runScriptedActions(state, teamOf(state, heroId), heroId);
}

function runScriptedActions(state: GameState, team: TeamId, excludeId: EntityId | null): GameState {
  // Mirrors AiController: act in order of closeness to the nearest enemy; thread state forward.
  const units = [...state.entities.values()]
    .filter(e => e.teamId === team && !e.dead && e.id !== excludeId)
    .sort((a, b) => closestEnemyDist(a, state) - closestEnemyDist(b, state));
  let s = state;
  for (const u0 of units) {
    if (s.entities.get(u0.id)?.dead) continue;
    for (const action of strategyForEntity(u0).planActions(u0, s)) s = resolveAction(s, action);
  }
  return s;
}
function closestEnemyDist(e: Entity, s: GameState): number {
  let best = Infinity;
  for (const o of s.entities.values()) if (!o.dead && o.teamId !== e.teamId) best = Math.min(best, dist(e.position, o.position));
  return best;
}

// --- evaluation building block ---------------------------------------------

/** Current HP + barrier for a living entity, plus the HP of anything it spawns on death.
 *  For a dead entity returns 0. This prevents evals from seeing a kill as "bad" when the
 *  target splits into weaker units (e.g. big-slime → 2× slime). */
export function effectiveHp(e: Entity): number {
  if (e.dead) return 0;
  let hp = e.hp + e.barrier;
  const reg = getTemplateRegistry();
  if (reg) {
    for (const fx of e.effects ?? [])
      if (fx.trigger === "onDeath" && fx.action.type === "spawn")
        hp += fx.action.count * (reg[fx.action.templateKey]?.hp ?? 0);
  }
  return hp;
}

/**
 * A simple, symmetric board score from `team`'s point of view, in roughly [-2, +2]: team HP%
 * differential, plus a bonus for the alive-unit-count differential, plus a decisive ±10 for a
 * settled battle. A fine default leaf eval — but the *interesting* bots will weight the hero (the
 * irreplaceable piece) above the dumb allies, value orchestrating allies, etc.
 */
export function basicScore(s: GameState, team: TeamId): number {
  const foe: TeamId = team === "red" ? "blue" : "red";
  let ourHp = 0, ourMax = 0, ourAlive = 0, ourTot = 0, foeHp = 0, foeMax = 0, foeAlive = 0, foeTot = 0;
  for (const e of s.entities.values()) {
    const hp = e.dead ? 0 : effectiveHp(e);
    if (e.teamId === team) { ourMax += e.maxHp; ourHp += hp; ourTot++; if (!e.dead) ourAlive++; }
    else { foeMax += e.maxHp; foeHp += hp; foeTot++; if (!e.dead) foeAlive++; }
  }
  let v = (ourMax ? ourHp / ourMax : 0) - (foeMax ? foeHp / foeMax : 0);
  v += 0.7 * ((ourTot ? ourAlive / ourTot : 0) - (foeTot ? foeAlive / foeTot : 0));
  if (s.winner === team) v += 10; else if (s.winner === foe) v -= 10;
  return v;
}
