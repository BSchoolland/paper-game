import type { Entity, GridState, Vec2 } from "../core/types.js";
import { distance } from "../core/vec2.js";
import { isPositionWalkable, isWithinBounds } from "./collision-grid.js";

const STEP = 16;
const DIAG_COST = Math.SQRT2 * STEP;
const NEIGHBORS: [number, number, number][] = [
  [-STEP, 0, STEP], [STEP, 0, STEP], [0, -STEP, STEP], [0, STEP, STEP],
  [-STEP, -STEP, DIAG_COST], [STEP, -STEP, DIAG_COST],
  [-STEP, STEP, DIAG_COST], [STEP, STEP, DIAG_COST],
];

function snap(v: number): number {
  return Math.round(v / STEP) * STEP;
}

function key(x: number, y: number): number {
  return (x / STEP) * 100000 + (y / STEP);
}

export function pathfind(
  from: Vec2,
  to: Vec2,
  grid: GridState,
  collisionRadius: number,
  entities: ReadonlyMap<string, Entity>,
  selfId: string,
  maxNodes = 2000
): Vec2[] {
  const sx = snap(from.x);
  const sy = snap(from.y);
  const gx = snap(to.x);
  const gy = snap(to.y);

  if (sx === gx && sy === gy) return [to];

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();

  const openSet: { x: number; y: number; f: number; k: number }[] = [];
  const startKey = key(sx, sy);
  gScore.set(startKey, 0);
  openSet.push({ x: sx, y: sy, f: heuristic(sx, sy, gx, gy), k: startKey });

  const closedSet = new Set<number>();
  let explored = 0;

  while (openSet.length > 0) {
    if (++explored > maxNodes) break;

    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i]!.f < openSet[bestIdx]!.f) bestIdx = i;
    }
    const current = openSet[bestIdx]!;
    openSet[bestIdx] = openSet[openSet.length - 1]!;
    openSet.pop();

    if (current.x === gx && current.y === gy) {
      return reconstructPath(cameFrom, current.k, sx, sy, to);
    }

    closedSet.add(current.k);
    const currentG = gScore.get(current.k)!;

    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);

      if (closedSet.has(nk)) continue;

      const pos = { x: nx, y: ny };
      if (!isWithinBounds(grid, pos, collisionRadius)) continue;
      if (!isPositionWalkable(grid, pos, collisionRadius)) continue;
      if (overlapsEntity(pos, collisionRadius, entities, selfId)) continue;

      const tentG = currentG + cost;
      const prevG = gScore.get(nk);
      if (prevG !== undefined && tentG >= prevG) continue;

      gScore.set(nk, tentG);
      cameFrom.set(nk, current.k);

      const existing = openSet.find((n) => n.k === nk);
      const f = tentG + heuristic(nx, ny, gx, gy);
      if (existing) {
        existing.f = f;
      } else {
        openSet.push({ x: nx, y: ny, f, k: nk });
      }
    }
  }

  // No path found — return best partial path (closest node to goal)
  let bestKey = startKey;
  let bestDist = heuristic(sx, sy, gx, gy);
  for (const [k, _] of gScore) {
    const kx = Math.floor(k / 100000) * STEP;
    const ky = (k % 100000) * STEP;
    const d = heuristic(kx, ky, gx, gy);
    if (d < bestDist) {
      bestDist = d;
      bestKey = k;
    }
  }

  if (bestKey === startKey) return [];
  return reconstructPath(cameFrom, bestKey, sx, sy, null);
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy - 0.414 * Math.min(dx, dy);
}

function overlapsEntity(
  pos: Vec2,
  radius: number,
  entities: ReadonlyMap<string, Entity>,
  selfId: string
): boolean {
  for (const e of entities.values()) {
    if (e.id === selfId || e.dead) continue;
    if (distance(pos, e.position) < radius + e.collisionRadius) return true;
  }
  return false;
}

function reconstructPath(
  cameFrom: Map<number, number>,
  endKey: number,
  sx: number,
  sy: number,
  exactGoal: Vec2 | null
): Vec2[] {
  const keys: number[] = [];
  let cur = endKey;
  const startKey = key(sx, sy);
  while (cur !== startKey) {
    keys.push(cur);
    const prev = cameFrom.get(cur);
    if (prev === undefined) break;
    cur = prev;
  }
  keys.reverse();

  const path: Vec2[] = keys.map((k) => ({
    x: Math.floor(k / 100000) * STEP,
    y: (k % 100000) * STEP,
  }));

  if (exactGoal && path.length > 0) {
    path[path.length - 1] = exactGoal;
  }

  return path;
}

export function pathfindMove(
  entity: Entity,
  target: Vec2,
  grid: GridState,
  entities: ReadonlyMap<string, Entity>,
  maxDistance?: number
): Vec2 | null {
  const path = pathfind(
    entity.position, target, grid,
    entity.collisionRadius, entities, entity.id
  );
  if (path.length === 0) return null;

  const moveAbility = entity.abilities.find(a => a.kind === "move");
  let remaining = maxDistance ?? (moveAbility ? (moveAbility as import("../core/types.js").MoveAbility).distance : 0);
  let current = entity.position;
  let bestPoint = current;

  for (const waypoint of path) {
    const segDist = distance(current, waypoint);
    if (segDist <= remaining) {
      remaining -= segDist;
      bestPoint = waypoint;
      current = waypoint;
    } else {
      const ratio = remaining / segDist;
      bestPoint = {
        x: current.x + (waypoint.x - current.x) * ratio,
        y: current.y + (waypoint.y - current.y) * ratio,
      };
      break;
    }
  }

  if (distance(bestPoint, entity.position) < 1) return null;
  return bestPoint;
}
