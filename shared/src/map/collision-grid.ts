import type { GridState, Vec2 } from "../core/types.js";

export const CELL_EMPTY = 0;
export const CELL_WALL = 1;
export const CELL_COVER = 2;

export function createGrid(
  width: number,
  height: number,
  cellSize: number
): GridState {
  return {
    width,
    height,
    cellSize,
    walls: new Uint8Array(width * height),
  };
}

export function worldToCell(
  pos: Vec2,
  cellSize: number
): { cx: number; cy: number } {
  return {
    cx: Math.floor(pos.x / cellSize),
    cy: Math.floor(pos.y / cellSize),
  };
}

export function isBlocked(grid: GridState, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return true;
  return grid.walls[cy * grid.width + cx] === CELL_WALL;
}

export function blocksProjectile(grid: GridState, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return true;
  const v = grid.walls[cy * grid.width + cx];
  return v === CELL_WALL || v === CELL_COVER;
}

export function setBlocked(
  grid: GridState,
  cx: number,
  cy: number
): GridState {
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return grid;
  const walls = new Uint8Array(grid.walls);
  walls[cy * grid.width + cx] = 1;
  return { ...grid, walls };
}

// Summed-area table of wall cells, cached per grid (immutable: setBlocked & zone stamps return new
// GridState objects, so the WeakMap key invalidates itself). Turns the body-footprint rectangle
// check below from an O(footprint-area) cell scan into 4 array reads — what makes full-grid
// walkable-mask builds (pathfinding) and per-frame occupancy checks cheap even on fine grids.
const wallIntegralCache = new WeakMap<GridState, Uint32Array>();

function getWallIntegral(grid: GridState): Uint32Array {
  const cached = wallIntegralCache.get(grid);
  if (cached) return cached;
  const { width: w, height: h, walls } = grid;
  const stride = w + 1;
  const integral = new Uint32Array(stride * (h + 1));
  for (let cy = 0; cy < h; cy++) {
    let rowSum = 0;
    for (let cx = 0; cx < w; cx++) {
      if (walls[cy * w + cx] === CELL_WALL) rowSum++;
      integral[(cy + 1) * stride + (cx + 1)] = integral[cy * stride + (cx + 1)]! + rowSum;
    }
  }
  wallIntegralCache.set(grid, integral);
  return integral;
}

export function isPositionWalkable(
  grid: GridState,
  pos: Vec2,
  collisionRadius: number
): boolean {
  const minCx = Math.floor((pos.x - collisionRadius) / grid.cellSize);
  const maxCx = Math.floor((pos.x + collisionRadius) / grid.cellSize);
  const minCy = Math.floor((pos.y - collisionRadius) / grid.cellSize);
  const maxCy = Math.floor((pos.y + collisionRadius) / grid.cellSize);

  // Cells outside the grid count as blocked (matches `isBlocked`).
  if (minCx < 0 || minCy < 0 || maxCx >= grid.width || maxCy >= grid.height) return false;

  const integral = getWallIntegral(grid);
  const stride = grid.width + 1;
  const wallCount =
    integral[(maxCy + 1) * stride + (maxCx + 1)]! -
    integral[minCy * stride + (maxCx + 1)]! -
    integral[(maxCy + 1) * stride + minCx]! +
    integral[minCy * stride + minCx]!;
  return wallCount === 0;
}

export function isWithinBounds(
  grid: GridState,
  pos: Vec2,
  collisionRadius: number
): boolean {
  const worldWidth = grid.width * grid.cellSize;
  const worldHeight = grid.height * grid.cellSize;
  return (
    pos.x - collisionRadius >= 0 &&
    pos.x + collisionRadius <= worldWidth &&
    pos.y - collisionRadius >= 0 &&
    pos.y + collisionRadius <= worldHeight
  );
}

export function findWalkablePosition(
  grid: GridState,
  pos: Vec2,
  collisionRadius: number
): Vec2 {
  if (isPositionWalkable(grid, pos, collisionRadius) && isWithinBounds(grid, pos, collisionRadius)) {
    return pos;
  }

  for (let radius = 10; radius <= 200; radius += 10) {
    const steps = Math.max(8, Math.floor((2 * Math.PI * radius) / 15));
    for (let i = 0; i < steps; i++) {
      const angle = (2 * Math.PI * i) / steps;
      const candidate = { x: pos.x + Math.cos(angle) * radius, y: pos.y + Math.sin(angle) * radius };
      if (isPositionWalkable(grid, candidate, collisionRadius) && isWithinBounds(grid, candidate, collisionRadius)) {
        return candidate;
      }
    }
  }

  return pos;
}

export function rasterizeRect(
  grid: GridState,
  cx: number,
  cy: number,
  w: number,
  h: number
): GridState {
  const walls = new Uint8Array(grid.walls);
  for (let y = cy; y < cy + h && y < grid.height; y++) {
    for (let x = cx; x < cx + w && x < grid.width; x++) {
      if (x >= 0 && y >= 0) {
        walls[y * grid.width + x] = 1;
      }
    }
  }
  return { ...grid, walls };
}

