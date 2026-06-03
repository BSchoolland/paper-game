import type { Entity, GridState, Vec2 } from "../core/types.js";
import { pathfindFlood, type FloodResult } from "./pathfinding.js";
import { moveRadiusOf } from "../combat/movement.js";

/**
 * The set of tiles a unit can actually *reach* this turn (path distance ≤ move budget, body-clearance),
 * plus a sketched outline of that region for the move-range overlay. This replaces the straight-line
 * range circle: it's the real path-based reachable area, so it deforms around walls and obstacles.
 *
 * `flood.pathTo(cursor, cap)` snaps a cursor to the nearest reachable tile (use for click/preview);
 * `contours` are closed world-space loops to stroke for the deformed "circle".
 */
export interface ReachableArea {
  readonly flood: FloodResult;
  readonly cap: number;
  readonly contours: Vec2[][];
}

// Node spacing for the visual outline. Coarser than the collision grid → a clean, smooth blob and a
// cheap contour; the snap/cost still come from the (fine) authoritative path, so accuracy is unaffected.
const BLOB_STEP = 12;

export function reachableArea(
  entity: Entity,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  maxDistance: number,
): ReachableArea {
  const flood = pathfindFlood(entity.position, grid, moveRadiusOf(entity), entities, entity.id, maxDistance, BLOB_STEP);
  const contours = marchingSquares(flood).map((loop) => chaikin(loop, 2));
  return { flood, cap: maxDistance, contours };
}

// --- marching squares over the reachable bitmap ----------------------------
// Classic contour extraction: each 2×2 block of "reachable" samples maps to boundary segments
// through the block's edge midpoints; segments chain into closed loops separating reachable from not.

const SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [Edge, Edge]>> = buildSegmentTable();
type Edge = "T" | "R" | "B" | "L";

function buildSegmentTable(): ReadonlyArray<ReadonlyArray<readonly [Edge, Edge]>> {
  // code = TL<<3 | TR<<2 | BR<<1 | BL. Each entry lists the edge pairs the contour connects.
  const t: Record<number, [Edge, Edge][]> = {
    0: [], 15: [],
    1: [["L", "B"]], 14: [["L", "B"]],
    2: [["B", "R"]], 13: [["B", "R"]],
    4: [["T", "R"]], 11: [["T", "R"]],
    8: [["T", "L"]], 7: [["T", "L"]],
    3: [["L", "R"]], 12: [["L", "R"]],
    6: [["T", "B"]], 9: [["T", "B"]],
    5: [["T", "L"], ["B", "R"]], // saddle
    10: [["T", "R"], ["B", "L"]], // saddle
  };
  return Array.from({ length: 16 }, (_, i) => t[i] ?? []);
}

function marchingSquares(flood: FloodResult): Vec2[][] {
  const { seen, pgW, pgH, step } = flood;
  const inside = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < pgW && cy < pgH && seen[cx * pgH + cy] === 1;

  const segments: [Vec2, Vec2][] = [];
  for (let cx = 0; cx < pgW - 1; cx++) {
    for (let cy = 0; cy < pgH - 1; cy++) {
      const code =
        (inside(cx, cy) ? 8 : 0) |
        (inside(cx + 1, cy) ? 4 : 0) |
        (inside(cx + 1, cy + 1) ? 2 : 0) |
        (inside(cx, cy + 1) ? 1 : 0);
      const pairs = SEGMENTS[code]!;
      if (pairs.length === 0) continue;
      const edge = (e: Edge): Vec2 => {
        switch (e) {
          case "T": return { x: (cx + 0.5) * step, y: cy * step };
          case "R": return { x: (cx + 1) * step, y: (cy + 0.5) * step };
          case "B": return { x: (cx + 0.5) * step, y: (cy + 1) * step };
          case "L": return { x: cx * step, y: (cy + 0.5) * step };
        }
      };
      for (const [a, b] of pairs) segments.push([edge(a), edge(b)]);
    }
  }
  return chainLoops(segments);
}

function chainLoops(segments: [Vec2, Vec2][]): Vec2[][] {
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const nodes = new Map<string, { pt: Vec2; links: string[] }>();
  const ensure = (p: Vec2): string => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { pt: p, links: [] });
    return k;
  };
  for (const [a, b] of segments) {
    const ka = ensure(a), kb = ensure(b);
    nodes.get(ka)!.links.push(kb);
    nodes.get(kb)!.links.push(ka);
  }
  const edgeKey = (k1: string, k2: string) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);
  const used = new Set<string>();
  const loops: Vec2[][] = [];

  for (const [startK, node] of nodes) {
    for (const firstNb of node.links) {
      if (used.has(edgeKey(startK, firstNb))) continue;
      const loop: Vec2[] = [node.pt];
      let prevK = startK, curK = firstNb;
      used.add(edgeKey(prevK, curK));
      let guard = 0;
      while (curK !== startK && guard++ < 1_000_000) {
        const cur = nodes.get(curK)!;
        loop.push(cur.pt);
        let nextK: string | undefined;
        for (const l of cur.links) {
          if (l === prevK) continue;
          if (used.has(edgeKey(curK, l))) continue;
          nextK = l;
          break;
        }
        if (nextK === undefined) break;
        used.add(edgeKey(curK, nextK));
        prevK = curK;
        curK = nextK;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

// Chaikin corner-cutting on a closed loop — rounds the axis-aligned marching-squares steps into a
// smooth blob before the sketchy pencil stroke adds its wobble.
function chaikin(loop: Vec2[], iterations: number): Vec2[] {
  let pts = loop;
  for (let it = 0; it < iterations; it++) {
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}
