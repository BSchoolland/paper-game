import type { Entity, MoveAbility, Vec2 } from "../core/types.js";
import { distance, sub, normalize, add, scale } from "../core/vec2.js";
import { canAffordAbility, getAbilityCost } from "./ability-cost.js";

export function getAffordableMoveDistance(entity: Entity): number {
  const ability = entity.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  if (!ability || !canAffordAbility(entity, ability)) return 0;
  if (!ability.variableCost) return ability.distance;
  const cost = getAbilityCost(ability, { distance: ability.distance });
  const maxCostBlue = cost.blue ?? 0;
  if (entity.energy.blue >= maxCostBlue) return ability.distance;
  return ability.distance / 2;
}

export function clampToMovementRange(entity: Entity, target: Vec2, moveDistance?: number): Vec2 {
  const maxDist = moveDistance ?? getAffordableMoveDistance(entity);
  const dist = distance(entity.position, target);
  if (dist <= maxDist) return target;
  if (dist < 0.01) return target;
  const dir = normalize(sub(target, entity.position));
  return add(entity.position, scale(dir, maxDist));
}
