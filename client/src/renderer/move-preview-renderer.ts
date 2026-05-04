import { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import {
  clampToMovementRange,
  isPositionWalkable,
  isWithinBounds,
  distance,
} from "shared";
import {
  PENCIL,
  PENCIL_HIT,
  seededRand,
  drawRoughCircle,
} from "./sketch-utils.js";

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
    if (
      distance(destination, other.position) <
      entity.collisionRadius + other.collisionRadius
    )
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
  const color = valid ? PENCIL : PENCIL_HIT;

  drawRoughCircle(
    g,
    entity.position.x,
    entity.position.y,
    entity.movementRemaining,
    1.5,
    48,
    7
  );
  g.stroke({ color: PENCIL, alpha: 0.4, width: 1.2 });

  const dx = clamped.x - entity.position.x;
  const dy = clamped.y - entity.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 1) {
    const nx = dx / dist;
    const ny = dy / dist;
    const rand = seededRand(42);
    const dotSpacing = 6;
    let d = 0;

    while (d < dist) {
      const ox = rand() * 0.8;
      const oy = rand() * 0.8;
      const x = entity.position.x + nx * d + ox;
      const y = entity.position.y + ny * d + oy;
      g.circle(x, y, 1.2);
      d += dotSpacing;
    }
    g.fill({ color, alpha: 0.6 });
  }

  drawRoughCircle(
    g,
    clamped.x,
    clamped.y,
    entity.collisionRadius,
    1,
    24,
    13
  );
  g.stroke({ color, alpha: 0.5, width: 1.2 });

  g.circle(clamped.x, clamped.y, 2.5);
  g.fill({ color, alpha: 0.7 });

  return g;
}
