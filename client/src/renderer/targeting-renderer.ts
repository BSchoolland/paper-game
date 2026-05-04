import { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import { normalize, sub, length, raycast } from "shared";

const PENCIL = 0x4a3728;
const PENCIL_HIT = 0x8b3a3a;
const PENCIL_LIGHT = 0x6b5a48;

function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 0xffffffff - 0.5) * 2;
  };
}

function drawRoughLine(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  wobble: number,
  seed: number
) {
  const rand = seededRand(seed);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const segments = Math.max(4, Math.floor(dist / 8));
  const perpX = -dy / dist;
  const perpY = dx / dist;

  g.moveTo(x1 + rand() * wobble * perpX, y1 + rand() * wobble * perpY);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = x1 + dx * t + rand() * wobble * perpX;
    const y = y1 + dy * t + rand() * wobble * perpY;
    g.lineTo(x, y);
  }
}

function drawRoughArc(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  wobble: number,
  segments: number,
  seed: number
) {
  const rand = seededRand(seed);
  const span = endAngle - startAngle;
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * span;
    const r = radius + rand() * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

function drawRoughRect(
  g: Graphics,
  corners: Vec2[],
  wobble: number,
  seed: number
) {
  const rand = seededRand(seed);
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]!;
    const x = c.x + rand() * wobble;
    const y = c.y + rand() * wobble;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  const first = corners[0]!;
  g.lineTo(first.x + rand() * wobble, first.y + rand() * wobble);
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

function drawXMark(
  g: Graphics,
  cx: number,
  cy: number,
  size: number,
  seed: number
) {
  const rand = seededRand(seed);
  const w = 0.8;
  g.moveTo(cx - size + rand() * w, cy - size + rand() * w);
  g.lineTo(cx + size + rand() * w, cy + size + rand() * w);
  g.moveTo(cx + size + rand() * w, cy - size + rand() * w);
  g.lineTo(cx - size + rand() * w, cy + size + rand() * w);
}

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
