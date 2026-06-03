import type { Entity, GameState, MoveAbility, Vec2 } from "../core/types.js";
import { distance, sub, normalize, add, scale } from "../core/vec2.js";
import { canAffordAbility, getAbilityCost } from "./ability-cost.js";
import { getEffectiveDistance } from "./status-modifiers.js";
import { isPositionWalkable, isWithinBounds } from "../map/collision-grid.js";

function entitiesOverlap(
  pos: Vec2,
  radius: number,
  entities: ReadonlyMap<string, Entity>,
  excludeId: string
): boolean {
  for (const e of entities.values()) {
    if (e.id === excludeId || e.dead) continue;
    if (distance(pos, e.position) < radius + e.collisionRadius) return true;
  }
  return false;
}

/**
 * Whether `entity` could legally stand at `position`: inside the map, clear of walls, and not
 * overlapping any other living entity. The single spatial-occupancy rule shared by the
 * authoritative move resolver and the client's pre-submit check, so client prediction can never
 * drift from server truth.
 */
export function canEntityOccupy(state: GameState, entity: Entity, position: Vec2): boolean {
  return (
    isPositionWalkable(state.grid, position, entity.collisionRadius) &&
    isWithinBounds(state.grid, position, entity.collisionRadius) &&
    !entitiesOverlap(position, entity.collisionRadius, state.entities, entity.id)
  );
}

export function getAffordableMoveDistance(entity: Entity): number {
  const ability = entity.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  if (!ability || !canAffordAbility(entity, ability)) return 0;
  const reach = ability.variableCost && entity.energy.blue < (getAbilityCost(ability, { distance: ability.distance }).blue ?? 0)
    ? ability.distance / 2
    : ability.distance;
  return getEffectiveDistance(entity, reach);
}

export function clampToMovementRange(entity: Entity, target: Vec2, moveDistance?: number): Vec2 {
  const maxDist = moveDistance ?? getAffordableMoveDistance(entity);
  const dist = distance(entity.position, target);
  if (dist <= maxDist) return target;
  if (dist < 0.01) return target;
  const dir = normalize(sub(target, entity.position));
  return add(entity.position, scale(dir, maxDist));
}
