import { ShapeKind } from "../core/types.js";
import type { AimDirection, CombatShapeDefinition, Entity, GridState, Vec2 } from "../core/types.js";
import { add, length, normalize, scale } from "../core/vec2.js";
import { entitiesInSector } from "./sector.js";
import { entitiesInRectangle } from "./rectangle.js";
import { entitiesInCircle } from "./circle.js";
import { raycastToEntity } from "./ray.js";

export function entitiesInShape(
  origin: Vec2,
  direction: AimDirection,
  shape: CombatShapeDefinition,
  entities: ReadonlyMap<string, Entity>,
  grid: GridState,
  excludeId?: string,
  ignoreCoverRange?: number
): Entity[] {
  switch (shape.kind) {
    case ShapeKind.Sector:
      return entitiesInSector(origin, direction, shape.radius, shape.halfAngle, entities, excludeId);
    case ShapeKind.Rectangle:
      return entitiesInRectangle(origin, direction, shape.length, shape.width, entities, excludeId);
    case ShapeKind.Circle: {
      const dist = Math.min(length(direction), shape.range);
      const center = add(origin, scale(normalize(direction), dist));
      return entitiesInCircle(center, shape.radius, entities, excludeId);
    }
    case ShapeKind.Point: {
      const hit = raycastToEntity(origin, direction, shape.range, entities, grid, excludeId, ignoreCoverRange);
      if (!hit) return [];
      const target = entities.get(hit.entityId);
      return target ? [target] : [];
    }
    default: {
      const _exhaustive: never = shape;
      throw new Error(`Unhandled shape kind: ${(_exhaustive as CombatShapeDefinition).kind}`);
    }
  }
}
