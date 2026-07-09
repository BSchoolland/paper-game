/**
 * Edge-case coverage for the loot-overhaul verbs: damage riders, on-kill refunds, blink, swap,
 * summon, convert, restore, ability charges, and auras. Happy paths are locked by the golden
 * master; these assert the boundary rules (clamps, rejections, no-ops).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { ShapeKind } from "../core/types.js";
import type {
  AttackAbility, ConvertAbility, Entity, GameState, MoveAbility, RestoreAbility,
  SummonAbility, TeamId, UnitTemplate, Vec2,
} from "../core/types.js";
import { resolveAction, createGameState } from "../combat/turn-resolver.js";
import { createGrid, CELL_WALL } from "../map/collision-grid.js";
import { setTemplateRegistry, getTemplateRegistry } from "../encounter/effects.js";
import { makeEntity } from "../encounter/entity-factory.js";

const MOVE: MoveAbility = { id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 130 };
const BLINK: MoveAbility = { id: "blink", name: "Blink", kind: "move", cost: { blue: 2 }, distance: 100, mode: "blink" };
const STRIKE: AttackAbility = {
  id: "strike", name: "Strike", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 }, damage: 20, knockback: 0,
};

function makeUnit(id: string, x: number, y: number, teamId: TeamId, o: Partial<Entity> = {}): Entity {
  return {
    id, name: id, position: { x, y }, collisionRadius: 16,
    hp: 100, maxHp: 100, barrier: 0, teamId,
    energy: { red: 10, blue: 10, regenRed: 4, regenBlue: 4, maxRed: 12, maxBlue: 12 },
    abilities: [MOVE, STRIKE],
    ...o,
  };
}

const GRID_W = 40, GRID_H = 40, CELL = 8;

function makeGame(entities: Entity[], stampWalls?: (walls: Uint8Array) => void): GameState {
  const grid = createGrid(GRID_W, GRID_H, CELL);
  if (stampWalls) stampWalls(grid.walls);
  const map = new Map<string, Entity>();
  for (const e of entities) map.set(e.id, e);
  return createGameState({ entities: map, grid, mapDefinition: { seed: 0, objects: [] }, startingTeam: "red" });
}

const aim = (from: Vec2, to: Vec2): Vec2 => ({ x: to.x - from.x, y: to.y - from.y });

const MINION: UnitTemplate = {
  className: "Minion", hp: 20, energy: { red: 2, blue: 2 }, collisionRadius: 10,
  abilities: [MOVE, STRIKE], strategy: "rush",
};

beforeAll(() => setTemplateRegistry({ minion: MINION }));
afterAll(() => setTemplateRegistry({}));

describe("damage riders", () => {
  const riderAttack: AttackAbility = {
    ...STRIKE, id: "rider", riders: [
      { when: "target-at-full-hp", amount: 15, label: "AMBUSH" },
      { when: "target-below-hp", pct: 0.3, amount: 30 },
    ],
  };

  it("adds full-hp bonus with its label, and not the execute bonus", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [riderAttack] });
    const b = makeUnit("b", 160, 160, "blue");
    const r = resolveAction(makeGame([a, b]), { type: "ability", entityId: "a", abilityId: "rider", aimDirection: aim(a.position, b.position) });
    const hit = r.events.find(e => e.type === "attack")!.hits[0]!;
    expect(hit.damage).toBe(35);
    expect(hit.riderLabels).toEqual(["AMBUSH"]);
  });

  it("a barrier disqualifies target-at-full-hp", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [riderAttack] });
    const b = makeUnit("b", 160, 160, "blue", { barrier: 10 });
    const r = resolveAction(makeGame([a, b]), { type: "ability", entityId: "a", abilityId: "rider", aimDirection: aim(a.position, b.position) });
    const hit = r.events.find(e => e.type === "attack")!.hits[0]!;
    expect(hit.damage).toBe(20);
    expect(hit.riderLabels).toBeUndefined();
  });

  it("execute rider fires below the threshold", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [riderAttack] });
    const b = makeUnit("b", 160, 160, "blue", { hp: 25 });
    const r = resolveAction(makeGame([a, b]), { type: "ability", entityId: "a", abilityId: "rider", aimDirection: aim(a.position, b.position) });
    const hit = r.events.find(e => e.type === "attack")!.hits[0]!;
    expect(hit.damage).toBe(50);
    expect(hit.riderLabels).toEqual(["EXECUTE"]);
  });
});

describe("on-kill refunds", () => {
  it("clamps ability onKill plus onKillEnergy passives to the bank caps", () => {
    const reaper: AttackAbility = { ...STRIKE, id: "reaper", onKill: { red: 5 } };
    // regen 0 so createGameState's initial turn-start doesn't shift the pools under the test.
    const a = makeUnit("a", 100, 160, "red", {
      abilities: [reaper],
      energy: { red: 10, blue: 10, regenRed: 0, regenBlue: 0, maxRed: 12, maxBlue: 12 },
      passives: [{ type: "onKillEnergy", blue: 3 }],
    });
    const b = makeUnit("b", 160, 160, "blue", { hp: 5 });
    const c = makeUnit("c", 60, 60, "blue");
    const r = resolveAction(makeGame([a, b, c]), { type: "ability", entityId: "a", abilityId: "reaper", aimDirection: aim(a.position, b.position) });
    const attacker = r.state.entities.get("a")!;
    // Paid 2 red (10->8), refund 5 clamped to max 12; blue 10 + 3 clamped to 12.
    expect(attacker.energy.red).toBe(12);
    expect(attacker.energy.blue).toBe(12);
    const restore = r.events.find(e => e.type === "restore");
    expect(restore).toMatchObject({ reason: "onKill", red: 4, blue: 2 });
  });

  it("no refund event on a non-lethal hit", () => {
    const reaper: AttackAbility = { ...STRIKE, id: "reaper", onKill: { red: 5 } };
    const a = makeUnit("a", 100, 160, "red", { abilities: [reaper] });
    const b = makeUnit("b", 160, 160, "blue");
    const r = resolveAction(makeGame([a, b]), { type: "ability", entityId: "a", abilityId: "reaper", aimDirection: aim(a.position, b.position) });
    expect(r.events.some(e => e.type === "restore")).toBe(false);
  });
});

describe("blink", () => {
  it("crosses walls a walk cannot", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [BLINK] });
    const b = makeUnit("b", 300, 160, "blue");
    const s = makeGame([a, b], (walls) => {
      for (let cy = 0; cy < GRID_H; cy++) walls[cy * GRID_W + 20] = CELL_WALL;
    });
    const r = resolveAction(s, { type: "ability", entityId: "a", abilityId: "blink", destination: { x: 190, y: 160 } });
    expect(r.events).toEqual([{ type: "blink", entityId: "a", from: { x: 100, y: 160 }, to: { x: 190, y: 160 } }]);
  });

  it("rejects beyond reach and onto walls", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [BLINK] });
    const s = makeGame([a], (walls) => { walls[20 * GRID_W + 24] = CELL_WALL; });
    expect(resolveAction(s, { type: "ability", entityId: "a", abilityId: "blink", destination: { x: 250, y: 160 } }).state).toBe(s);
    expect(resolveAction(s, { type: "ability", entityId: "a", abilityId: "blink", destination: { x: 196, y: 164 } }).state).toBe(s);
  });

  it("is fully denied while rooted (reach 0)", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [BLINK], statusEffects: [{ type: "rooted", duration: 2, value: 1 }] });
    const s = makeGame([a]);
    expect(resolveAction(s, { type: "ability", entityId: "a", abilityId: "blink", destination: { x: 150, y: 160 } }).state).toBe(s);
  });
});

describe("swap", () => {
  const swapStrike: AttackAbility = {
    ...STRIKE, id: "swap-strike", shape: { kind: ShapeKind.Point, range: 200 }, damage: 5, onHit: [{ type: "swap" }],
  };

  it("trades places and emits two blinks", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [swapStrike] });
    const b = makeUnit("b", 220, 160, "blue");
    const r = resolveAction(makeGame([a, b]), { type: "ability", entityId: "a", abilityId: "swap-strike", aimDirection: aim(a.position, b.position) });
    expect(r.state.entities.get("a")!.position).toEqual({ x: 220, y: 160 });
    expect(r.state.entities.get("b")!.position).toEqual({ x: 100, y: 160 });
    expect(r.events.filter(e => e.type === "blink")).toHaveLength(2);
  });

  it("is stopped by a guard (defense policy: displacement)", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [swapStrike] });
    const b = makeUnit("b", 220, 160, "blue");
    const r = resolveAction(makeGame([a, b]),
      { type: "ability", entityId: "a", abilityId: "swap-strike", aimDirection: aim(a.position, b.position) },
      { defenseMap: new Map([["b", 0.5]]) });
    expect(r.state.entities.get("a")!.position).toEqual({ x: 100, y: 160 });
    expect(r.events.some(e => e.type === "blink")).toBe(false);
  });
});

describe("summon", () => {
  const call: SummonAbility = { id: "call", name: "Call", kind: "summon", cost: { red: 2 }, templateKey: "minion", count: 2, range: 100 };

  it("spawns allied units near the aim point", () => {
    const a = makeUnit("a", 100, 160, "red", { abilities: [call] });
    const b = makeUnit("b", 300, 160, "blue");
    const r = resolveAction(makeGame([a, b]), { type: "ability", entityId: "a", abilityId: "call", aimDirection: { x: 60, y: 0 } });
    const spawned = [...r.state.entities.values()].filter(e => e.id.startsWith("spawn-"));
    expect(spawned).toHaveLength(2);
    for (const s of spawned) expect(s.teamId).toBe("red");
    expect(r.events.filter(e => e.type === "spawn")).toHaveLength(2);
  });

  it("throws loudly on an unregistered template", () => {
    const bad: SummonAbility = { ...call, id: "bad", templateKey: "nope" };
    const a = makeUnit("a", 100, 160, "red", { abilities: [bad] });
    const s = makeGame([a, makeUnit("b", 300, 160, "blue")]);
    expect(() => resolveAction(s, { type: "ability", entityId: "a", abilityId: "bad", aimDirection: { x: 60, y: 0 } })).toThrow(/not in the active registry/);
  });
});

describe("convert & restore", () => {
  it("convert pays one pool, credits the other, and no-ops at the cap", () => {
    const conv: ConvertAbility = { id: "conv", name: "Conv", kind: "convert", cost: { blue: 2 }, gain: { red: 2 } };
    const a = makeUnit("a", 100, 160, "red", { abilities: [conv], energy: { red: 4, blue: 10, regenRed: 0, regenBlue: 0, maxRed: 12, maxBlue: 12 } });
    const s = makeGame([a, makeUnit("b", 300, 160, "blue")]);
    const r = resolveAction(s, { type: "ability", entityId: "a", abilityId: "conv" });
    expect(r.state.entities.get("a")!.energy).toMatchObject({ red: 6, blue: 8 });

    const full = makeUnit("a2", 100, 200, "red", { abilities: [conv], energy: { red: 12, blue: 10, regenRed: 0, regenBlue: 0, maxRed: 12, maxBlue: 12 } });
    const s2 = makeGame([full, makeUnit("b2", 300, 200, "blue")]);
    expect(resolveAction(s2, { type: "ability", entityId: "a2", abilityId: "conv" }).state).toBe(s2);
  });

  it("restore heals to cap and reports only what changed", () => {
    const wind: RestoreAbility = { id: "wind", name: "Wind", kind: "restore", cost: { red: 1 }, hp: 50 };
    const a = makeUnit("a", 100, 160, "red", { abilities: [wind], hp: 80 });
    const s = makeGame([a, makeUnit("b", 300, 160, "blue")]);
    const r = resolveAction(s, { type: "ability", entityId: "a", abilityId: "wind" });
    expect(r.state.entities.get("a")!.hp).toBe(100);
    expect(r.events).toEqual([{ type: "restore", entityId: "a", hp: 20, red: 0, blue: 0, reason: "consume" }]);
  });
});

describe("ability charges", () => {
  it("gates on remaining uses and decrements per cast", () => {
    const wind: RestoreAbility = { id: "wind", name: "Wind", kind: "restore", cost: { red: 1 }, hp: 10, uses: 2 };
    const a = makeUnit("a", 100, 160, "red", { abilities: [wind], hp: 10 });
    let s = makeGame([a, makeUnit("b", 300, 160, "blue")]);
    s = resolveAction(s, { type: "ability", entityId: "a", abilityId: "wind" }).state;
    expect(s.entities.get("a")!.abilityUses).toEqual({ wind: 1 });
    s = resolveAction(s, { type: "ability", entityId: "a", abilityId: "wind" }).state;
    expect(s.entities.get("a")!.abilityUses).toEqual({ wind: 0 });
    const spent = resolveAction(s, { type: "ability", entityId: "a", abilityId: "wind" });
    expect(spent.state).toBe(s);
  });

  it("makeEntity seeds full charges from the template", () => {
    const wind: RestoreAbility = { id: "wind", name: "Wind", kind: "restore", cost: { red: 1 }, hp: 10, uses: 3 };
    const t: UnitTemplate = { className: "X", hp: 50, energy: { red: 2, blue: 2 }, collisionRadius: 10, abilities: [MOVE, wind] };
    expect(makeEntity("x", "X", 0, 0, "red", t).abilityUses).toEqual({ wind: 3 });
  });
});

describe("auras", () => {
  it("enemy-facing damage aura ticks foes in radius, never allies, and dies with its owner", () => {
    const bearer = makeUnit("a", 100, 160, "red", {
      passives: [{ type: "aura", aura: { effect: "damage", radius: 80, magnitude: 6, color: 0xff0000, affects: "enemies" } }],
    });
    const ally = makeUnit("ally", 130, 160, "red");
    const foe = makeUnit("b", 160, 160, "blue");
    const far = makeUnit("c", 300, 300, "blue");
    const s = makeGame([bearer, ally, foe, far]);
    // One tick already landed at game creation (createGameState runs the first turn-start).
    expect(s.entities.get("b")!.hp).toBe(94);
    const r = resolveAction(s, { type: "endTurn" });
    expect(r.state.entities.get("b")!.hp).toBe(88);
    expect(r.state.entities.get("c")!.hp).toBe(100);
    expect(r.state.entities.get("ally")!.hp).toBe(100);
    expect(r.events.filter(e => e.type === "auraTick")).toHaveLength(1);
  });

  it("ally-facing heal aura includes the owner", () => {
    const bearer = makeUnit("a", 100, 160, "red", {
      hp: 50,
      passives: [{ type: "aura", aura: { effect: "heal", radius: 80, magnitude: 5, color: 0x00ff00, affects: "allies" } }],
    });
    const s = makeGame([bearer, makeUnit("b", 300, 300, "blue")]);
    expect(s.entities.get("a")!.hp).toBe(55); // creation tick
    const r = resolveAction(s, { type: "endTurn" });
    expect(r.state.entities.get("a")!.hp).toBe(60);
  });
});
