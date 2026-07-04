import type { Entity, GridState, MoveAbility, Vec2 } from "../core/types.js";
import { pathfindFlood, type FloodResult } from "./pathfinding.js";
import { moveRadiusOf, getAffordableMoveDistance } from "../combat/movement.js";

/**
 * THE move ruler. Player moves are planned (client), previewed (client), and validated + priced
 * (server resolver) against one flood: Dijkstra at the collision grid's own resolution, point-sized
 * transit (routes may thread gaps narrower than the body — the body only has to fit where it
 * *stops*), capped at the entity's affordable move budget. Because every consumer reads the same
 * pure function of the same state, a client-approved move can never be denied by the server, and
 * the energy cost shown is the energy cost charged.
 */
export function reachableArea(
  entity: Entity,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  maxDistance: number,
): FloodResult {
  return pathfindFlood(entity.position, grid, moveRadiusOf(entity), entities, entity.id, maxDistance, undefined, 0);
}

// The flood depends only on (entity, grid, entities, budget), and all state mutations replace the
// entities Map, so caching on it is sound. This is what lets the client re-plan every frame during
// move targeting without re-flooding: the state is static while the player aims.
interface CachedFlood {
  readonly grid: GridState;
  readonly budget: number;
  readonly flood: FloodResult;
}
const floodCache = new WeakMap<ReadonlyMap<string, Entity>, Map<string, CachedFlood>>();

function moveFlood(
  entity: Entity,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  budget: number,
): FloodResult {
  let byEntity = floodCache.get(entities);
  if (!byEntity) {
    byEntity = new Map();
    floodCache.set(entities, byEntity);
  }
  const hit = byEntity.get(entity.id);
  if (hit && hit.grid === grid && hit.budget === budget) return hit.flood;
  const flood = reachableArea(entity, grid, entities, budget);
  byEntity.set(entity.id, { grid, budget, flood });
  return flood;
}

export interface MovePlan {
  /** Where the move actually lands: the click itself when it's reachable and stop-legal, else the
   *  nearest reachable stop toward it. Submit this as the action's destination. */
  readonly dest: Vec2;
  /** Route cost to `dest` — the number the resolver prices energy from. */
  readonly cost: number;
  /** The affordable move budget the plan was made under. */
  readonly budget: number;
}

/**
 * Plan a player move toward `desired` (a click or cursor position): snap it to the nearest
 * reachable, stop-legal point within the entity's affordable budget, and price the route.
 * Returns `null` when the entity can't afford to move or nothing near `desired` is reachable.
 */
export function planMove(
  entity: Entity,
  desired: Vec2,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
): MovePlan | null {
  const budget = getAffordableMoveDistance(entity);
  if (budget <= 0) return null;
  const flood = moveFlood(entity, grid, entities, budget);
  const dest = flood.pathTo(desired, budget);
  if (!dest) return null;
  const cost = flood.costTo(dest);
  if (cost === null) throw new Error("planMove: pathTo returned a destination the flood never reached");
  return { dest, cost, budget };
}

/**
 * Authoritative cost of moving `entity` to exactly `destination`, or `null` if no route reaches it
 * within the affordable budget. This is the resolver's half of the ruler: it reads the same flood
 * `planMove` snapped against, so every destination `planMove` returns is accepted here at the same
 * cost. Stop legality (walls/bounds/entities at the endpoint) is the resolver's separate
 * `canEntityOccupy` check.
 */
export function plannedMoveCost(
  entity: Entity,
  destination: Vec2,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  ability?: MoveAbility,
): number | null {
  const budget = getAffordableMoveDistance(entity, ability);
  if (budget <= 0) return null;
  return moveFlood(entity, grid, entities, budget).costTo(destination);
}
