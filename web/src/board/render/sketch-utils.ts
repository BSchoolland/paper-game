import type { Graphics } from "pixi.js";
import type { Vec2 } from "shared";
import { Rng } from "shared";

export const PENCIL = 0x4a3728;
export const PENCIL_HIT = 0x8b3a3a;
export const PENCIL_LIGHT = 0x6b5a48;

export function drawRoughCircle(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  wobble: number,
  segments: number,
  seed: number
) {
  const rng = Rng.seeded(seed, 0);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = radius + rng.symmetric() * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

/**
 * Place jittered dots at a uniform arc-length `spacing` along a polyline. One arc-length cursor
 * carries across vertices, so dot density is independent of how the line is segmented — a path with
 * many short segments (e.g. one hugging a wall) gets the same spacing as a straight one, instead of a
 * dot bunching up at every vertex. Queues circles into `g`; the caller applies the fill.
 */
export function drawDottedPolyline(
  g: Graphics,
  points: readonly Vec2[],
  spacing: number,
  dotRadius: number,
  jitter: number,
  seed: number
) {
  if (points.length < 2) return;
  const rng = Rng.seeded(seed, 0);
  let next = 0; // arc-length of the next dot
  let acc = 0; // arc-length at the current segment's start
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 0.001) continue;
    const nx = (b.x - a.x) / segLen, ny = (b.y - a.y) / segLen;
    while (next <= acc + segLen) {
      const d = next - acc;
      g.circle(a.x + nx * d + rng.symmetric() * jitter, a.y + ny * d + rng.symmetric() * jitter, dotRadius);
      next += spacing;
    }
    acc += segLen;
  }
}

export function drawRoughEllipse(
  g: Graphics,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  wobble: number,
  segments: number,
  seed: number
) {
  const rng = Rng.seeded(seed, 0);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = cx + Math.cos(angle) * (rx + rng.symmetric() * wobble);
    const y = cy + Math.sin(angle) * (ry + rng.symmetric() * wobble);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

export function drawRoughArc(
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
  const rng = Rng.seeded(seed, 0);
  const span = endAngle - startAngle;
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * span;
    const r = radius + rng.symmetric() * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

export function drawRoughLine(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  wobble: number,
  seed: number
) {
  const rng = Rng.seeded(seed, 0);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const segments = Math.max(4, Math.floor(dist / 8));
  const perpX = -dy / dist;
  const perpY = dx / dist;

  g.moveTo(x1 + rng.symmetric() * wobble * perpX, y1 + rng.symmetric() * wobble * perpY);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = x1 + dx * t + rng.symmetric() * wobble * perpX;
    const y = y1 + dy * t + rng.symmetric() * wobble * perpY;
    g.lineTo(x, y);
  }
}

export function drawRoughRect(
  g: Graphics,
  corners: readonly Vec2[],
  wobble: number,
  seed: number
) {
  const rng = Rng.seeded(seed, 0);
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]!;
    const x = c.x + rng.symmetric() * wobble;
    const y = c.y + rng.symmetric() * wobble;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  const first = corners[0]!;
  g.lineTo(first.x + rng.symmetric() * wobble, first.y + rng.symmetric() * wobble);
}

export function drawXMark(
  g: Graphics,
  cx: number,
  cy: number,
  size: number,
  seed: number
) {
  const rng = Rng.seeded(seed, 0);
  const w = 0.8;
  g.moveTo(cx - size + rng.symmetric() * w, cy - size + rng.symmetric() * w);
  g.lineTo(cx + size + rng.symmetric() * w, cy + size + rng.symmetric() * w);
  g.moveTo(cx + size + rng.symmetric() * w, cy - size + rng.symmetric() * w);
  g.lineTo(cx - size + rng.symmetric() * w, cy + size + rng.symmetric() * w);
}
