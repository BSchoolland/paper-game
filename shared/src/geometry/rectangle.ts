import type { Entity, Vec2 } from "../types.js";
import { sub, normalize, dot } from "../vec2.js";

export function entityInRectangle(
  entity: Entity,
  origin: Vec2,
  direction: Vec2,
  rectLength: number,
  rectWidth: number
): boolean {
  const dirNorm = normalize(direction);
  const toEntity = sub(entity.position, origin);

  const forward = dot(toEntity, dirNorm);
  if (forward < -entity.collisionRadius) return false;
  if (forward > rectLength + entity.collisionRadius) return false;

  const perpX = -dirNorm.y;
  const perpY = dirNorm.x;
  const lateral = toEntity.x * perpX + toEntity.y * perpY;
  const halfWidth = rectWidth / 2;
  if (Math.abs(lateral) > halfWidth + entity.collisionRadius) return false;

  return true;
}

export function entitiesInRectangle(
  origin: Vec2,
  direction: Vec2,
  rectLength: number,
  rectWidth: number,
  entities: ReadonlyMap<string, Entity>,
  excludeId?: string
): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities.values()) {
    if (entity.id === excludeId) continue;
    if (entityInRectangle(entity, origin, direction, rectLength, rectWidth)) {
      result.push(entity);
    }
  }
  return result;
}
