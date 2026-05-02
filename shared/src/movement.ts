import type { Entity, Vec2 } from "./types.js";
import { distance, sub, normalize, add, scale } from "./vec2.js";

export function clampToMovementRange(entity: Entity, target: Vec2): Vec2 {
  const dist = distance(entity.position, target);
  if (dist <= entity.movementRemaining) return target;
  if (dist < 0.01) return target;
  const dir = normalize(sub(target, entity.position));
  return add(entity.position, scale(dir, entity.movementRemaining));
}
