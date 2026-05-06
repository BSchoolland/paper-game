import type { CombatShapeDefinition, Entity, GridState, Vec2 } from "../core/types.js";
import { add, normalize, scale } from "../core/vec2.js";
import { entitiesInSector } from "./sector.js";
import { entitiesInRectangle } from "./rectangle.js";
import { entitiesInCircle } from "./circle.js";
import { raycastToEntity } from "./ray.js";

export function entitiesInShape(
  origin: Vec2,
  direction: Vec2,
  shape: CombatShapeDefinition,
  entities: ReadonlyMap<string, Entity>,
  grid: GridState,
  excludeId?: string,
  ignoreCoverRange?: number
): Entity[] {
  switch (shape.kind) {
    case "sector":
      return entitiesInSector(origin, direction, shape.radius, shape.halfAngle, entities, excludeId);
    case "rectangle":
      return entitiesInRectangle(origin, direction, shape.length, shape.width, entities, excludeId);
    case "circle": {
      const center = add(origin, scale(normalize(direction), shape.range));
      return entitiesInCircle(center, shape.radius, entities, excludeId);
    }
    case "point": {
      const hit = raycastToEntity(origin, direction, shape.range, entities, grid, excludeId, ignoreCoverRange);
      if (!hit) return [];
      const target = entities.get(hit.entityId);
      return target ? [target] : [];
    }
  }
}
