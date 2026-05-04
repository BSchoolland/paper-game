import { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import { normalize, sub, length, raycast } from "shared";
import {
  PENCIL,
  PENCIL_HIT,
  PENCIL_LIGHT,
  drawRoughArc,
  drawRoughRect,
  drawRoughLine,
  drawRoughCircle,
  drawXMark,
} from "./sketch-utils.js";

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
      const segments = 24;
      g.moveTo(entity.position.x, entity.position.y);
      drawRoughArc(
        g,
        entity.position.x,
        entity.position.y,
        shape.radius,
        baseAngle - shape.halfAngle,
        baseAngle + shape.halfAngle,
        1.5,
        segments,
        17
      );
      g.lineTo(entity.position.x, entity.position.y);
      g.fill({ color: PENCIL, alpha: 0.1 });
      g.stroke({ color: PENCIL, alpha: 0.5, width: 1.2 });
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
        {
          x: x0 + norm.x * shape.length + perpX * hw,
          y: y0 + norm.y * shape.length + perpY * hw,
        },
        {
          x: x0 + norm.x * shape.length - perpX * hw,
          y: y0 + norm.y * shape.length - perpY * hw,
        },
        { x: x0 - perpX * hw, y: y0 - perpY * hw },
      ];

      drawRoughRect(g, corners, 1, 23);
      g.fill({ color: PENCIL, alpha: 0.1 });
      g.stroke({ color: PENCIL, alpha: 0.5, width: 1.2 });
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

      drawRoughLine(
        g,
        entity.position.x,
        entity.position.y,
        endX,
        endY,
        0.8,
        31
      );
      g.stroke({ color: PENCIL, alpha: 0.6, width: 1.2 });

      if (result.hit && result.hit.entityId !== entity.id) {
        const hitEntity = state.entities.get(result.hit.entityId);
        if (hitEntity && hitEntity.teamId !== entity.teamId) {
          drawXMark(g, endX, endY, 6, 37);
          g.stroke({ color: PENCIL_HIT, alpha: 0.7, width: 1.5 });
        } else {
          drawRoughCircle(g, endX, endY, 5, 0.8, 12, 41);
          g.stroke({ color: PENCIL_LIGHT, alpha: 0.5, width: 1.2 });
        }
      } else if (result.wallDistance !== null) {
        drawXMark(g, endX, endY, 4, 43);
        g.stroke({ color: PENCIL_LIGHT, alpha: 0.6, width: 1.2 });
      } else {
        g.circle(endX, endY, 2.5);
        g.fill({ color: PENCIL, alpha: 0.5 });
      }
      break;
    }
  }

  return g;
}
