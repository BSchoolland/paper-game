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
 * Sketchy pencil stroke along an arbitrary polyline — same hand-drawn wobble as `drawRoughCircle`
 * but for any path (e.g. the deformed reachable-area outline). Jitters each vertex perpendicular-ish
 * via a seeded RNG so the line stays deterministic frame-to-frame. Pass `closed` to join the ends.
 */
export function drawRoughPath(
  g: Graphics,
  points: readonly { x: number; y: number }[],
  wobble: number,
  seed: number,
  closed: boolean
) {
  if (points.length < 2) return;
  const rng = Rng.seeded(seed, 0);
  const n = closed ? points.length + 1 : points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i % points.length]!;
    const x = p.x + rng.symmetric() * wobble;
    const y = p.y + rng.symmetric() * wobble;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
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
