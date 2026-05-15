import type { Entity, GridState, Vec2 } from "../core/types.js";
import { distance } from "../core/vec2.js";
import { isPositionWalkable, isWithinBounds } from "./collision-grid.js";

// Pathfinder operates on a 16-px sub-grid on top of the collision grid. Cell index encoding:
// every cell maps to an integer in [0, pgW*pgH). gScore / cameFrom / closed are typed-array
// backed; the open set is a binary min-heap. Together these replace the previous Map+linear-scan
// implementation and cut A* self-time by an order of magnitude on real boards.
const STEP = 16;
const DIAG_COST = Math.SQRT2 * STEP;
const NEIGHBOR_COUNT = 8;
const NDX = new Int32Array([-STEP, STEP, 0, 0, -STEP, STEP, -STEP, STEP]);
const NDY = new Int32Array([0, 0, -STEP, STEP, -STEP, -STEP, STEP, STEP]);
const NCOST = new Float64Array([STEP, STEP, STEP, STEP, DIAG_COST, DIAG_COST, DIAG_COST, DIAG_COST]);

function pgDims(grid: GridState): { pgW: number; pgH: number } {
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  // +1 so a snapped cell at the world boundary is in range.
  return { pgW: Math.ceil(worldW / STEP) + 1, pgH: Math.ceil(worldH / STEP) + 1 };
}

/**
 * Walkability bitmap precomputed per (grid, agentRadius). A cell is "walkable" iff it's in
 * bounds AND no wall overlaps the agent's disc placed there. The grid is immutable (setBlocked
 * returns a new GridState), so the WeakMap key naturally invalidates on wall changes.
 *
 * Inner-loop replacement: `isWithinBounds + isPositionWalkable` (two function calls + a small
 * rectangle scan of collision cells) → single Uint8Array byte read.
 */
const walkableCache = new WeakMap<GridState, Map<number, Uint8Array>>();
function getWalkableMask(grid: GridState, agentRadius: number): Uint8Array {
  let byRadius = walkableCache.get(grid);
  if (!byRadius) { byRadius = new Map(); walkableCache.set(grid, byRadius); }
  const cached = byRadius.get(agentRadius);
  if (cached) return cached;
  const { pgW, pgH } = pgDims(grid);
  const mask = new Uint8Array(pgW * pgH);
  for (let cx = 0; cx < pgW; cx++) {
    for (let cy = 0; cy < pgH; cy++) {
      const pos = { x: cx * STEP, y: cy * STEP };
      if (isWithinBounds(grid, pos, agentRadius) && isPositionWalkable(grid, pos, agentRadius)) {
        mask[cx * pgH + cy] = 1;
      }
    }
  }
  byRadius.set(agentRadius, mask);
  return mask;
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy - 0.414 * Math.min(dx, dy);
}

/** Flat typed-array snapshot of blocker entities. Pathfind iterates this in its hot inner loop —
 *  no Map iterator overhead, no per-cell `r * r`, no dead/self filtering. */
interface BlockerArrays {
  bx: Float64Array;
  by: Float64Array;
  br2: Float64Array;  // (agentRadius + entityRadius)²
  n: number;
}

function buildBlockers(
  entities: ReadonlyMap<string, Entity>, selfId: string, agentRadius: number,
): BlockerArrays {
  let n = 0;
  for (const e of entities.values()) if (!e.dead && e.id !== selfId) n++;
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  const br2 = new Float64Array(n);
  let i = 0;
  for (const e of entities.values()) {
    if (e.dead || e.id === selfId) continue;
    bx[i] = e.position.x;
    by[i] = e.position.y;
    const r = agentRadius + e.collisionRadius;
    br2[i] = r * r;
    i++;
  }
  return { bx, by, br2, n };
}

function overlapsBlocker(px: number, py: number, b: BlockerArrays): boolean {
  const { bx, by, br2, n } = b;
  for (let i = 0; i < n; i++) {
    const dx = px - bx[i]!;
    const dy = py - by[i]!;
    if (dx * dx + dy * dy < br2[i]!) return true;
  }
  return false;
}

