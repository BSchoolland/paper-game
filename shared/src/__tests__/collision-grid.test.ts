import { describe, it, expect } from "bun:test";
import { createGrid, setBlocked, isBlocked, isPositionWalkable, worldToCell } from "../map/collision-grid.js";
import { Rng } from "../core/rng.js";

describe("collision-grid", () => {
  it("new grid has no walls", () => {
    const grid = createGrid(10, 10, 8);
    expect(isBlocked(grid, 5, 5)).toBe(false);
  });

  it("out of bounds is blocked", () => {
    const grid = createGrid(10, 10, 8);
    expect(isBlocked(grid, -1, 0)).toBe(true);
    expect(isBlocked(grid, 10, 0)).toBe(true);
  });

  it("setBlocked marks cell", () => {
    let grid = createGrid(10, 10, 8);
    grid = setBlocked(grid, 5, 5);
    expect(isBlocked(grid, 5, 5)).toBe(true);
    expect(isBlocked(grid, 4, 5)).toBe(false);
  });

  it("worldToCell converts correctly", () => {
    expect(worldToCell({ x: 20, y: 36 }, 8)).toEqual({ cx: 2, cy: 4 });
  });

  it("isPositionWalkable checks radius", () => {
    let grid = createGrid(20, 20, 8);
    grid = setBlocked(grid, 10, 10);
    // Position right next to the wall — with radius 16, should overlap
    expect(isPositionWalkable(grid, { x: 72, y: 80 }, 16)).toBe(false);
    // Position far from wall
    expect(isPositionWalkable(grid, { x: 20, y: 20 }, 16)).toBe(true);
  });

  it("isPositionWalkable (summed-area fast path) matches the per-cell reference on random grids", () => {
    const rng = Rng.seeded(7, 77);
    const rand = () => rng.next();
    // Reference: the original rectangle scan over isBlocked.
    const reference = (grid: ReturnType<typeof createGrid>, pos: { x: number; y: number }, r: number) => {
      const minCx = Math.floor((pos.x - r) / grid.cellSize);
      const maxCx = Math.floor((pos.x + r) / grid.cellSize);
      const minCy = Math.floor((pos.y - r) / grid.cellSize);
      const maxCy = Math.floor((pos.y + r) / grid.cellSize);
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          if (isBlocked(grid, cx, cy)) return false;
        }
      }
      return true;
    };
    for (let round = 0; round < 10; round++) {
      let grid = createGrid(30, 30, 4); // 120×120 world
      for (let i = 0; i < 40; i++) grid = setBlocked(grid, Math.floor(rand() * 30), Math.floor(rand() * 30));
      for (let q = 0; q < 200; q++) {
        const pos = { x: rand() * 140 - 10, y: rand() * 140 - 10 }; // includes out-of-bounds probes
        const r = [0, 3, 10, 16][q % 4]!;
        expect(isPositionWalkable(grid, pos, r)).toBe(reference(grid, pos, r));
      }
    }
  });
});
