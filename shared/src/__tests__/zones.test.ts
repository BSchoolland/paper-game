import { describe, it, expect } from "bun:test";
import { resolveAction } from "../combat/turn-resolver.js";
import { makeEntity, makeState } from "./test-helpers.js";
import { CELL_WALL, CELL_EMPTY } from "../map/collision-grid.js";
import type { ZoneAbility } from "../core/types.js";

const DAMAGE_ZONE: ZoneAbility = {
  id: "z-dmg", name: "Damage Zone", kind: "zone", cost: { red: 1 }, range: 200,
  zone: { effect: "damage", radius: 50, duration: 2, magnitude: 10, color: 0xff0000 },
};
const HEAL_ZONE: ZoneAbility = {
  id: "z-heal", name: "Heal Zone", kind: "zone", cost: { red: 1 }, range: 200,
  zone: { effect: "heal", radius: 50, duration: 2, magnitude: 15, color: 0x00ff00 },
};
const WALL_ZONE: ZoneAbility = {
  id: "z-wall", name: "Wall Zone", kind: "zone", cost: { red: 1 }, range: 200,
  zone: { effect: "wall", radius: 24, duration: 2, magnitude: 0, color: 0x333333 },
};

describe("zones", () => {
  it("a placed zone enters game state, clamped to the aim length, with a zoneCreated event", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red", { abilities: [DAMAGE_ZONE] })]);
    const { state: next, events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "z-dmg", aimDirection: { x: 60, y: 0 } });
    expect(next.zones).toHaveLength(1);
    expect(next.zones[0]!.center.x).toBeCloseTo(160);
    expect(events.some(e => e.type === "zoneCreated")).toBe(true);
  });

  it("damages entities standing inside at the start of a turn", () => {
    let state = makeState([
      makeEntity("r1", 100, 100, "red", { abilities: [DAMAGE_ZONE] }),
      makeEntity("b1", 200, 100, "blue"),
    ]);
    state = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "z-dmg", aimDirection: { x: 100, y: 0 } }).state;
    const { state: afterTurn, events } = resolveAction(state, { type: "endTurn" });
    expect(afterTurn.entities.get("b1")!.hp).toBe(90);
    expect(events.some(e => e.type === "zoneTick" && e.entityId === "b1")).toBe(true);
  });

  it("heal zones top up everyone inside but never overheal", () => {
    let state = makeState([
      makeEntity("r1", 100, 100, "red", { abilities: [HEAL_ZONE], hp: 95 }),
      makeEntity("b1", 130, 100, "blue", { hp: 50 }),
    ]);
    state = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "z-heal", aimDirection: { x: 10, y: 0 } }).state;
    state = resolveAction(state, { type: "endTurn" }).state; // both inside: b1 50 -> 65, r1 95 -> 100 (capped)
    expect(state.entities.get("b1")!.hp).toBe(65);
    expect(state.entities.get("r1")!.hp).toBe(100);
  });

  it("a wall zone stamps the grid and reverts on expiry", () => {
    // A second team keeps the game alive across the end-turns we need.
    let state = makeState([
      makeEntity("r1", 100, 100, "red", { abilities: [WALL_ZONE] }),
      makeEntity("b1", 700, 700, "blue"),
    ]);
    state = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "z-wall", aimDirection: { x: 80, y: 0 } }).state;
    const idx = state.zones[0]!.stampedCells![0]!.index;
    expect(state.grid.walls[idx]).toBe(CELL_WALL);
    state = resolveAction(state, { type: "endTurn" }).state; // remaining 2 -> 1
    state = resolveAction(state, { type: "endTurn" }).state; // remaining 1 -> 0, expires
    expect(state.zones).toHaveLength(0);
    expect(state.grid.walls[idx]).toBe(CELL_EMPTY);
  });

  it("refuses a wall zone placed over an entity", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { abilities: [WALL_ZONE] }),
      makeEntity("b1", 180, 100, "blue"),
    ]);
    const r = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "z-wall", aimDirection: { x: 80, y: 0 } });
    expect(r.state).toBe(state);
  });
});
