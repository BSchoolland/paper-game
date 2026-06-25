import type { Entity, GridState, Vec2 } from "../core/types.js";
import { distance } from "../core/vec2.js";
import { isPositionWalkable, isWithinBounds } from "./collision-grid.js";
import { moveRadiusOf } from "../combat/movement.js";

// The pathfinder searches on a node grid whose spacing == the collision grid's own cellSize, so it
// can navigate any corridor the collision grid can represent (down to a single cell wide). A coarser
// node grid (the old fixed 16px) skips over thin corridors entirely — no node lands inside them — so
// A* can't even find the route. Node (cx,cy) maps to world (cx*step, cy*step) and flat index
// cx*pgH+cy. gScore / cameFrom / closed are typed-array backed; the open set is a binary min-heap.
function pathStep(grid: GridState): number { return grid.cellSize; }

// A* treats the agent as a true point (radius 0) so the route may thread any open gap regardless of
// body size; the endpoint is then validated at full radius and, if illegal, flood-filled outward to
// the nearest legal stop (see `nudgeToLegal`).
const TRANSIT_RADIUS = 0;
// `pathfindMove` searches the whole route to the target (no per-turn distance cap), so the unit
// always commits to the globally-correct path instead of a myopic best-partial that can point into
// a dead end. The closed-set bounds real work at the cell count; this is just a safety ceiling.
const MAX_PATHFIND_NODES = 1_000_000;
const NEIGHBOR_COUNT = 8;
// 8-neighbour offsets in *node* units (scaled by `step` for world px). Costs likewise in node units.
const NOX = [-1, 1, 0, 0, -1, 1, -1, 1];
const NOY = [0, 0, -1, 1, -1, -1, 1, 1];
const NOC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// Step used for the optional coarse pre-pass in `pathfindMove` (see there). Bigger than any real
// cellSize, so the coarse search has ~(16/cellSize)² fewer nodes.
const COARSE_STEP = 16;