// --- binary min-heap, keyed by score; payload is the cell index --------------
// Parallel typed arrays for speed. Auto-grows on overflow.
class MinHeap {
  private fs: Float64Array;
  private ix: Int32Array;
  private n = 0;
  constructor(capacity: number) {
    this.fs = new Float64Array(capacity);
    this.ix = new Int32Array(capacity);
  }
  get size(): number { return this.n; }
  push(f: number, idx: number): void {
    if (this.n === this.fs.length) {
      const nf = new Float64Array(this.n * 2);
      const ni = new Int32Array(this.n * 2);
      nf.set(this.fs); ni.set(this.ix);
      this.fs = nf; this.ix = ni;
    }
    let i = this.n++;
    this.fs[i] = f; this.ix[i] = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fs[p]! <= this.fs[i]!) break;
      const tf = this.fs[p]!, ti = this.ix[p]!;
      this.fs[p] = this.fs[i]!; this.ix[p] = this.ix[i]!;
      this.fs[i] = tf; this.ix[i] = ti;
      i = p;
    }
  }
  popIdx(): number {
    const out = this.ix[0]!;
    this.n--;
    if (this.n > 0) {
      this.fs[0] = this.fs[this.n]!;
      this.ix[0] = this.ix[this.n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let best = i;
        if (l < this.n && this.fs[l]! < this.fs[best]!) best = l;
        if (r < this.n && this.fs[r]! < this.fs[best]!) best = r;
        if (best === i) break;
        const tf = this.fs[best]!, ti = this.ix[best]!;
        this.fs[best] = this.fs[i]!; this.ix[best] = this.ix[i]!;
        this.fs[i] = tf; this.ix[i] = ti;
        i = best;
      }
    }
    return out;
  }
}

/**
 * A* path through static geometry only. Entities don't block transit — `pathfindMove` handles
 * picking an entity-free endpoint along the returned path. (Engine semantics: the move resolver
 * only validates the destination cell, so units already "transit" through each other.)
 */
export function pathfind(
  from: Vec2,
  to: Vec2,
  grid: GridState,
  collisionRadius: number,
  maxNodes = 2000,
  /** If provided, A* skips cells whose cost-to-reach exceeds this. */
  maxDistance: number = Infinity,
): Vec2[] {
  const { pgW, pgH } = pgDims(grid);
  const scx = Math.round(from.x / STEP);
  const scy = Math.round(from.y / STEP);
  const gcx = Math.round(to.x / STEP);
  const gcy = Math.round(to.y / STEP);
  if (scx === gcx && scy === gcy) return [to];
  if (scx < 0 || scx >= pgW || scy < 0 || scy >= pgH) return [];
  const startIdx = scx * pgH + scy;
  const walkable = getWalkableMask(grid, collisionRadius);

  const total = pgW * pgH;
  const gScore = new Float64Array(total);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);
  // Track only the cells we've touched, so the "best partial path" fallback doesn't scan the
  // whole grid.
  const touched: number[] = [];

  gScore[startIdx] = 0;
  touched.push(startIdx);
  const open = new MinHeap(64);
  open.push(heuristic(scx * STEP, scy * STEP, gcx * STEP, gcy * STEP), startIdx);

  let explored = 0;
  while (open.size > 0) {
    if (++explored > maxNodes) break;
    const curIdx = open.popIdx();
    if (closed[curIdx]) continue;
    closed[curIdx] = 1;
    const cx = (curIdx / pgH) | 0;
    const cy = curIdx - cx * pgH;
    if (cx === gcx && cy === gcy) {
      return reconstructPath(cameFrom, curIdx, pgH, to);
    }
    const currentG = gScore[curIdx]!;
    const px = cx * STEP, py = cy * STEP;
    for (let i = 0; i < NEIGHBOR_COUNT; i++) {
      const nx = px + NDX[i]!;
      const ny = py + NDY[i]!;
      const ncx = nx / STEP | 0;
      const ncy = ny / STEP | 0;
      if (ncx < 0 || ncx >= pgW || ncy < 0 || ncy >= pgH) continue;
      const nIdx = ncx * pgH + ncy;
      if (closed[nIdx]) continue;
      const tentG = currentG + NCOST[i]!;
      if (tentG > maxDistance) continue;
      if (tentG >= gScore[nIdx]!) continue;

      if (!walkable[nIdx]) continue;

      if (gScore[nIdx] === Infinity) touched.push(nIdx);
      gScore[nIdx] = tentG;
      cameFrom[nIdx] = curIdx;
      open.push(tentG + heuristic(nx, ny, gcx * STEP, gcy * STEP), nIdx);
    }
  }

  // No path — best partial: closest touched cell by heuristic to goal.
  let bestIdx = startIdx;
  let bestD = heuristic(scx * STEP, scy * STEP, gcx * STEP, gcy * STEP);
  for (let i = 0; i < touched.length; i++) {
    const k = touched[i]!;
    const cx = (k / pgH) | 0;
    const cy = k - cx * pgH;
    const d = heuristic(cx * STEP, cy * STEP, gcx * STEP, gcy * STEP);
    if (d < bestD) { bestD = d; bestIdx = k; }
  }
  if (bestIdx === startIdx) return [];
  return reconstructPath(cameFrom, bestIdx, pgH, null);
}

