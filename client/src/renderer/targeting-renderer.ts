import type { Graphics } from "pixi.js";
import type { AttackAbility, CombatShapeDefinition, Entity, GameState, Vec2 } from "shared";
import { ShapeKind, normalize, sub, length, raycast } from "shared";
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

export function getActiveAttackAbility(entity: Entity): AttackAbility | undefined {
  return entity.abilities.find(a => a.kind === "attack") as AttackAbility | undefined;
}

export function drawTargetingPreview(
  g: Graphics,
  entity: Entity,
  mouseWorld: Vec2,
  state: GameState,
  selectedAbility?: AttackAbility
): void {
  const ability = selectedAbility ?? getActiveAttackAbility(entity);
  if (!ability) return;

  const dir = sub(mouseWorld, entity.position);
  if (length(dir) < 1) return;

  const norm = normalize(dir);
  const baseAngle = Math.atan2(norm.y, norm.x);
  const shape = ability.shape;

  switch (shape.kind) {
    case ShapeKind.Sector: {
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
    case ShapeKind.Rectangle: {
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
    case ShapeKind.Circle: {
      drawRoughCircle(g, entity.position.x, entity.position.y, shape.range, 1.5, 48, 45);
      g.stroke({ color: PENCIL, alpha: 0.25, width: 1.2 });

      const dist = Math.min(length(dir), shape.range);
      const targetX = entity.position.x + norm.x * dist;
      const targetY = entity.position.y + norm.y * dist;
      drawRoughArc(g, targetX, targetY, shape.radius, 0, Math.PI * 2, 1.5, 24, 47);
      g.fill({ color: PENCIL, alpha: 0.1 });
      g.stroke({ color: PENCIL, alpha: 0.5, width: 1.2 });
      break;
    }
    case ShapeKind.Point: {
      const result = raycast(
        entity.position,
        norm,
        shape.range,
        state.entities,
        state.grid,
        entity.id,
        ability.ignoreCoverRange
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
    default: {
      const _exhaustive: never = shape;
      throw new Error(`Unhandled shape kind: ${(_exhaustive as CombatShapeDefinition).kind}`);
    }
  }
}
