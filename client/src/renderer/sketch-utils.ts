import type { Graphics } from "pixi.js";
import type { Vec2 } from "shared";

export const PENCIL = 0x4a3728;
export const PENCIL_HIT = 0x8b3a3a;
export const PENCIL_LIGHT = 0x6b5a48;

export function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 0xffffffff - 0.5) * 2;
  };
}

export function drawRoughCircle(
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
  const rand = seededRand(seed);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = cx + Math.cos(angle) * (rx + rand() * wobble);
    const y = cy + Math.sin(angle) * (ry + rand() * wobble);
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

export function drawRoughLine(
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

export function drawRoughRect(
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

export function drawXMark(
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