function reconstructPath(
  cameFrom: Int32Array,
  endIdx: number,
  pgH: number,
  exactGoal: Vec2 | null,
): Vec2[] {
  const idxs: number[] = [];
  let cur = endIdx;
  while (cur !== -1 && cameFrom[cur] !== -1) {
    idxs.push(cur);
    cur = cameFrom[cur]!;
  }
  idxs.reverse();
  const path: Vec2[] = new Array(idxs.length);
  for (let i = 0; i < idxs.length; i++) {
    const k = idxs[i]!;
    const cx = (k / pgH) | 0;
    const cy = k - cx * pgH;
    path[i] = { x: cx * STEP, y: cy * STEP };
  }
  if (exactGoal && path.length > 0) path[path.length - 1] = exactGoal;
  return path;
}

/**
 * Dijkstra flood from `from`, settling every cell reachable within `maxDistance` of grid cost.
 * Use when you'll be running many `pathfindMove`-equivalent queries from the same start, against
 * the same entity layout — build the flood once, look up each target in O(touched cells).
 */
export interface FloodResult {
  /** Cost-to-reach for each settled cell index; Infinity elsewhere. */
  readonly gScore: Float64Array;
  /** Snapped start cell index (gScore[startIdx] === 0). */
  readonly startIdx: number;
  /**
   * Mirrors `pathfindMove`'s return: the best reachable point toward `target` within `maxDist`,
   * or `null` if no meaningful progress is possible.
   */
  pathTo(target: Vec2, maxDist: number): Vec2 | null;
}

export function pathfindFlood(
  from: Vec2,
  grid: GridState,
  collisionRadius: number,
  entities: ReadonlyMap<string, Entity>,
  selfId: string,
  maxDistance: number,
): FloodResult {
  const { pgW, pgH } = pgDims(grid);
  const scx = Math.round(from.x / STEP);
  const scy = Math.round(from.y / STEP);
  const total = pgW * pgH;
  const gScore = new Float64Array(total);
  gScore.fill(Infinity);
  const closed = new Uint8Array(total);
  const touched: number[] = [];
  const startIdx = scx * pgH + scy;
  if (scx < 0 || scx >= pgW || scy < 0 || scy >= pgH) {
    return makeFloodResult(gScore, startIdx, touched, pgH, from, buildBlockers(entities, selfId, collisionRadius));
  }
  gScore[startIdx] = 0;
  touched.push(startIdx);
  // Blockers are NOT used during expansion (entities don't block transit). They're checked only
  // when selecting the endpoint in `pathTo`.
  const blockers = buildBlockers(entities, selfId, collisionRadius);
  const walkable = getWalkableMask(grid, collisionRadius);

  const open = new MinHeap(64);
  open.push(0, startIdx);

  while (open.size > 0) {
    const curIdx = open.popIdx();
    if (closed[curIdx]) continue;
    closed[curIdx] = 1;
    const curG = gScore[curIdx]!;
    const cx = (curIdx / pgH) | 0;
    const cy = curIdx - cx * pgH;
    const px = cx * STEP, py = cy * STEP;
    for (let i = 0; i < NEIGHBOR_COUNT; i++) {
      const tentG = curG + NCOST[i]!;
      if (tentG > maxDistance) continue;
      const nx = px + NDX[i]!;
      const ny = py + NDY[i]!;
      const ncx = nx / STEP | 0;
      const ncy = ny / STEP | 0;
      if (ncx < 0 || ncx >= pgW || ncy < 0 || ncy >= pgH) continue;
      const nIdx = ncx * pgH + ncy;
      if (closed[nIdx]) continue;
      if (tentG >= gScore[nIdx]!) continue;

      if (!walkable[nIdx]) continue;

      if (gScore[nIdx] === Infinity) touched.push(nIdx);
      gScore[nIdx] = tentG;
      open.push(tentG, nIdx);
    }
  }

  return makeFloodResult(gScore, startIdx, touched, pgH, from, blockers);
}

