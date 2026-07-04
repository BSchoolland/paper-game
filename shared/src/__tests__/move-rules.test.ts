import { describe, expect, test } from "bun:test";
import { reachableArea, planMove } from "../map/move-rules.js";
import { resolveAction } from "../combat/turn-resolver.js";
import { getAbilityCost } from "../combat/ability-cost.js";
import { createGrid, setBlocked, isPositionWalkable } from "../map/collision-grid.js";
import { makeEntity, makeState } from "./test-helpers.js";
import type { Entity, GridState, MoveAbility } from "../core/types.js";

function entitiesOf(...list: Entity[]): Map<string, Entity> {
  return new Map(list.map(e => [e.id, e]));
}

describe("reachableArea", () => {
  test("open field: snaps to points within the move budget, rejects points far beyond it", () => {
    const grid = createGrid(80, 80, 8); // 640×640
    const self = makeEntity("self", 320, 320, "red", { collisionRadius: 12 });
    const flood = reachableArea(self, grid, entitiesOf(self), 130);
    // Within budget (path ≈ straight here): reachable as-is.
    const near = flood.pathTo({ x: 320 + 100, y: 320 }, 130);
    expect(near).not.toBeNull();
    expect(Math.abs(near!.x - 420)).toBeLessThanOrEqual(12);
    // Beyond budget: snapped back to the rim, never past it.
    const far = flood.pathTo({ x: 320 + 250, y: 320 }, 130);
    if (far) expect(far.x).toBeLessThanOrEqual(320 + 130 + 12);
  });

  test("a wall deforms the reachable area (it does not extend behind the wall)", () => {
    let grid = createGrid(80, 80, 8);
    // Vertical wall just east of the unit, tall enough that paths can't wrap around within budget.
    for (let cy = 20; cy < 60; cy++) grid = setBlocked(grid, 45, cy); // x≈360
    const self = makeEntity("self", 320, 320, "red", { collisionRadius: 12 });
    const flood = reachableArea(self, grid, entitiesOf(self), 130);
    // A point straight through the wall is NOT reachable (straight-line would be ~140px but blocked).
    const through = flood.pathTo({ x: 460, y: 320 }, 130);
    if (through) expect(through.x).toBeLessThan(360); // best it can do stays on the near side
  });
});

describe("planMove", () => {
  test("a legal in-range click is returned exactly", () => {
    const grid = createGrid(80, 80, 8);
    const self = makeEntity("self", 100, 100, "red", { collisionRadius: 12 });
    const plan = planMove(self, { x: 150, y: 100 }, grid, entitiesOf(self));
    expect(plan).not.toBeNull();
    expect(plan!.dest).toEqual({ x: 150, y: 100 });
    expect(plan!.cost).toBeGreaterThan(0);
    expect(plan!.cost).toBeLessThanOrEqual(plan!.budget);
  });

  test("a click inside a wall snaps clear of it, within budget", () => {
    let grid = createGrid(80, 80, 8);
    for (let cx = 36; cx <= 44; cx++) for (let cy = 36; cy <= 44; cy++) grid = setBlocked(grid, cx, cy);
    const self = makeEntity("self", 240, 320, "red", { collisionRadius: 12 });
    const plan = planMove(self, { x: 320, y: 320 }, grid, entitiesOf(self));
    expect(plan).not.toBeNull();
    expect(isPositionWalkable(grid, plan!.dest, 12)).toBe(true);
    expect(plan!.cost).toBeLessThanOrEqual(plan!.budget);
  });

  test("an out-of-range click clamps to the reachable boundary", () => {
    const grid = createGrid(80, 80, 8);
    const self = makeEntity("self", 100, 100, "red", { collisionRadius: 12 });
    const plan = planMove(self, { x: 600, y: 100 }, grid, entitiesOf(self));
    expect(plan).not.toBeNull();
    expect(plan!.cost).toBeLessThanOrEqual(plan!.budget);
    expect(plan!.dest.x - 100).toBeGreaterThan(plan!.budget - 20); // actually near the rim, not short of it
  });

  test("a click on another entity snaps off it", () => {
    const grid = createGrid(80, 80, 8);
    const self = makeEntity("self", 100, 100, "red", { collisionRadius: 12 });
    const other = makeEntity("o", 180, 100, "blue", { collisionRadius: 16 });
    const plan = planMove(self, { x: 180, y: 100 }, grid, entitiesOf(self, other));
    expect(plan).not.toBeNull();
    expect(Math.hypot(plan!.dest.x - 180, plan!.dest.y - 100)).toBeGreaterThanOrEqual(12 + 16);
  });

  test("moveRadius: a smaller move radius stops nearer a wall than the full hurtbox would", () => {
    let grid = createGrid(160, 160, 2); // 320×320 world, fine cells
    for (let cx = 150; cx < 160; cx++) for (let cy = 0; cy < 160; cy++) grid = setBlocked(grid, cx, cy); // wall at x≥300
    const slim = makeEntity("slim", 200, 160, "red", { collisionRadius: 16, moveRadius: 10 });
    const fat = makeEntity("fat", 200, 160, "red", { collisionRadius: 16 });
    const target = { x: 296, y: 160 }; // right up against the wall
    const slimPlan = planMove(slim, target, grid, entitiesOf(slim));
    const fatPlan = planMove(fat, target, grid, entitiesOf(fat));
    expect(slimPlan).not.toBeNull();
    expect(fatPlan).not.toBeNull();
    expect(slimPlan!.dest.x).toBeGreaterThan(fatPlan!.dest.x);
    expect(isPositionWalkable(grid, slimPlan!.dest, 10)).toBe(true);
    expect(isPositionWalkable(grid, fatPlan!.dest, 16)).toBe(true);
  });

  test("returns null when the entity cannot afford to move", () => {
    const grid = createGrid(80, 80, 8);
    const broke = makeEntity("self", 100, 100, "red", {
      energy: { red: 2, blue: 0, regenRed: 2, regenBlue: 2, maxRed: 2, maxBlue: 2 },
    });
    expect(planMove(broke, { x: 150, y: 100 }, grid, entitiesOf(broke))).toBeNull();
  });
});

