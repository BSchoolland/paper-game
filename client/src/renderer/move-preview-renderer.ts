import { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import {
  clampToMovementRange,
  isPositionWalkable,
  isWithinBounds,
  distance,
} from "shared";

const VALID = 0x8fbc6a;
const INVALID = 0xc0392b;

function isDestinationValid(
  entity: Entity,
  destination: Vec2,
  state: GameState
): boolean {
  if (!isPositionWalkable(state.grid, destination, entity.collisionRadius))
    return false;
  if (!isWithinBounds(state.grid, destination, entity.collisionRadius))
    return false;
  for (const other of state.entities.values()) {
    if (other.id === entity.id) continue;
    if (distance(destination, other.position) < entity.collisionRadius + other.collisionRadius)
      return false;
  }
  return true;
}

export function createMovePreview(
  entity: Entity,
  mouseWorld: Vec2,
  state: GameState
): Graphics {
  const g = new Graphics();
  const clamped = clampToMovementRange(entity, mouseWorld);
  const valid = isDestinationValid(entity, clamped, state);
  const color = valid ? VALID : INVALID;

  g.circle(entity.position.x, entity.position.y, entity.movementRemaining);
  g.stroke({ color: VALID, alpha: 0.2, width: 1 });

  const dx = clamped.x - entity.position.x;
  const dy = clamped.y - entity.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 1) {
    const nx = dx / dist;
    const ny = dy / dist;
    let drawn = 0;
    let drawing = true;

    while (drawn < dist) {
      const seg = drawing ? 6 : 4;
      const end = Math.min(drawn + seg, dist);

      if (drawing) {
        g.moveTo(
          entity.position.x + nx * drawn,
          entity.position.y + ny * drawn
        );
        g.lineTo(
          entity.position.x + nx * end,
          entity.position.y + ny * end
        );
      }
      drawn = end;
      drawing = !drawing;
    }
    g.stroke({ color, alpha: 0.5, width: 1.5 });
  }

  g.circle(clamped.x, clamped.y, entity.collisionRadius);
  g.stroke({ color, alpha: 0.35, width: 1.5 });

  g.circle(clamped.x, clamped.y, 3);
  g.fill({ color, alpha: 0.6 });

  return g;
}
