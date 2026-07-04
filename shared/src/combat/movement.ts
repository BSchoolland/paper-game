import type { Entity, GameState, GridState, MoveAbility, Vec2 } from "../core/types.js";
import { canAffordAbility, getAbilityCost } from "./ability-cost.js";
import { getEffectiveDistance } from "./status-modifiers.js";
import { isPositionWalkable, isWithinBounds } from "../map/collision-grid.js";

/** The radius used for movement/occupancy: the optional smaller `moveRadius` if set, else the
 *  hurtbox `collisionRadius`. Use this everywhere a unit is being placed/pathed/stood, never the raw
 *  `collisionRadius` (which stays the combat hurtbox). */
export function moveRadiusOf(entity: Pick<Entity, "collisionRadius" | "moveRadius">): number {
  return entity.moveRadius ?? entity.collisionRadius;
}

/** Flat typed-array snapshot of blocker entities. Pathfinding iterates this in hot inner loops —
 *  no Map iterator overhead, no per-cell `r * r`, no dead/self filtering. */
export interface BlockerArrays {
  bx: Float64Array;
  by: Float64Array;
  br2: Float64Array; // (agentRadius + entityRadius)²
  n: number;
}

export function buildBlockers(
  entities: ReadonlyMap<string, Entity>, selfId: string, agentRadius: number,
): BlockerArrays {
  let n = 0;
  for (const e of entities.values()) if (!e.dead && e.id !== selfId) n++;
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  const br2 = new Float64Array(n);
  let i = 0;
  for (const e of entities.values()) {
    if (e.dead || e.id === selfId) continue;
    bx[i] = e.position.x;
    by[i] = e.position.y;
    const r = agentRadius + moveRadiusOf(e);
    br2[i] = r * r;
    i++;
  }
  return { bx, by, br2, n };
}

export function overlapsBlocker(px: number, py: number, b: BlockerArrays): boolean {
  const { bx, by, br2, n } = b;
  for (let i = 0; i < n; i++) {
    const dx = px - bx[i]!;
    const dy = py - by[i]!;
    if (dx * dx + dy * dy < br2[i]!) return true;
  }
  return false;
}

/** THE "may a body of `radius` stand at `p`" predicate: clear of walls, inside bounds, and not
 *  overlapping another living entity. Every occupancy decision — resolver, pathfinding endpoints,
 *  knockback slides, click snapping — funnels through this one rule. */
export function canStopAt(grid: GridState, radius: number, p: Vec2, blockers: BlockerArrays): boolean {
  return (
    isPositionWalkable(grid, p, radius) &&
    isWithinBounds(grid, p, radius) &&
    !overlapsBlocker(p.x, p.y, blockers)
  );
}

/** `canStopAt` for a specific entity in a game state. */
export function canEntityOccupy(state: GameState, entity: Entity, position: Vec2): boolean {
  const r = moveRadiusOf(entity);
  return canStopAt(state.grid, r, position, buildBlockers(state.entities, entity.id, r));
}

function findMoveAbility(entity: Entity): MoveAbility | undefined {
  return entity.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
}

/** Full status-adjusted range of `entity`'s move ability (0 if it has none), ignoring energy.
 *  The reach yardstick for AI planning and straight-line (non-path-based) move validation. */
export function getMoveReach(entity: Entity, ability?: MoveAbility): number {
  const mv = ability ?? findMoveAbility(entity);
  return mv ? getEffectiveDistance(entity, mv.distance) : 0;
}

/** The move budget `entity` can pay for *right now*: full reach when the full-distance cost is
 *  affordable, half reach when only the cheap half-move is (variable-cost moves), 0 when neither.
 *  THE budget for player moves — the client's planner and the authoritative resolver both read it. */
export function getAffordableMoveDistance(entity: Entity, ability?: MoveAbility): number {
  const mv = ability ?? findMoveAbility(entity);
  if (!mv || !canAffordAbility(entity, mv)) return 0;
  const reach = mv.variableCost && entity.energy.blue < (getAbilityCost(mv, { distance: mv.distance }).blue ?? 0)
    ? mv.distance / 2
    : mv.distance;
  return getEffectiveDistance(entity, reach);
}
