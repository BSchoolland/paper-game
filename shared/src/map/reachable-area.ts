import type { Entity, GridState } from "../core/types.js";
import { pathfindFlood, type FloodResult } from "./pathfinding.js";
import { moveRadiusOf } from "../combat/movement.js";

// Node spacing for the flood grid. Coarser than the collision grid keeps the flood cheap; move
// destinations snap to this spacing.
const FLOOD_STEP = 12;

/**
 * Flood-fill of everywhere a unit can actually *reach* this turn (path distance ≤ move budget).
 * Transit is point-sized (like the AI mover), so paths thread gaps narrower than the body; the
 * body's full radius only gates where it may *stop* (`pathTo`'s endpoint check).
 *
 * Use `pathTo(cursor, cap)` to snap a cursor to the nearest reachable point (click/preview).
 */
export function reachableArea(
  entity: Entity,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  maxDistance: number,
): FloodResult {
  return pathfindFlood(entity.position, grid, moveRadiusOf(entity), entities, entity.id, maxDistance, FLOOD_STEP, 0);
}