function pgDims(grid: GridState, step: number): { pgW: number; pgH: number } {
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  // +1 so a snapped cell at the world boundary is in range.
  return { pgW: Math.ceil(worldW / step) + 1, pgH: Math.ceil(worldH / step) + 1 };
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
function getWalkableMask(grid: GridState, agentRadius: number, step: number): Uint8Array {
  let byKey = walkableCache.get(grid);
  if (!byKey) { byKey = new Map(); walkableCache.set(grid, byKey); }
  const key = agentRadius * 1000 + step; // mask depends on both the body radius and the node step
  const cached = byKey.get(key);
  if (cached) return cached;
  const { pgW, pgH } = pgDims(grid, step);
  const mask = new Uint8Array(pgW * pgH);
  for (let cx = 0; cx < pgW; cx++) {
    for (let cy = 0; cy < pgH; cy++) {
      const pos = { x: cx * step, y: cy * step };
      if (isWithinBounds(grid, pos, agentRadius) && isPositionWalkable(grid, pos, agentRadius)) {
        mask[cx * pgH + cy] = 1;
      }
    }
  }
  byKey.set(key, mask);
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
    const r = agentRadius + moveRadiusOf(e);
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
  clear(): void { this.n = 0; }
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

// --- reusable A* scratch, keyed by node-count -------------------------------
// A fresh A* would allocate gScore/cameFrom/closed (~N each) and fill gScore with Infinity every
// call — O(N) overhead that dominates now that N is the fine collision-grid cell count (~120k).
// Instead we keep one buffer set per node-count and tag each write with a monotonic generation: a
// cell is "unvisited this call" unless its stamp == the current generation. No per-call fill, no
// realloc; cost drops to O(cells actually touched). Behaviour is identical to the cleared version.
interface AStarScratch {
  gScore: Float64Array;
  cameFrom: Int32Array;
  stamp: Int32Array;        // generation that last wrote gScore/cameFrom for the cell
  closedStamp: Int32Array;  // generation that closed the cell
  touched: Int32Array;      // indices written this call (drives the best-partial fallback)
  heap: MinHeap;
}
const scratchBySize = new Map<number, AStarScratch>();
let astarGen = 0;
function getScratch(total: number): AStarScratch {
  let s = scratchBySize.get(total);
  if (!s) {
    s = {
      gScore: new Float64Array(total), cameFrom: new Int32Array(total),
      stamp: new Int32Array(total), closedStamp: new Int32Array(total),
      touched: new Int32Array(total), heap: new MinHeap(256),
    };
    scratchBySize.set(total, s);
  }
  return s;
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
  /** Node spacing override (defaults to the collision cellSize). Used for the coarse pre-pass. */
  stepOverride?: number,
): Vec2[] {
  const step = stepOverride ?? pathStep(grid);
  const { pgW, pgH } = pgDims(grid, step);
  const scx = Math.round(from.x / step);
  const scy = Math.round(from.y / step);
  const gcx = Math.round(to.x / step);
  const gcy = Math.round(to.y / step);
  if (scx === gcx && scy === gcy) return [to];
  if (scx < 0 || scx >= pgW || scy < 0 || scy >= pgH) return [];
  const startIdx = scx * pgH + scy;
  const walkable = getWalkableMask(grid, collisionRadius, step);

  const total = pgW * pgH;
  const sc = getScratch(total);
  const gen = ++astarGen;
  const { gScore, cameFrom, stamp, closedStamp, touched, heap } = sc;
  heap.clear();
  let tCount = 0;

  stamp[startIdx] = gen; gScore[startIdx] = 0; cameFrom[startIdx] = -1;
  touched[tCount++] = startIdx;
  const gx = gcx * step, gy = gcy * step;
  heap.push(heuristic(scx * step, scy * step, gx, gy), startIdx);

  let explored = 0;
  while (heap.size > 0) {
    if (++explored > maxNodes) break;
    const curIdx = heap.popIdx();
    if (closedStamp[curIdx] === gen) continue;
    closedStamp[curIdx] = gen;
    const cx = (curIdx / pgH) | 0;
    const cy = curIdx - cx * pgH;
    if (cx === gcx && cy === gcy) {
      return reconstructPath(cameFrom, curIdx, pgH, step, to);
    }
    const currentG = gScore[curIdx]!;
    for (let i = 0; i < NEIGHBOR_COUNT; i++) {
      const ncx = cx + NOX[i]!;
      const ncy = cy + NOY[i]!;
      if (ncx < 0 || ncx >= pgW || ncy < 0 || ncy >= pgH) continue;
      const nIdx = ncx * pgH + ncy;
      if (closedStamp[nIdx] === gen) continue;
      const tentG = currentG + NOC[i]! * step;
      if (tentG > maxDistance) continue;
      const known = stamp[nIdx] === gen ? gScore[nIdx]! : Infinity;
      if (tentG >= known) continue;

      if (!walkable[nIdx]) continue;

      if (stamp[nIdx] !== gen) touched[tCount++] = nIdx;
      stamp[nIdx] = gen; gScore[nIdx] = tentG; cameFrom[nIdx] = curIdx;
      heap.push(tentG + heuristic(ncx * step, ncy * step, gx, gy), nIdx);
    }
  }

  // No path — best partial: closest touched cell by heuristic to goal.
  let bestIdx = startIdx;
  let bestD = heuristic(scx * step, scy * step, gx, gy);
  for (let i = 0; i < tCount; i++) {
    const k = touched[i]!;
    const cx = (k / pgH) | 0;
    const cy = k - cx * pgH;
    const d = heuristic(cx * step, cy * step, gx, gy);
    if (d < bestD) { bestD = d; bestIdx = k; }
  }
  if (bestIdx === startIdx) return [];
  return reconstructPath(cameFrom, bestIdx, pgH, step, null);
}

function reconstructPath(
  cameFrom: Int32Array,
  endIdx: number,
  pgH: number,
  step: number,
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
    path[i] = { x: cx * step, y: cy * step };
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
  /** Cost-to-reach for each cell index; only valid where `seen[idx]` is 1 (the fill is skipped). */
  readonly gScore: Float64Array;
  /** 1 for cells reached within budget (gScore valid), 0 otherwise. The reachable-cell bitmap. */
  readonly seen: Uint8Array;
  /** Node-grid dimensions and spacing for decoding `gScore`/`seen` indices (idx = cx*pgH + cy). */
  readonly pgW: number;
  readonly pgH: number;
  readonly step: number;
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
  /** Node spacing override. Callers that only need reachable destinations (e.g. move-candidate
   *  generation, deduped to ~8px) pass a coarser step to settle far fewer cells with identical
   *  post-dedup results. Defaults to the collision cellSize. */
  stepOverride?: number,
  /** Body radius used for *transit* (the flood expansion). Defaults to `collisionRadius` (full-body
   *  clearance everywhere). Pass `TRANSIT_RADIUS` to thread sub-body corridors like the AI mover —
   *  `collisionRadius` then only gates where the body may *stop* (`pathTo`'s endpoint check). */
  transitRadius: number = collisionRadius,
): FloodResult {
  const step = stepOverride ?? pathStep(grid);
  const { pgW, pgH } = pgDims(grid, step);
  const scx = Math.round(from.x / step);
  const scy = Math.round(from.y / step);
  const total = pgW * pgH;
  // Transit mask gates expansion; stop mask gates where `pathTo` may land the full-radius body.
  // Identical arrays when transitRadius === collisionRadius (getWalkableMask caches by radius).
  const stopWalkable = getWalkableMask(grid, collisionRadius, step);
  // gScore must outlive this call (it's captured by the returned FloodResult), so it can't use the
  // shared A* scratch. But we skip the O(N) Infinity fill: a `seen` flag (zero-initialised) marks
  // which cells hold a real score, so unseen cells read as Infinity without ever being written.
  const gScore = new Float64Array(total);
  const seen = new Uint8Array(total);
  const closed = new Uint8Array(total);
  const touched: number[] = [];
  const startIdx = scx * pgH + scy;
  if (scx < 0 || scx >= pgW || scy < 0 || scy >= pgH) {
    return makeFloodResult(gScore, seen, startIdx, touched, pgW, pgH, step, from, buildBlockers(entities, selfId, collisionRadius), stopWalkable);
  }
  gScore[startIdx] = 0; seen[startIdx] = 1;
  touched.push(startIdx);
  // Blockers are NOT used during expansion (entities don't block transit). They're checked only
  // when selecting the endpoint in `pathTo`.
  const blockers = buildBlockers(entities, selfId, collisionRadius);
  const walkable = getWalkableMask(grid, transitRadius, step);

  const open = new MinHeap(64);
  open.push(0, startIdx);

  while (open.size > 0) {
    const curIdx = open.popIdx();
    if (closed[curIdx]) continue;
    closed[curIdx] = 1;
    const curG = gScore[curIdx]!;
    const cx = (curIdx / pgH) | 0;
    const cy = curIdx - cx * pgH;
    for (let i = 0; i < NEIGHBOR_COUNT; i++) {
      const tentG = curG + NOC[i]! * step;
      if (tentG > maxDistance) continue;
      const ncx = cx + NOX[i]!;
      const ncy = cy + NOY[i]!;
      if (ncx < 0 || ncx >= pgW || ncy < 0 || ncy >= pgH) continue;
      const nIdx = ncx * pgH + ncy;
      if (closed[nIdx]) continue;
      if (seen[nIdx] && tentG >= gScore[nIdx]!) continue;

      if (!walkable[nIdx]) continue;

      if (!seen[nIdx]) touched.push(nIdx);
      seen[nIdx] = 1;
      gScore[nIdx] = tentG;
      open.push(tentG, nIdx);
    }
  }

  return makeFloodResult(gScore, seen, startIdx, touched, pgW, pgH, step, from, blockers, stopWalkable);
}

function makeFloodResult(
  gScore: Float64Array, seen: Uint8Array, startIdx: number, touched: number[], pgW: number, pgH: number, step: number, from: Vec2, blockers: BlockerArrays, stopWalkable: Uint8Array,
): FloodResult {
  return {
    gScore,
    seen,
    pgW,
    pgH,
    step,
    startIdx,
    pathTo(target: Vec2, maxDist: number): Vec2 | null {
      const tcx = Math.round(target.x / step);
      const tcy = Math.round(target.y / step);
      const tIdx = tcx * pgH + tcy;
      const exactG = tIdx >= 0 && tIdx < gScore.length && seen[tIdx] ? gScore[tIdx] : Infinity;
      // Exact-goal path is fine only if the body fits at the stop (clear of walls and other entities);
      // the cell may be transit-reachable yet too tight to stand in when transitRadius < collisionRadius.
      if (exactG !== undefined && exactG <= maxDist && stopWalkable[tIdx] === 1 && !overlapsBlocker(target.x, target.y, blockers)) {
        if (distance(target, from) < 1) return null;
        return { x: target.x, y: target.y };
      }
      // Closest touched cell to target (by heuristic) that's within budget AND not entity-occupied.
      let bestIdx = -1;
      let bestD = Infinity;
      for (let i = 0; i < touched.length; i++) {
        const k = touched[i]!;
        if (gScore[k]! > maxDist) continue;
        if (stopWalkable[k] !== 1) continue; // body must fit where it stops
        const cx = (k / pgH) | 0;
        const cy = k - cx * pgH;
        const px = cx * step, py = cy * step;
        if (overlapsBlocker(px, py, blockers)) continue;
        const d = heuristic(px, py, tcx * step, tcy * step);
        if (d < bestD) { bestD = d; bestIdx = k; }
      }
      if (bestIdx < 0) return null;
      const bcx = (bestIdx / pgH) | 0;
      const bcy = bestIdx - bcx * pgH;
      const bx = bcx * step, by = bcy * step;
      if (distance({ x: bx, y: by }, from) < 1) return null;
      return { x: bx, y: by };
    },
  };
}

/** Walk `path` from `start`, spending up to `budget` of arc-length, and return the point where the
 *  budget runs out (or the path's end, if it's shorter than the budget). This is the agent's desired
 *  stopping point before any legality adjustment. */
function clipPathToBudget(start: Vec2, path: Vec2[], budget: number): Vec2 {
  let remaining = budget;
  let current = start;
  for (const waypoint of path) {
    const segDist = distance(current, waypoint);
    if (segDist <= remaining) {
      remaining -= segDist;
      current = waypoint;
    } else {
      const ratio = remaining / segDist;
      return {
        x: current.x + (waypoint.x - current.x) * ratio,
        y: current.y + (waypoint.y - current.y) * ratio,
      };
    }
  }
  return current;
}

/** The authoritative "may an agent of `radius` end its move here" predicate, evaluated locally:
 *  clear of walls, inside bounds, and not overlapping another entity. Mirrors `canEntityOccupy`. */
function isLegalStop(grid: GridState, radius: number, p: Vec2, blockers: BlockerArrays): boolean {
  return (
    isPositionWalkable(grid, p, radius) &&
    isWithinBounds(grid, p, radius) &&
    !overlapsBlocker(p.x, p.y, blockers)
  );
}

/**
 * `desired` is illegal at full radius (it sits against a wall and/or on an entity). Flood outward
 * from it at the collision grid's *own* resolution (full precision — no 16px snapping) and return
 * the nearest cell-center that is a legal full-radius stop AND within straight-line `budget` of
 * `start` (so the move resolver won't reject it). Rings expand small→large and the Euclidean-nearest
 * legal cell within the first non-empty ring wins, so the agent bumps just clear of the wall / to the
 * nearer doorway mouth rather than rewinding. Returns `null` only if no legal stop exists within
 * `budget` of the desired point.
 *
 * Cost is intentionally unoptimized for now: every candidate runs the full continuous occupancy
 * check, and the flood spans up to `budget` px at cell resolution.
 */
function nudgeToLegal(
  grid: GridState, radius: number, start: Vec2, desired: Vec2, budget: number, blockers: BlockerArrays,
): Vec2 | null {
  const cs = grid.cellSize;
  const half = cs / 2;
  const dcx = Math.floor(desired.x / cs);
  const dcy = Math.floor(desired.y / cs);
  const maxRing = Math.ceil(budget / cs);
  const maxD2 = budget * budget;
  for (let ring = 0; ring <= maxRing; ring++) {
    let best: Vec2 | null = null;
    let bestD2 = Infinity;
    for (let ox = -ring; ox <= ring; ox++) {
      for (let oy = -ring; oy <= ring; oy++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== ring) continue; // ring perimeter only
        const p = { x: (dcx + ox) * cs + half, y: (dcy + oy) * cs + half };
        const sdx = p.x - start.x, sdy = p.y - start.y;
        if (sdx * sdx + sdy * sdy > maxD2) continue; // out of move budget
        if (!isLegalStop(grid, radius, p, blockers)) continue; // walls + bounds + entities, full precision
        const edx = p.x - desired.x, edy = p.y - desired.y;
        const d2 = edx * edx + edy * edy;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Pick this turn's move destination toward `target`, in three steps:
 *   1. Pathfind the *whole* route to the target (point-sized transit, no distance cap) and keep the
 *      waypoints. Committing to the full route is what stops the unit walking into maze dead ends.
 *   2. Walk `budget` (the move distance) along that path to get the desired stopping point.
 *   3. Validate the stop at full body radius; if it's illegal, flood-fill out to the nearest legal
 *      position (`nudgeToLegal`).
 * Returns `null` if no legal forward progress is possible. The route is recomputed each turn (the
 * target moves), so waypoints aren't cached across turns.
 */
/**
 * Route to `target`, coarse-first: try a cheap COARSE_STEP search first and only fall back to the
 * fine collision-resolution search when coarse can't actually reach the target — i.e. the only way
 * there is through a corridor narrower than the coarse step. On open maps (the common case) coarse
 * succeeds and matches the game's historical 16px behaviour; thin-corridor mazes still get the fine
 * path. Gated to fine grids (cellSize ≤ ¼ COARSE_STEP) so the coarse pre-pass only runs where it
 * actually saves work.
 */
function routeTo(from: Vec2, target: Vec2, grid: GridState): Vec2[] {
  const fine = pathStep(grid);
  if (fine * 4 <= COARSE_STEP) {
    const coarse = pathfind(from, target, grid, TRANSIT_RADIUS, MAX_PATHFIND_NODES, Infinity, COARSE_STEP);
    if (coarse.length > 0 && distance(coarse[coarse.length - 1]!, target) <= COARSE_STEP * 1.5) {
      return coarse; // coarse search reached the target — no need for the fine grid
    }
  }
  return pathfind(from, target, grid, TRANSIT_RADIUS, MAX_PATHFIND_NODES, Infinity);
}

export function pathfindMove(
  entity: Entity,
  target: Vec2,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  maxDistance?: number,
): Vec2 | null {
  const moveAbility = entity.abilities.find(a => a.kind === "move");
  const budget = maxDistance ?? (moveAbility ? (moveAbility as import("../core/types.js").MoveAbility).distance : 0);

  // 1. Full route to the target (coarse-first; falls back to fine for thin-corridor maps). No
  //    distance cap so the path reflects the true way around the maze, not a myopic best-partial.
  const path = routeTo(entity.position, target, grid);
  if (path.length === 0) return null;

  // 2. Advance the move budget along that path.
  const desired = clipPathToBudget(entity.position, path, budget);
  const r = moveRadiusOf(entity);
  const blockers = buildBlockers(entities, entity.id, r);

  // 3. Commit the stop if it's already a legal move-radius stop; otherwise flood-fill to the nearest.
  if (isLegalStop(grid, r, desired, blockers)) {
    return distance(desired, entity.position) < 1 ? null : desired;
  }
  const legal = nudgeToLegal(grid, r, entity.position, desired, budget, blockers);
  if (!legal || distance(legal, entity.position) < 1) return null;
  return legal;
}

/** True iff the straight segment a→b stays walkable for a body of `radius` (sampled). */
function hasClearance(grid: GridState, a: Vec2, b: Vec2, radius: number): boolean {
  const d = distance(a, b);
  const steps = Math.max(1, Math.ceil(d / Math.max(2, radius * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    if (!isWithinBounds(grid, p, radius) || !isPositionWalkable(grid, p, radius)) return false;
  }
  return true;
}

/**
 * Smooth a grid path for display/animation: string-pull (drop any waypoint you can see past with
 * body clearance — collapses the axis/diagonal staircase into straight runs hugging the real
 * corners), then round the remaining corners with endpoint-preserving Chaikin. `polyline` includes
 * the start point; the returned polyline keeps both endpoints, so the unit still lands exactly on the
 * destination. This is a *visual* smoothing — energy cost still comes from the raw `playerMovePath`.
 */
export function smoothPath(polyline: Vec2[], grid: GridState, radius: number): Vec2[] {
  if (polyline.length <= 2) return polyline.slice();

  // 1. String-pull: greedily skip waypoints the previous anchor has clear line-of-sight past.
  const pulled: Vec2[] = [polyline[0]!];
  let anchor = 0;
  for (let i = 2; i < polyline.length; i++) {
    if (!hasClearance(grid, polyline[anchor]!, polyline[i]!, radius)) {
      pulled.push(polyline[i - 1]!);
      anchor = i - 1;
    }
  }
  pulled.push(polyline[polyline.length - 1]!);

  // 2. Round the corners (open Chaikin, endpoints fixed). Corners sit on LOS-clear chords, so the
  //    cut stays within the body-clearance margin.
  let pts = pulled;
  for (let it = 0; it < 2; it++) {
    if (pts.length < 3) break;
    const out: Vec2[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

export interface DisplayRoute {
  /** Point-transit route to the target (excludes the start), empty if none exists. The reachability
   *  yardstick: does its last waypoint land on the target? */
  readonly route: Vec2[];
  /** Body-radius-smoothed polyline through `route`, including the start point — what gets drawn. */
  readonly smoothed: Vec2[];
}

/**
 * The display-side route for a move: how the client draws the preview line and animates playback.
 * Transit is point-sized (radius 0) so the route threads the same sub-body gaps the authoritative
 * move does, while smoothing uses the body radius so the drawn line still hugs wall corners. This is
 * the one place that pairing lives — both the move-preview line and the move-animation playback go
 * through it, so they can't drift from each other or from the resolver's point-transit pathing.
 */
export function planDisplayRoute(from: Vec2, to: Vec2, grid: GridState, radius: number): DisplayRoute {
  const route = pathfind(from, to, grid, TRANSIT_RADIUS);
  return { route, smoothed: smoothPath([from, ...route], grid, radius) };
}

export interface MovePathPlan {
  /** True iff `destination` is reachable by a body-clearance route within the move budget. */
  readonly reachable: boolean;
  /** Route distance from the entity to `destination` (the energy-cost yardstick for path-based moves). */
  readonly cost: number;
  /** Waypoints from the entity to `destination` (for drawing the bent move line / animating travel). */
  readonly path: Vec2[];
}

/**
 * Plan a *path-based* move to `destination`: the route to it, its length (the energy cost), and
 * whether that length is within `maxDistance`. Like the AI's mover, transit is point-sized
 * (`TRANSIT_RADIUS`) so the route may thread any gap narrower than the body; the body only has to
 * fit where it *stops*, which the full-radius wall/bounds check below (and the resolver's
 * `canEntityOccupy` entity check) enforce at the destination. The single source of truth shared by
 * the authoritative resolver and the client's preview/prediction, so server cost and client display
 * can't drift.
 */
export function playerMovePath(
  entity: Entity,
  destination: Vec2,
  grid: GridState,
  maxDistance: number,
): MovePathPlan {
  const r = moveRadiusOf(entity);
  const path = pathfind(entity.position, destination, grid, TRANSIT_RADIUS, MAX_PATHFIND_NODES, Infinity);
  if (path.length === 0) return { reachable: false, cost: 0, path: [] };
  let cost = 0;
  let prev = entity.position;
  for (const wp of path) { cost += distance(prev, wp); prev = wp; }
  const end = path[path.length - 1]!;
  // pathfind returns the exact goal as the last waypoint only when it actually reached it; a
  // best-partial ends short. Reachable iff the body fits at the stop AND a point-route gets there
  // within the move budget.
  const fitsAtStop = isPositionWalkable(grid, destination, r) && isWithinBounds(grid, destination, r);
  const reachable = fitsAtStop && distance(end, destination) < 0.5 && cost <= maxDistance + 0.01;
  return { reachable, cost, path };
}

/**
 * Snap `desired` to the nearest spot the entity could legally stand, within its straight-line move
 * budget. For player move input on dense maps: clicking near/inside a wall lands on the closest legal
 * spot instead of being silently rejected. Player moves are straight-line (the resolver validates
 * only the endpoint), so this nudges the *endpoint* — it does not route around obstacles. `desired`
 * is first clamped to `maxDistance` of the entity, so an out-of-range click snaps to the reachable
 * boundary. Returns `null` if no legal spot exists within range near `desired`.
 *
 * Cheap enough to call every frame for the move preview: the common case (open ground) is a single
 * occupancy check, and the flood-fill only runs — and early-exits at the first legal ring — when the
 * point is illegal.
 */
export function nearestLegalDestination(
  entity: Entity,
  desired: Vec2,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  maxDistance: number,
): Vec2 | null {
  // Clamp to the straight-line move budget first so the nudge searches near the reachable boundary.
  const dx = desired.x - entity.position.x, dy = desired.y - entity.position.y;
  const d = Math.hypot(dx, dy);
  const aim = d > maxDistance
    ? { x: entity.position.x + (dx / d) * maxDistance, y: entity.position.y + (dy / d) * maxDistance }
    : desired;

  const r = moveRadiusOf(entity);
  const blockers = buildBlockers(entities, entity.id, r);
  if (isLegalStop(grid, r, aim, blockers)) return aim;
  return nudgeToLegal(grid, r, entity.position, aim, maxDistance, blockers);
}
