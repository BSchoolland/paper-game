import { describe, it, expect } from "vitest";
import { createGrid, setBlocked, isBlocked, isPositionWalkable, worldToCell } from "../collision-grid.js";

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
});
