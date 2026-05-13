import type { Entity, MoveAbility, Vec2 } from "../core/types.js";
import { distance, sub, normalize, add, scale } from "../core/vec2.js";
import { canAffordAbility, getAbilityCost } from "./ability-cost.js";
import { getEffectiveDistance } from "./status-modifiers.js";

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