function makeFloodResult(
  gScore: Float64Array, startIdx: number, touched: number[], pgH: number, from: Vec2, blockers: BlockerArrays,
): FloodResult {
  return {
    gScore,
    startIdx,
    pathTo(target: Vec2, maxDist: number): Vec2 | null {
      const tcx = Math.round(target.x / STEP);
      const tcy = Math.round(target.y / STEP);
      const tIdx = tcx * pgH + tcy;
      const exactG = tIdx >= 0 && tIdx < gScore.length ? gScore[tIdx] : Infinity;
      // Exact-goal path is fine only if the endpoint isn't on top of another entity.
      if (exactG !== undefined && exactG <= maxDist && !overlapsBlocker(target.x, target.y, blockers)) {
        if (distance(target, from) < 1) return null;
        return { x: target.x, y: target.y };
      }
      // Closest touched cell to target (by heuristic) that's within budget AND not entity-occupied.
      let bestIdx = -1;
      let bestD = Infinity;
      for (let i = 0; i < touched.length; i++) {
        const k = touched[i]!;
        if (gScore[k]! > maxDist) continue;
        const cx = (k / pgH) | 0;
        const cy = k - cx * pgH;
        const px = cx * STEP, py = cy * STEP;
        if (overlapsBlocker(px, py, blockers)) continue;
        const d = heuristic(px, py, tcx * STEP, tcy * STEP);
        if (d < bestD) { bestD = d; bestIdx = k; }
      }
      if (bestIdx < 0) return null;
      const bcx = (bestIdx / pgH) | 0;
      const bcy = bestIdx - bcx * pgH;
      const bx = bcx * STEP, by = bcy * STEP;
      if (distance({ x: bx, y: by }, from) < 1) return null;
      return { x: bx, y: by };
    },
  };
}

export function pathfindMove(
  entity: Entity,
  target: Vec2,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  maxDistance?: number,
): Vec2 | null {
  const moveAbility = entity.abilities.find(a => a.kind === "move");
  const remainingInitial = maxDistance ?? (moveAbility ? (moveAbility as import("../core/types.js").MoveAbility).distance : 0);
  // Add a small slack so the search can still find a path that goes slightly around an obstacle —
  // we clip to the actual budget below. Without slack, going around a corner can be pruned away.
  const searchCap = remainingInitial * 1.5;
  const path = pathfind(
    entity.position, target, grid,
    entity.collisionRadius, 2000, searchCap,
  );
  if (path.length === 0) return null;

  // Entities don't block transit, only endpoints — so walk the path normally but only commit a
  // waypoint as `bestPoint` if it's entity-free. Keep advancing `current` either way.
  const blockers = buildBlockers(entities, entity.id, entity.collisionRadius);
  let remaining = remainingInitial;
  let current = entity.position;
  let bestPoint: Vec2 = entity.position;

  for (const waypoint of path) {
    const segDist = distance(current, waypoint);
    if (segDist <= remaining) {
      remaining -= segDist;
      if (!overlapsBlocker(waypoint.x, waypoint.y, blockers)) bestPoint = waypoint;
      current = waypoint;
    } else {
      const ratio = remaining / segDist;
      const clip = {
        x: current.x + (waypoint.x - current.x) * ratio,
        y: current.y + (waypoint.y - current.y) * ratio,
      };
      if (!overlapsBlocker(clip.x, clip.y, blockers)) bestPoint = clip;
      break;
    }
  }

  if (distance(bestPoint, entity.position) < 1) return null;
  return bestPoint;
}
