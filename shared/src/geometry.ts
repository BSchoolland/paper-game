import type { Entity, Vec2 } from "./types.js";
import { sub, length, normalize, dot } from "./vec2.js";

export function pointInSector(
  point: Vec2,
  origin: Vec2,
  direction: Vec2,
  radius: number,
  halfAngle: number
): boolean {
  const toPoint = sub(point, origin);
  const dist = length(toPoint);
  if (dist > radius) return false;
  if (dist === 0) return true;
  const norm = normalize(toPoint);
  const dirNorm = normalize(direction);
  const cosAngle = dot(norm, dirNorm);
  return cosAngle >= Math.cos(halfAngle);
}

export function entityInSector(
  entity: Entity,
  origin: Vec2,
  direction: Vec2,
  radius: number,
  halfAngle: number
): boolean {
  const toEntity = sub(entity.position, origin);
  const dist = length(toEntity);
  if (dist <= entity.collisionRadius) return true;
  if (dist > radius + entity.collisionRadius) return false;

  const norm = normalize(toEntity);
  const dirNorm = normalize(direction);
  const cosAngle = dot(norm, dirNorm);

  const effectiveHalfAngle =
    halfAngle + Math.asin(Math.min(1, entity.collisionRadius / dist));
  return cosAngle >= Math.cos(effectiveHalfAngle);
}

export function entitiesInSector(
  origin: Vec2,
  direction: Vec2,
  radius: number,
  halfAngle: number,
  entities: ReadonlyMap<string, Entity>,
  excludeId?: string
): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities.values()) {
    if (entity.id === excludeId) continue;
    if (entityInSector(entity, origin, direction, radius, halfAngle)) {
      result.push(entity);
    }
  }
  return result;
}
