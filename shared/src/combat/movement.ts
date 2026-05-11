import type { EnergyCost, Entity, MoveAbility, Vec2 } from "../core/types.js";
import { distance, sub, normalize, add, scale } from "../core/vec2.js";

export function computeMoveCost(ability: MoveAbility, dist: number): EnergyCost {
  if (!ability.variableCost) return ability.cost;
  return { blue: dist <= ability.distance / 2 ? 1 : 2 };
}

export function getAffordableMoveDistance(entity: Entity): number {
  const ability = entity.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  if (!ability) return 0;
  if (!ability.variableCost) return ability.distance;
  const blue = entity.energy.blue;
  if (blue >= 2) return ability.distance;
  if (blue >= 1) return ability.distance / 2;
  return 0;
}

export function clampToMovementRange(entity: Entity, target: Vec2, moveDistance?: number): Vec2 {
  const maxDist = moveDistance ?? getAffordableMoveDistance(entity);
  const dist = distance(entity.position, target);
  if (dist <= maxDist) return target;
  if (dist < 0.01) return target;
  const dir = normalize(sub(target, entity.position));
  return add(entity.position, scale(dir, maxDist));
}
