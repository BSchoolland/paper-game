import { Graphics } from "pixi.js";
import type { Entity, Vec2 } from "shared";
import { distance } from "shared";

export function createMovePreview(
  entity: Entity,
  mouseWorld: Vec2
): Graphics {
  const g = new Graphics();
  const dist = distance(entity.position, mouseWorld);
  const inRange = dist <= entity.movementRemaining + 0.01;

  g.circle(entity.position.x, entity.position.y, entity.movementRemaining);
  g.stroke({ color: inRange ? 0x44bb44 : 0x666666, alpha: 0.25, width: 1 });

  g.moveTo(entity.position.x, entity.position.y);
  g.lineTo(mouseWorld.x, mouseWorld.y);
  g.stroke({ color: inRange ? 0x44bb44 : 0xcc3333, alpha: 0.5, width: 1 });

  if (inRange) {
    g.circle(mouseWorld.x, mouseWorld.y, entity.collisionRadius);
    g.stroke({ color: 0x44bb44, alpha: 0.3, width: 1 });
  }

  return g;
}
