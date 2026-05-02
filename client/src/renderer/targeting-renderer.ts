import { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import { normalize, sub, length, raycast } from "shared";

const SWORD_COLOR = 0xf1c40f;
const SPEAR_COLOR = 0xe67e22;
const BOW_COLOR = 0x5dade2;
const HIT_ENEMY = 0xe74c3c;
const HIT_WALL = 0x7a6f60;
const HIT_FRIENDLY = 0x5dade2;

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
      g.fill({ color: SWORD_COLOR, alpha: 0.12 });
      g.stroke({ color: SWORD_COLOR, alpha: 0.35, width: 1.5 });
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
      g.fill({ color: SPEAR_COLOR, alpha: 0.12 });
      g.stroke({ color: SPEAR_COLOR, alpha: 0.35, width: 1.5 });
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
      g.stroke({ color: BOW_COLOR, alpha: 0.45, width: 2 });

      if (result.hit && result.hit.entityId !== entity.id) {
        const hitEntity = state.entities.get(result.hit.entityId);
        if (hitEntity && hitEntity.teamId !== entity.teamId) {
          g.circle(endX, endY, 7);
          g.fill({ color: HIT_ENEMY, alpha: 0.55 });
          g.circle(endX, endY, 7);
          g.stroke({ color: HIT_ENEMY, alpha: 0.3, width: 1 });
        } else {
          g.circle(endX, endY, 5);
          g.fill({ color: HIT_FRIENDLY, alpha: 0.25 });
        }
      } else if (result.wallDistance !== null) {
        g.circle(endX, endY, 4);
        g.fill({ color: HIT_WALL, alpha: 0.5 });
      } else {
        g.circle(endX, endY, 3);
        g.fill({ color: BOW_COLOR, alpha: 0.35 });
      }
      break;
    }
  }

  return g;
}
