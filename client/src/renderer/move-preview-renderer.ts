import { Graphics } from "pixi.js";
import type { Entity, Vec2 } from "shared";
import { clampToMovementRange } from "shared";

export function createMovePreview(
  entity: Entity,
  mouseWorld: Vec2
): Graphics {
  const g = new Graphics();
  const clamped = clampToMovementRange(entity, mouseWorld);

  g.circle(entity.position.x, entity.position.y, entity.movementRemaining);
  g.stroke({ color: 0x44bb44, alpha: 0.25, width: 1 });

  g.moveTo(entity.position.x, entity.position.y);
  g.lineTo(clamped.x, clamped.y);
  g.stroke({ color: 0x44bb44, alpha: 0.5, width: 1 });

  g.circle(clamped.x, clamped.y, entity.collisionRadius);
  g.stroke({ color: 0x44bb44, alpha: 0.3, width: 1 });

  return g;
}
