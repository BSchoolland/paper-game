import { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import { normalize, sub, length, raycast } from "shared";

export function createTargetingPreview(
  entity: Entity,
  mouseWorld: Vec2,
  state: GameState
): Graphics | null {
  const dir = sub(mouseWorld, entity.position);
  if (length(dir) < 1) return null;

  const norm = normalize(dir);
  const baseAngle = Math.atan2(norm.y, norm.x);
  const shape = entity.weapon.shape;
  const g = new Graphics();

  switch (shape.kind) {
    case "sector": {
      g.moveTo(entity.position.x, entity.position.y);
      g.arc(
        entity.position.x,
        entity.position.y,
        shape.radius,
        baseAngle - shape.halfAngle,
        baseAngle + shape.halfAngle
      );
      g.lineTo(entity.position.x, entity.position.y);
      g.fill({ color: 0xffcc00, alpha: 0.15 });
      g.stroke({ color: 0xffcc00, alpha: 0.4, width: 1 });
      break;
    }
    case "rectangle": {
      const perpX = -norm.y;
      const perpY = norm.x;
      const hw = shape.width / 2;

      const x0 = entity.position.x;
      const y0 = entity.position.y;

      const corners = [
        { x: x0 + perpX * hw, y: y0 + perpY * hw },
        { x: x0 + norm.x * shape.length + perpX * hw, y: y0 + norm.y * shape.length + perpY * hw },
        { x: x0 + norm.x * shape.length - perpX * hw, y: y0 + norm.y * shape.length - perpY * hw },
        { x: x0 - perpX * hw, y: y0 - perpY * hw },
      ];

      g.moveTo(corners[0]!.x, corners[0]!.y);
      g.lineTo(corners[1]!.x, corners[1]!.y);
      g.lineTo(corners[2]!.x, corners[2]!.y);
      g.lineTo(corners[3]!.x, corners[3]!.y);
      g.closePath();
      g.fill({ color: 0xff8844, alpha: 0.15 });
      g.stroke({ color: 0xff8844, alpha: 0.4, width: 1 });
      break;
    }
    case "point": {
      const result = raycast(
        entity.position,
        norm,
        shape.range,
        state.entities,
        state.grid,
        entity.id
      );

      const endX = result.endPoint.x;
      const endY = result.endPoint.y;

      g.moveTo(entity.position.x, entity.position.y);
      g.lineTo(endX, endY);
      g.stroke({ color: 0x44ccff, alpha: 0.5, width: 2 });

      if (result.hit && result.hit.entityId !== entity.id) {
        const hitEntity = state.entities.get(result.hit.entityId);
        if (hitEntity && hitEntity.teamId !== entity.teamId) {
          g.circle(endX, endY, 6);
          g.fill({ color: 0xff4444, alpha: 0.6 });
        } else {
          g.circle(endX, endY, 4);
          g.fill({ color: 0x44ccff, alpha: 0.3 });
        }
      } else if (result.wallDistance !== null) {
        g.circle(endX, endY, 4);
        g.fill({ color: 0x888888, alpha: 0.5 });
      } else {
        g.circle(endX, endY, 4);
        g.fill({ color: 0x44ccff, alpha: 0.4 });
      }
      break;
    }
  }

  return g;
}
