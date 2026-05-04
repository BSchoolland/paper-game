import type { Graphics } from "pixi.js";
import type { GameState, Vec2, WeaponDefinition } from "shared";
import { normalize, raycast } from "shared";
import type { PendingAttack } from "../state/game-store.js";
import {
  drawRoughArc,
  drawRoughRect,
  drawRoughLine,
  drawXMark,
} from "./sketch-utils.js";

const FLASH_COLOR = 0x8b2020;

export function drawAttackFlash(
  g: Graphics,
  pending: PendingAttack,
  state: GameState
): void {
  const entity = state.entities.get(pending.entityId);
  const pos = entity?.position ?? pending.attackerPosition;

  drawFlashShape(g, pos, pending.aimDirection, pending.weapon, pending.entityId, state);
}

function drawFlashShape(
  g: Graphics,
  pos: Vec2,
  aimDirection: Vec2,
  weapon: WeaponDefinition,
  attackerId: string,
  state: GameState
): void {
  const norm = normalize(aimDirection);
  const baseAngle = Math.atan2(norm.y, norm.x);
  const shape = weapon.shape;

  switch (shape.kind) {
    case "sector": {
      g.moveTo(pos.x, pos.y);
      drawRoughArc(
        g, pos.x, pos.y,
        shape.radius,
        baseAngle - shape.halfAngle,
        baseAngle + shape.halfAngle,
        1.5, 24, 71
      );
      g.lineTo(pos.x, pos.y);
      g.fill({ color: FLASH_COLOR, alpha: 0.2 });
      g.stroke({ color: FLASH_COLOR, alpha: 0.6, width: 1.5 });
      break;
    }
    case "rectangle": {
      const perpX = -norm.y;
      const perpY = norm.x;
      const hw = shape.width / 2;

      const corners = [
        { x: pos.x + perpX * hw, y: pos.y + perpY * hw },
        { x: pos.x + norm.x * shape.length + perpX * hw, y: pos.y + norm.y * shape.length + perpY * hw },
        { x: pos.x + norm.x * shape.length - perpX * hw, y: pos.y + norm.y * shape.length - perpY * hw },
        { x: pos.x - perpX * hw, y: pos.y - perpY * hw },
      ];

      drawRoughRect(g, corners, 1, 73);
      g.fill({ color: FLASH_COLOR, alpha: 0.2 });
      g.stroke({ color: FLASH_COLOR, alpha: 0.6, width: 1.5 });
      break;
    }
    case "point": {
      const result = raycast(
        pos, norm, shape.range,
        state.entities, state.grid,
        attackerId, weapon.ignoreCoverRange
      );

      const endX = result.endPoint.x;
      const endY = result.endPoint.y;

      drawRoughLine(g, pos.x, pos.y, endX, endY, 0.8, 77);
      g.stroke({ color: FLASH_COLOR, alpha: 0.7, width: 2 });

      if (result.hit) {
        drawXMark(g, endX, endY, 7, 79);
        g.stroke({ color: FLASH_COLOR, alpha: 0.8, width: 2 });
      }
      break;
    }
  }
}
