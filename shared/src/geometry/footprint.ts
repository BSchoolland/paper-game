import { ShapeKind } from "../core/types.js";
import type { AimDirection, CombatShapeDefinition, Entity, GridState, Vec2 } from "../core/types.js";
import { add, length, normalize, scale } from "../core/vec2.js";
import { raycast } from "./ray.js";

/**
 * The resolved geometric outline of an attack shape for a given aim direction — the polygon
 * an attack actually covers, with the raycast already traced for point shapes. This is the
 * single source of the shape maths: `entitiesInShape` decides *who* is hit, `ShapeFootprint`
 * describes *where*, and both the aiming preview and the post-attack flash render off it
 * instead of re-deriving cones and rectangles by hand.
 */
export type ShapeFootprint =
  | { readonly kind: ShapeKind.Sector; readonly origin: Vec2; readonly radius: number; readonly startAngle: number; readonly endAngle: number }
  | { readonly kind: ShapeKind.Rectangle; readonly corners: readonly [Vec2, Vec2, Vec2, Vec2] }
  | { readonly kind: ShapeKind.Circle; readonly rangeOrigin: Vec2; readonly range: number; readonly center: Vec2; readonly radius: number }
  | { readonly kind: ShapeKind.Point; readonly from: Vec2; readonly to: Vec2; readonly hitEntityId: string | null; readonly hitWall: boolean };

export function computeShapeFootprint(
  shape: CombatShapeDefinition,
  origin: Vec2,
  aim: AimDirection,
  entities: ReadonlyMap<string, Entity>,
  grid: GridState,
  excludeId?: string,
  ignoreCoverRange?: number
): ShapeFootprint {
  const norm = normalize(aim);
  const baseAngle = Math.atan2(norm.y, norm.x);

  switch (shape.kind) {
    case ShapeKind.Sector:
      return {
        kind: ShapeKind.Sector,
        origin,
        radius: shape.radius,
        startAngle: baseAngle - shape.halfAngle,
        endAngle: baseAngle + shape.halfAngle,
      };
    case ShapeKind.Rectangle: {
      const perp = { x: -norm.y, y: norm.x };
      const hw = shape.width / 2;
      const tip = add(origin, scale(norm, shape.length));
      return {
        kind: ShapeKind.Rectangle,
        corners: [
          { x: origin.x + perp.x * hw, y: origin.y + perp.y * hw },
          { x: tip.x + perp.x * hw, y: tip.y + perp.y * hw },
          { x: tip.x - perp.x * hw, y: tip.y - perp.y * hw },
          { x: origin.x - perp.x * hw, y: origin.y - perp.y * hw },
        ],
      };
    }
    case ShapeKind.Circle: {
      const dist = Math.min(length(aim), shape.range);
      return {
        kind: ShapeKind.Circle,
        rangeOrigin: origin,
        range: shape.range,
        center: add(origin, scale(norm, dist)),
        radius: shape.radius,
      };
    }
    case ShapeKind.Point: {
      const result = raycast(origin, norm, shape.range, entities, grid, excludeId, ignoreCoverRange);
      const wall = result.wallDistance;
      const entityBlocked = result.hit !== null && (wall === null || wall >= result.hit.distance);
      const wallBlocked = wall !== null && (result.hit === null || wall < result.hit.distance);
      return {
        kind: ShapeKind.Point,
        from: origin,
        to: result.endPoint,
        hitEntityId: entityBlocked ? result.hit!.entityId : null,
        hitWall: wallBlocked,
      };
    }
    default: {
      const _exhaustive: never = shape;
      throw new Error(`Unhandled shape kind: ${(_exhaustive as CombatShapeDefinition).kind}`);
    }
  }
}
