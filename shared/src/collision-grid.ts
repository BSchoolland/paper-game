import type { GridState, Vec2 } from "./types.js";

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
  return grid.walls[cy * grid.width + cx] === 1;
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

export function createTestMap(): GridState {
  const cellSize = 8;
  const width = 150;
  const height = 100;
  let grid = createGrid(width, height, cellSize);

  // Border walls
  grid = rasterizeRect(grid, 0, 0, width, 2);
  grid = rasterizeRect(grid, 0, height - 2, width, 2);
  grid = rasterizeRect(grid, 0, 0, 2, height);
  grid = rasterizeRect(grid, width - 2, 0, 2, height);

  // Center vertical wall with gap
  grid = rasterizeRect(grid, 73, 20, 4, 25);
  grid = rasterizeRect(grid, 73, 55, 4, 25);

  // Top-left pillar
  grid = rasterizeRect(grid, 30, 30, 6, 6);

  // Bottom-right pillar
  grid = rasterizeRect(grid, 114, 64, 6, 6);

  // Small L-shaped wall top-right
  grid = rasterizeRect(grid, 105, 25, 3, 12);
  grid = rasterizeRect(grid, 105, 25, 12, 3);

  // Small L-shaped wall bottom-left
  grid = rasterizeRect(grid, 30, 63, 3, 12);
  grid = rasterizeRect(grid, 30, 72, 12, 3);

  return grid;
}
