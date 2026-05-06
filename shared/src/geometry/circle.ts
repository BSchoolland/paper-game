import type { Entity, Vec2 } from "../core/types.js";
import { distance } from "../core/vec2.js";

export function entitiesInCircle(
  center: Vec2,
  radius: number,
  entities: ReadonlyMap<string, Entity>,
  excludeId?: string
): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities.values()) {
    if (entity.id === excludeId || entity.dead) continue;
    const dist = distance(center, entity.position);
    if (dist <= radius + entity.collisionRadius) {
      result.push(entity);
    }
  }
  return result;
}