// THE regression test for client/server move-rule drift: every destination the client-side planner
// emits must be accepted by the authoritative resolver, and charged exactly the planned cost. This
// held only "within a pixel" when the client snapped on a coarse flood and the server re-measured
// with A* — boundary clicks were denied. Both now read one flood; this pins that.
describe("planMove ⊆ resolver acceptance", () => {
  test("random walls, random clicks: every planned move resolves, at the planned price", () => {
    let rngState = 424242;
    const rand = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    let planned = 0;
    for (let round = 0; round < 60; round++) {
      // 640×640 world at cellSize 8, with a handful of random wall slabs.
      let grid: GridState = createGrid(80, 80, 8);
      const slabs = 2 + Math.floor(rand() * 4);
      for (let s = 0; s < slabs; s++) {
        const cx0 = Math.floor(rand() * 70), cy0 = Math.floor(rand() * 70);
        const w = 1 + Math.floor(rand() * 8), h = 1 + Math.floor(rand() * 8);
        for (let cx = cx0; cx < cx0 + w; cx++) for (let cy = cy0; cy < cy0 + h; cy++) grid = setBlocked(grid, cx, cy);
      }
      const hero = makeEntity("hero", 60 + rand() * 520, 60 + rand() * 520, "red", { collisionRadius: 12 });
      if (!isPositionWalkable(grid, hero.position, 12)) continue;
      const state = makeState([hero], { grid });

      for (let c = 0; c < 8; c++) {
        const click = { x: rand() * 640, y: rand() * 640 };
        const plan = planMove(hero, click, state.grid, state.entities);
        if (!plan) continue;
        planned++;

        const result = resolveAction(
          state,
          { type: "ability", entityId: "hero", abilityId: "move", destination: plan.dest },
          { pathBased: true },
        );
        expect(result.state).not.toBe(state); // never denied
        // Charged exactly what the plan displayed.
        const moved = result.state.entities.get("hero")!;
        expect(moved.position).toEqual(plan.dest);
        const move = hero.abilities.find(a => a.kind === "move") as MoveAbility;
        const expectedSpend = getAbilityCost(move, { distance: plan.cost }).blue ?? 0;
        expect(hero.energy.blue - moved.energy.blue).toBe(expectedSpend);
      }
    }
    expect(planned).toBeGreaterThan(100); // the sweep actually exercised the rule
  });
});
