import type { Graphics } from "pixi.js";
import type { Zone, ZoneEffectKind, ZonePattern } from "shared";
import { drawRoughCircle, drawRoughArc } from "./sketch-utils.js";

/** What a zone looks like when its `pattern` isn't given — picked to read as the effect. */
const DEFAULT_PATTERN: Record<ZoneEffectKind, ZonePattern> = {
  damage: "spikes",
  heal: "pulse",
  addBarrier: "shield",
  drainRed: "drain",
  drainBlue: "drain",
  cover: "lattice",
  wall: "solid",
};

function patternOf(zone: Zone): ZonePattern {
  return zone.pattern ?? DEFAULT_PATTERN[zone.effect];
}

function fillAlpha(zone: Zone): number {
  return zone.effect === "wall" ? 0.42 : zone.effect === "cover" ? 0.3 : 0.16;
}

/** Stable per-zone seed so the rough strokes don't jitter between frames. */
function seedOf(id: string, salt = 0): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 9973 + 1;
}

/** Draws every live zone: a tinted disc, a rough rim, and the effect-telegraphing motif. */
export function drawZones(g: Graphics, zones: readonly Zone[]): void {
  for (const zone of zones) {
    g.circle(zone.center.x, zone.center.y, zone.radius);
    g.fill({ color: zone.color, alpha: fillAlpha(zone) });
    drawRoughCircle(g, zone.center.x, zone.center.y, zone.radius, 1.5, 36, seedOf(zone.id));
    g.stroke({ color: zone.color, alpha: 0.6, width: 1.5 });
    drawMotif(g, zone.center.x, zone.center.y, zone.radius, zone.color, patternOf(zone), seedOf(zone.id, 7), 1);
  }
}

/** A placement-preview disc for `zone` at its (already clamped) centre; faded, dashed if invalid. */
export function drawZonePreview(g: Graphics, zone: Zone, valid: boolean): void {
  const color = valid ? zone.color : 0x8b3a3a;
  g.circle(zone.center.x, zone.center.y, zone.radius);
  g.fill({ color, alpha: 0.13 });
  drawRoughCircle(g, zone.center.x, zone.center.y, zone.radius, 1.5, 28, 53);
  g.stroke({ color, alpha: 0.65, width: 1.3 });
  drawMotif(g, zone.center.x, zone.center.y, zone.radius, color, patternOf(zone), 59, 0.6);
}

function drawMotif(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  color: number,
  pattern: ZonePattern,
  seed: number,
  alphaScale: number
): void {
  switch (pattern) {
    case "spikes": {
      // Jagged teeth pointing inward from the rim — "this hurts to stand in".
      const n = Math.max(7, Math.round(r / 7));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (seed % 17) * 0.01;
        const half = (Math.PI / n) * 0.55;
        const tipR = r * 0.62;
        g.moveTo(cx + Math.cos(a - half) * r, cy + Math.sin(a - half) * r);
        g.lineTo(cx + Math.cos(a) * tipR, cy + Math.sin(a) * tipR);
        g.lineTo(cx + Math.cos(a + half) * r, cy + Math.sin(a + half) * r);
      }
      g.stroke({ color, alpha: 0.55 * alphaScale, width: 1.4 });
      break;
    }
    case "pulse": {
      // Soft concentric rings + a centre cross — restorative.
      for (let i = 1; i <= 3; i++) {
        drawRoughCircle(g, cx, cy, r * (i / 4), 1, 24, seed + i * 13);
        g.stroke({ color, alpha: (0.5 - i * 0.1) * alphaScale, width: 1.6 });
      }
      const c = r * 0.16;
      g.moveTo(cx - c, cy); g.lineTo(cx + c, cy);
      g.moveTo(cx, cy - c); g.lineTo(cx, cy + c);
      g.stroke({ color, alpha: 0.6 * alphaScale, width: 2 });
      break;
    }
    case "shield": {
      // Overlapping shield-curve arcs — protective.
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * Math.PI * 2;
        drawRoughArc(g, cx, cy, r * 0.72, a0 - 0.7, a0 + 0.7, 1.2, 14, seed + i * 19);
        drawRoughArc(g, cx, cy, r * 0.42, a0 - 0.7, a0 + 0.7, 1.0, 12, seed + i * 23);
      }
      g.stroke({ color, alpha: 0.55 * alphaScale, width: 1.5 });
      break;
    }
    case "drain": {
      // Chevrons aimed at the centre — energy being pulled out of you.
      const n = Math.max(6, Math.round(r / 9));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const baseR = r * 0.85;
        const tipR = r * 0.5;
        const wing = (Math.PI / n) * 0.6;
        g.moveTo(cx + Math.cos(a - wing) * baseR, cy + Math.sin(a - wing) * baseR);
        g.lineTo(cx + Math.cos(a) * tipR, cy + Math.sin(a) * tipR);
        g.lineTo(cx + Math.cos(a + wing) * baseR, cy + Math.sin(a + wing) * baseR);
      }
      g.stroke({ color, alpha: 0.5 * alphaScale, width: 1.4 });
      break;
    }
    case "lattice":
    case "solid": {
      // A bounded crosshatch of small ✕ marks — sparse for cover, dense for a wall.
      const spacing = pattern === "solid" ? r * 0.3 : r * 0.5;
      const dash = spacing * 0.42;
      for (let gx = -r; gx <= r; gx += spacing) {
        for (let gy = -r; gy <= r; gy += spacing) {
          if (gx * gx + gy * gy > r * r * 0.92) continue;
          const px = cx + gx, py = cy + gy;
          g.moveTo(px - dash, py - dash); g.lineTo(px + dash, py + dash);
          g.moveTo(px - dash, py + dash); g.lineTo(px + dash, py - dash);
        }
      }
      g.stroke({ color, alpha: (pattern === "solid" ? 0.6 : 0.4) * alphaScale, width: pattern === "solid" ? 1.6 : 1.2 });
      if (pattern === "solid") {
        drawRoughCircle(g, cx, cy, r * 0.97, 1, 32, seed + 41);
        g.stroke({ color, alpha: 0.5 * alphaScale, width: 1.4 });
      }
      break;
    }
  }
}
