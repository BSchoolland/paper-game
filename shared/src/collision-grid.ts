import type { GridState, Vec2 } from "./types.js";

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

export function isPositionWalkable(
  grid: GridState,
  pos: Vec2,
  collisionRadius: number
): boolean {
  const minCx = Math.floor((pos.x - collisionRadius) / grid.cellSize);
  const maxCx = Math.floor((pos.x + collisionRadius) / grid.cellSize);
  const minCy = Math.floor((pos.y - collisionRadius) / grid.cellSize);
  const maxCy = Math.floor((pos.y + collisionRadius) / grid.cellSize);

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (isBlocked(grid, cx, cy)) return false;
    }
  }
  return true;
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

