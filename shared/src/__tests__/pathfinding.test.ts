import { describe, expect, test } from "bun:test";
import { pathfind, pathfindMove, pathfindFlood } from "../map/pathfinding.js";
import { createGrid, setBlocked, isPositionWalkable } from "../map/collision-grid.js";
import { makeEntity } from "./test-helpers.js";

// All tests use a 40×40 collision grid with cellSize=16 → 640×640 world. The pathfinder snaps
// to its own 16-px sub-grid (STEP=16), so cell coordinates here match world / 16.

function pathDistance(from: { x: number; y: number }, path: { x: number; y: number }[]): number {
  let total = 0;
  let prev = from;
  for (const wp of path) {
    total += Math.hypot(wp.x - prev.x, wp.y - prev.y);
    prev = wp;
  }
  return total;
}

describe("pathfind", () => {
  test("open field: finds direct path, ends at exact goal", () => {
    const grid = createGrid(40, 40, 16);
    const path = pathfind({ x: 100, y: 100 }, { x: 300, y: 100 }, grid, 8);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 300, y: 100 });
  });

  test("pathfindMove with entity at goal: returns a destination that doesn't land on the target", () => {
    const grid = createGrid(40, 40, 16);
    const self = makeEntity("self", 100, 100, "red", { collisionRadius: 12 });
    const target = makeEntity("t", 300, 100, "blue", { collisionRadius: 16 });
    const dest = pathfindMove(self, target.position, grid, new Map([["self", self], ["t", target]]), 250);
    expect(dest).not.toBeNull();
    // Must not end on top of the target.
    const distToTarget = Math.hypot(dest!.x - target.position.x, dest!.y - target.position.y);
    expect(distToTarget).toBeGreaterThanOrEqual(12 + 16);
    // But should be near it.
    expect(distToTarget).toBeLessThan(60);
  });

  test("wall in the way: path detours around it", () => {
    let grid = createGrid(40, 40, 16);
    // Vertical wall at cell x=15, covering cy=8..32. Gaps at top and bottom.
    for (let cy = 8; cy < 32; cy++) grid = setBlocked(grid, 15, cy);
    const start = { x: 160, y: 320 };
    const goal = { x: 400, y: 320 };
    const path = pathfind(start, goal, grid, 8);
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1]!;
    expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeLessThan(20);
    // Path must be longer than the direct (blocked) line — confirms detour.
    expect(pathDistance(start, path)).toBeGreaterThan(Math.hypot(goal.x - start.x, goal.y - start.y));
  });

  test("regression: tall wall requiring long detour — pathfindMove makes vertical progress, not stuck against wall", () => {
    let grid = createGrid(40, 40, 16);
    // Tall wall from top down to past the middle. Only way around is via the bottom.
    for (let cy = 0; cy < 25; cy++) grid = setBlocked(grid, 15, cy);
    const self = makeEntity("self", 160, 320, "red", { collisionRadius: 12 });
    const target = makeEntity("target", 400, 320, "blue", { collisionRadius: 12 });
    // Direct distance ~240; detour around bottom is ~400 grid distance, well beyond move budget 130.
    const dest = pathfindMove(self, target.position, grid, new Map([["self", self], ["target", target]]), 130);
    expect(dest).not.toBeNull();
    // The fix the user worries about: if the search cap pruned the around-wall path, A* falls back
    // to the heuristic-best cell, which is right against the wall with no vertical displacement.
    // Correct behavior: head down to go around.
    const verticalDisplacement = Math.abs(dest!.y - self.position.y);
    expect(verticalDisplacement).toBeGreaterThan(40);
  });

  test("regression: tall wall — also works in the opposite direction (path goes UP to circumvent)", () => {
    let grid = createGrid(40, 40, 16);
    // Wall covers the bottom; must go up to get around.
    for (let cy = 15; cy < 40; cy++) grid = setBlocked(grid, 15, cy);
    const self = makeEntity("self", 160, 320, "red", { collisionRadius: 12 });
    const target = makeEntity("target", 400, 320, "blue", { collisionRadius: 12 });
    const dest = pathfindMove(self, target.position, grid, new Map([["self", self], ["target", target]]), 130);
    expect(dest).not.toBeNull();
    // Must move UP (lower y) to circumvent.
    expect(self.position.y - dest!.y).toBeGreaterThan(40);
  });

  test("unreachable goal: returns best partial path or empty", () => {
    let grid = createGrid(40, 40, 16);
    // Sealed box around the goal — completely unreachable.
    for (let cx = 18; cx <= 22; cx++) {
      grid = setBlocked(grid, cx, 18);
      grid = setBlocked(grid, cx, 22);
    }
    for (let cy = 18; cy <= 22; cy++) {
      grid = setBlocked(grid, 18, cy);
      grid = setBlocked(grid, 22, cy);
    }
    const goal = { x: 320, y: 320 }; // inside the sealed box
    const path = pathfind({ x: 100, y: 100 }, goal, grid, 8);
    // Either empty (no progress possible) or ends short of the goal — must not crash, must not
    // walk through the wall.
    if (path.length > 0) {
      const end = path[path.length - 1]!;
      // Should NOT have reached the goal.
      expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeGreaterThan(20);
    }
  });

  test("pathfindMove on open field: respects maxDistance budget", () => {
    const grid = createGrid(40, 40, 16);
    const self = makeEntity("self", 100, 100, "red", { collisionRadius: 12 });
    const dest = pathfindMove(self, { x: 500, y: 100 }, grid, new Map([["self", self]]), 80);
    expect(dest).not.toBeNull();
    // Travelled at most 80 px (plus a small rounding slack).
    expect(Math.hypot(dest!.x - 100, dest!.y - 100)).toBeLessThanOrEqual(85);
  });

  test("pathfindFlood: all reachable cells within budget are settled, others are Infinity", () => {
    const grid = createGrid(40, 40, 16);
    const flood = pathfindFlood({ x: 200, y: 200 }, grid, 8, new Map(), "self", 80);
    // Goal cell within budget: pathTo returns the exact point.
    const close = flood.pathTo({ x: 240, y: 200 }, 80);
    expect(close).toEqual({ x: 240, y: 200 });
    // Goal cell far outside budget: pathTo returns the closest reachable cell (not null).
    const far = flood.pathTo({ x: 500, y: 200 }, 80);
    expect(far).not.toBeNull();
    // Budget 80 + up to STEP/2 (=8) snap rounding from caller's unsnapped start position.
    expect(Math.hypot(far!.x - 200, far!.y - 200)).toBeLessThanOrEqual(96);
  });

  test("entities don't block transit — pathfindMove plans through an ally to reach a foe behind it", () => {
    const grid = createGrid(40, 40, 16);
    // Ally directly between self and target, blocking the straight line.
    const self = makeEntity("self", 100, 320, "red", { collisionRadius: 12 });
    const ally = makeEntity("ally", 220, 320, "red", { collisionRadius: 20 });
    const target = makeEntity("target", 400, 320, "blue", { collisionRadius: 12 });
    const ents = new Map([["self", self], ["ally", ally], ["target", target]]);
    // Budget large enough to fully cross the ally (ally radius 20 + self radius 12 = 32 keepout).
    const dest = pathfindMove(self, target.position, grid, ents, 200);
    expect(dest).not.toBeNull();
    // The unit should advance roughly along the straight line — minimal vertical detour.
    // (Previously: pathfind would route around the ally, producing a non-trivial vertical shift.)
    expect(Math.abs(dest!.y - self.position.y)).toBeLessThan(20);
    // And it must end past the ally on the far side.
    expect(dest!.x).toBeGreaterThan(ally.position.x);
  });

  test("entity at endpoint forbidden — destination is never on top of another entity", () => {
    const grid = createGrid(40, 40, 16);
    const self = makeEntity("self", 100, 320, "red", { collisionRadius: 12 });
    // Ally sits exactly at self's move-budget endpoint along the line to the target.
    const ally = makeEntity("ally", 220, 320, "red", { collisionRadius: 18 });
    const target = makeEntity("target", 400, 320, "blue", { collisionRadius: 12 });
    const ents = new Map([["self", self], ["ally", ally], ["target", target]]);
    const dest = pathfindMove(self, target.position, grid, ents, 120);
    expect(dest).not.toBeNull();
    // The chosen destination must not overlap the ally.
    const distToAlly = Math.hypot(dest!.x - ally.position.x, dest!.y - ally.position.y);
    expect(distToAlly).toBeGreaterThanOrEqual(12 + 18); // self radius + ally radius
  });

  test("narrow gap: agent squeezes through a gap too tight to stop in, lands legally past it", () => {
    // Fine collision grid (cellSize 4) like the real game, so geometry isn't quantized to the
    // pathfinder's 16-px node step. Full-height wall 20px thick (cx 78..82, x 312..332) with a
    // 20px-tall gap carved at y 312..332. A radius-12 disc (24px) can't fit in the 20px gap in
    // either axis — it can't stop inside — but at the smaller transit radius it can route through
    // and must then stop on the far side. Strict-radius A* would find no route at all here.
    let grid = createGrid(160, 160, 4);
    for (let cx = 78; cx <= 82; cx++) {
      for (let cy = 0; cy < 160; cy++) {
        if (cy >= 78 && cy <= 82) continue; // carve the gap
        grid = setBlocked(grid, cx, cy);
      }
    }
    const self = makeEntity("self", 288, 320, "red", { collisionRadius: 12 }); // left of the wall
    const target = makeEntity("target", 400, 320, "blue", { collisionRadius: 12 }); // right of the wall
    const dest = pathfindMove(self, target.position, grid, new Map([["self", self], ["target", target]]), 200);
    expect(dest).not.toBeNull();
    // Made it through to the far side of the 20px-thick wall (east face at x=332)...
    expect(dest!.x).toBeGreaterThan(332);
    // ...and the chosen stop is a legal full-disc position (clear of the wall).
    expect(isPositionWalkable(grid, dest!, 12)).toBe(true);
  });

  test("wall-hugging endpoint is nudged out, not rewound to the start", () => {
    let grid = createGrid(40, 40, 16);
    // Horizontal wall along cy=18 (y≈288). Target sits just on the far side so the straight path
    // runs into the wall; the budget endpoint lands against it and must bump clear, while keeping
    // most of the horizontal progress (not rewinding to the start).
    for (let cx = 0; cx < 40; cx++) grid = setBlocked(grid, cx, 18);
    const self = makeEntity("self", 100, 320, "red", { collisionRadius: 12 });
    const target = makeEntity("target", 400, 320, "blue", { collisionRadius: 12 });
    const dest = pathfindMove(self, target.position, grid, new Map([["self", self], ["target", target]]), 200);
    expect(dest).not.toBeNull();
    // Legal stop, clear of the wall.
    expect(isPositionWalkable(grid, dest!, 12)).toBe(true);
    // Real horizontal progress toward the target — the nudge didn't collapse the move.
    expect(dest!.x - self.position.x).toBeGreaterThan(40);
  });

  test("pathfindFlood: respects walls — does not flood through them", () => {
    let grid = createGrid(40, 40, 16);
    for (let cy = 8; cy < 32; cy++) grid = setBlocked(grid, 15, cy);
    // Start just left of wall, with a budget too small to go around.
    const flood = pathfindFlood({ x: 200, y: 320 }, grid, 8, new Map(), "self", 60);
    // A point on the other side of the wall should NOT be directly reachable within budget.
    const through = flood.pathTo({ x: 320, y: 320 }, 60);
    // Either null (no progress) or a point that's still on the left side of the wall.
    if (through) {
      expect(through.x).toBeLessThan(240);
    }
  });
});
