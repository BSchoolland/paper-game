import { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import {
  clampToMovementRange,
  isPositionWalkable,
  isWithinBounds,
  distance,
} from "shared";

const PENCIL = 0x4a3728;
const PENCIL_INVALID = 0x8b3a3a;

function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 0xffffffff - 0.5) * 2;
  };
}

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

function drawRoughCircle(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  wobble: number,
  segments: number,
  seed: number
) {
  const rand = seededRand(seed);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = radius + rand() * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

export function createMovePreview(
  entity: Entity,
  mouseWorld: Vec2,
  state: GameState
): Graphics {
  const g = new Graphics();
  const clamped = clampToMovementRange(entity, mouseWorld);
  const valid = isDestinationValid(entity, clamped, state);
  const color = valid ? PENCIL : PENCIL_INVALID;

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
