import { describe, expect, test } from "bun:test";
import { reachableArea } from "../map/reachable-area.js";
import { createGrid, setBlocked } from "../map/collision-grid.js";
import { makeEntity } from "./test-helpers.js";

describe("reachableArea", () => {
  test("open field: snaps to points within the move budget, rejects points far beyond it", () => {
    const grid = createGrid(80, 80, 8); // 640×640
    const self = makeEntity("self", 320, 320, "red", { collisionRadius: 12 });
    const flood = reachableArea(self, grid, new Map([["self", self]]), 130);
    // Within budget (path ≈ straight here): reachable as-is.
    const near = flood.pathTo({ x: 320 + 100, y: 320 }, 130);
    expect(near).not.toBeNull();
    expect(Math.abs(near!.x - 420)).toBeLessThanOrEqual(12); // snapped to flood-node spacing
    // Beyond budget: snapped back to the rim, never past it.
    const far = flood.pathTo({ x: 320 + 250, y: 320 }, 130);
    if (far) expect(far.x).toBeLessThanOrEqual(320 + 130 + 12);
  });

  test("a wall deforms the reachable area (it does not extend behind the wall)", () => {
    let grid = createGrid(80, 80, 8);
    // Vertical wall just east of the unit, tall enough that paths can't wrap around within budget.
    for (let cy = 20; cy < 60; cy++) grid = setBlocked(grid, 45, cy); // x≈360
    const self = makeEntity("self", 320, 320, "red", { collisionRadius: 12 });
    const flood = reachableArea(self, grid, new Map([["self", self]]), 130);
    // A point straight through the wall is NOT reachable (straight-line would be ~140px but blocked).
    const through = flood.pathTo({ x: 460, y: 320 }, 130);
    if (through) expect(through.x).toBeLessThan(360); // best it can do stays on the near side
  });
});
