import { describe, expect, test } from "bun:test";
import { reachableArea } from "../map/reachable-area.js";
import { createGrid, setBlocked } from "../map/collision-grid.js";
import { makeEntity } from "./test-helpers.js";

function bbox(loops: { x: number; y: number }[][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) for (const p of loop) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

describe("reachableArea", () => {
  test("open field: produces a closed outline roughly a move-radius around the unit", () => {
    const grid = createGrid(80, 80, 8); // 640×640
    const self = makeEntity("self", 320, 320, "red", { collisionRadius: 12 });
    const area = reachableArea(self, grid, new Map([["self", self]]), 130);
    expect(area.contours.length).toBeGreaterThan(0);
    const b = bbox(area.contours);
    // The blob spans ~±130 around the unit (plus contour/step slack), not the whole map.
    expect(b.minX).toBeGreaterThan(320 - 160);
    expect(b.maxX).toBeLessThan(320 + 160);
    expect(b.minY).toBeGreaterThan(320 - 160);
    expect(b.maxY).toBeLessThan(320 + 160);
    // Every reachable point is genuinely within the move budget of the unit (path ≈ straight here).
    const reached = area.flood.pathTo({ x: 320 + 100, y: 320 }, 130);
    expect(reached).not.toBeNull();
  });

  test("a wall deforms the reachable area (it does not extend behind the wall)", () => {
    let grid = createGrid(80, 80, 8);
    // Vertical wall just east of the unit, tall enough that the area can't wrap around within budget.
    for (let cy = 20; cy < 60; cy++) grid = setBlocked(grid, 45, cy); // x≈360
    const self = makeEntity("self", 320, 320, "red", { collisionRadius: 12 });
    const area = reachableArea(self, grid, new Map([["self", self]]), 130);
    expect(area.contours.length).toBeGreaterThan(0);
    // A point straight through the wall is NOT reachable (straight-line would be ~160px but blocked).
    const through = area.flood.pathTo({ x: 460, y: 320 }, 130);
    if (through) expect(through.x).toBeLessThan(360); // best it can do stays on the near side
    // The outline should not bulge well past the wall on the far side.
    const b = bbox(area.contours);
    expect(b.maxX).toBeLessThan(380);
  });
});
