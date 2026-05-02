import type { Entity, GridState, Vec2 } from "../types.js";
import { sub, length, normalize, dot, add, scale } from "../vec2.js";
import { isBlocked } from "../collision-grid.js";

export interface RayHit {
  readonly entityId: string;
  readonly point: Vec2;
  readonly distance: number;
}

export interface RayResult {
  readonly hit: RayHit | null;
  readonly wallDistance: number | null;
  readonly endPoint: Vec2;
}

export function raycast(
  origin: Vec2,
  direction: Vec2,
  range: number,
  entities: ReadonlyMap<string, Entity>,
  grid: GridState,
  excludeId?: string
): RayResult {
  const dirNorm = normalize(direction);
  const step = grid.cellSize / 2;
  const steps = Math.ceil(range / step);

  let closestHit: RayHit | null = null;

  for (const entity of entities.values()) {
    if (entity.id === excludeId) continue;

    const toEntity = sub(entity.position, origin);
    const projDist = dot(toEntity, dirNorm);
    if (projDist < 0 || projDist > range) continue;

    const closest = add(origin, scale(dirNorm, projDist));
    const perpDist = length(sub(entity.position, closest));
    if (perpDist > entity.collisionRadius) continue;

    const hitDist = projDist - Math.sqrt(
      entity.collisionRadius * entity.collisionRadius - perpDist * perpDist
    );
    if (hitDist < 0) continue;

    if (!closestHit || hitDist < closestHit.distance) {
      closestHit = {
        entityId: entity.id,
        point: add(origin, scale(dirNorm, hitDist)),
        distance: hitDist,
      };
    }
  }

  let wallDistance: number | null = null;
  for (let i = 1; i <= steps; i++) {
    const dist = i * step;
    if (closestHit && dist > closestHit.distance) break;

    const pos = add(origin, scale(dirNorm, dist));
    const cx = Math.floor(pos.x / grid.cellSize);
    const cy = Math.floor(pos.y / grid.cellSize);
    if (isBlocked(grid, cx, cy)) {
      wallDistance = dist;
      break;
    }
  }

  const effectiveRange = Math.min(
    range,
    closestHit?.distance ?? Infinity,
    wallDistance ?? Infinity
  );
  const endPoint = add(origin, scale(dirNorm, effectiveRange));

  return { hit: closestHit, wallDistance, endPoint };
}

export function raycastToEntity(
  origin: Vec2,
  direction: Vec2,
  range: number,
  entities: ReadonlyMap<string, Entity>,
  grid: GridState,
  excludeId?: string
): RayHit | null {
  const result = raycast(origin, direction, range, entities, grid, excludeId);

  if (!result.hit) return null;
  if (result.wallDistance !== null && result.wallDistance < result.hit.distance) return null;

  return result.hit;
}
