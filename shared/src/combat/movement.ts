import type { Entity, MoveAbility, Vec2 } from "../core/types.js";
import { distance, sub, normalize, add, scale } from "../core/vec2.js";

export function clampToMovementRange(entity: Entity, target: Vec2, moveDistance?: number): Vec2 {
  const ability = entity.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  const maxDist = moveDistance ?? ability?.distance ?? 0;
  const dist = distance(entity.position, target);
  if (dist <= maxDist) return target;
  if (dist < 0.01) return target;
  const dir = normalize(sub(target, entity.position));
  return add(entity.position, scale(dir, maxDist));
}
