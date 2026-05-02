import { Graphics } from "pixi.js";
import type { Entity, Vec2 } from "shared";
import { normalize, sub, length } from "shared";

export function createTargetingArc(
  entity: Entity,
  mouseWorld: Vec2
): Graphics | null {
  const dir = sub(mouseWorld, entity.position);
  if (length(dir) < 1) return null;

  const shape = entity.weapon.shape;
  if (shape.kind !== "sector") return null;

  const norm = normalize(dir);
  const baseAngle = Math.atan2(norm.y, norm.x);
  const g = new Graphics();

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

  return g;
}
