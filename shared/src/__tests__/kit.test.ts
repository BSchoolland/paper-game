import { describe, expect, test } from "bun:test";
import { ShapeKind } from "../core/types.js";
import type { AttackAbility, Entity, GameState, PlayerAction, ZoneAbility } from "../core/types.js";
import { resolveAction } from "../combat/turn-resolver.js";
import { abilityReady } from "../combat/kit.js";
import { serializeGameState, deserializeGameState } from "../core/serialization.js";
import { AiController } from "../ai/ai-runner.js";
import { makeEntity, makeState } from "./test-helpers.js";

const bite = (kit?: AttackAbility["kit"]): AttackAbility => ({
  id: "bite", name: "Bite", kind: "attack", cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
  damage: 10, knockback: 0, kit,
});

const slam = (kit?: AttackAbility["kit"]): AttackAbility => ({
  id: "slam", name: "Slam", kind: "attack", cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 60, range: 100 },
  damage: 30, knockback: 0, kit,
});

const MOVE = { id: "move", name: "Move", kind: "move", cost: { blue: 1 }, distance: 100 } as const;

function withEnergy(e: Entity, red: number, blue = 2): Entity {
  return { ...e, energy: { ...e.energy, red, blue, regenRed: red, regenBlue: blue, maxRed: red, maxBlue: blue } };
}

function cast(state: GameState, entityId: string, abilityId: string): { state: GameState; applied: boolean } {
  const action: PlayerAction = { type: "ability", entityId, abilityId, aimDirection: { x: 1, y: 0 } };
  const result = resolveAction(state, action, { allowOutOfTurn: true });
  return { state: result.state, applied: result.state !== state };
}

function endTurn(state: GameState): GameState {
  return resolveAction(state, { type: "endTurn" }).state;
}

describe("resolver cooldown gating", () => {
  test("an ability with cooldown cannot be recast until the entity's own turns tick it down", () => {
    const boss = withEnergy(
      makeEntity("boss", 100, 100, "red", { abilities: [MOVE, bite({ cooldown: 2 })] }),
      5,
    );
    const foe = makeEntity("foe", 150, 100, "blue");
    let state = makeState([boss, foe]);

    const first = cast(state, "boss", "bite");
    expect(first.applied).toBe(true);
    state = first.state;
    expect(state.entities.get("boss")!.cooldowns).toEqual({ bite: 2 });

    // Same turn: blocked despite plenty of energy.
    expect(cast(state, "boss", "bite").applied).toBe(false);

    // Flip to blue and back to red once: cooldown ticks 2 -> 1, still blocked.
    state = endTurn(state);
    state = endTurn(state);
    expect(state.entities.get("boss")!.cooldowns).toEqual({ bite: 1 });
    expect(cast(state, "boss", "bite").applied).toBe(false);

    // Second full round: cooldown expires and the entry is dropped.
    state = endTurn(state);
    state = endTurn(state);
    expect(state.entities.get("boss")!.cooldowns).toBeUndefined();
    expect(cast(state, "boss", "bite").applied).toBe(true);
  });

  test("cooldown 1 blocks only the rest of the current turn", () => {
    const boss = withEnergy(
      makeEntity("boss", 100, 100, "red", { abilities: [MOVE, bite({ cooldown: 1 })] }),
      5,
    );
    const foe = makeEntity("foe", 150, 100, "blue");
    let state = makeState([boss, foe]);

    state = cast(state, "boss", "bite").state;
    expect(cast(state, "boss", "bite").applied).toBe(false);

    state = endTurn(state);
    state = endTurn(state);
    expect(cast(state, "boss", "bite").applied).toBe(true);
  });
});

describe("resolver HP-phase gating", () => {
  test("hpBelow locks an ability until the entity is wounded past the threshold", () => {
    const enrage = bite({ hpBelow: 0.5 });
    const boss = makeEntity("boss", 100, 100, "red", { abilities: [MOVE, enrage] });
    const foe = makeEntity("foe", 150, 100, "blue");

    const healthy = makeState([boss, foe]);
    expect(abilityReady(boss, enrage)).toBe(false);
    expect(cast(healthy, "boss", "bite").applied).toBe(false);

    const wounded = { ...boss, hp: 40 };
    expect(abilityReady(wounded, enrage)).toBe(true);
    expect(cast(makeState([wounded, foe]), "boss", "bite").applied).toBe(true);
  });

  test("hpAbove locks an ability once the entity drops to the threshold", () => {
    const opener = bite({ hpAbove: 0.5 });
    const healthy = makeEntity("boss", 100, 100, "red", { abilities: [MOVE, opener] });
    expect(abilityReady(healthy, opener)).toBe(true);
    expect(abilityReady({ ...healthy, hp: 50 }, opener)).toBe(false);
  });
});

describe("cooldowns serialization", () => {
  test("pending cooldowns survive a serialize/deserialize round-trip", () => {
    const boss = withEnergy(
      makeEntity("boss", 100, 100, "red", { abilities: [MOVE, bite({ cooldown: 3 })] }),
      5,
    );
    const state = cast(makeState([boss, makeEntity("foe", 150, 100, "blue")]), "boss", "bite").state;
    const restored = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(state))));
    expect(restored.entities.get("boss")!.cooldowns).toEqual({ bite: 3 });
  });
});

// ---------------------------------------------------------------------------
// Scripted-AI kit selection
// ---------------------------------------------------------------------------

function plan(state: GameState): PlayerAction[] {
  return new AiController().computeActions(state, "red").slice(0, -1);
}

function abilityIds(actions: PlayerAction[]): string[] {
  return actions.map(a => (a.type === "ability" ? a.abilityId : a.type));
}

describe("kit-driven scripted AI", () => {
  test("a non-kit entity with two attacks still uses the first (legacy kit-of-one)", () => {
    const foe = withEnergy(
      makeEntity("foe", 100, 100, "red", { strategy: "rush", abilities: [MOVE, bite(), slam()] }),
      5,
    );
    const state = makeState([foe, makeEntity("hero", 150, 100, "blue")]);
    expect(abilityIds(plan(state))).toEqual(["bite"]);
  });

  test("a kit entity prefers the higher-priority attack", () => {
    const foe = withEnergy(
      makeEntity("foe", 100, 100, "red", {
        strategy: "rush",
        abilities: [MOVE, bite({ priority: 0 }), slam({ priority: 5 })],
      }),
      5,
    );
    const state = makeState([foe, makeEntity("hero", 150, 100, "blue")]);
    expect(abilityIds(plan(state))).toEqual(["slam"]);
  });

  test("the AI rotates: falls back to the filler attack while the big one is on cooldown", () => {
    const foe = withEnergy(
      makeEntity("foe", 100, 100, "red", {
        strategy: "rush",
        abilities: [MOVE, bite(), slam({ priority: 5, cooldown: 2 })],
      }),
      5,
    );
    let state = makeState([foe, makeEntity("hero", 150, 100, "blue", { hp: 500, maxHp: 500 })]);

    const turn1 = plan(state);
    expect(abilityIds(turn1)).toEqual(["slam"]);
    for (const a of turn1) state = resolveAction(state, a).state;
    state = endTurn(state); // -> blue
    state = endTurn(state); // -> red, slam cooldown ticks to 1

    const turn2 = plan(state);
    expect(abilityIds(turn2)).toEqual(["bite"]);
  });

  test("minTargets holds a big AoE back until enough targets are in the blast", () => {
    const foe = withEnergy(
      makeEntity("foe", 100, 100, "red", {
        strategy: "rush",
        abilities: [MOVE, bite(), slam({ priority: 5, minTargets: 2 })],
      }),
      5,
    );
    const solo = makeState([foe, makeEntity("hero", 150, 100, "blue")]);
    expect(abilityIds(plan(solo))).toEqual(["bite"]);

    const pair = makeState([
      foe,
      makeEntity("hero", 150, 100, "blue"),
      makeEntity("hero2", 150, 140, "blue"),
    ]);
    expect(abilityIds(plan(pair))).toEqual(["slam"]);
  });

  test("an hpBelow phase attack joins the rotation once the boss is wounded", () => {
    const abilities = [MOVE, bite(), slam({ priority: 9, hpBelow: 0.5 })];
    const healthy = withEnergy(makeEntity("foe", 100, 100, "red", { strategy: "rush", abilities }), 5);
    const hero = makeEntity("hero", 150, 100, "blue");
    expect(abilityIds(plan(makeState([healthy, hero])))).toEqual(["bite"]);

    const wounded = { ...healthy, hp: 40 };
    expect(abilityIds(plan(makeState([wounded, hero])))).toEqual(["slam"]);
  });

  test("a kit zone ability is cast as a support action before attacking", () => {
    const field: ZoneAbility = {
      id: "field", name: "Field", kind: "zone", cost: { blue: 1 }, range: 150,
      kit: { cooldown: 3 },
      zone: { effect: "damage", radius: 60, duration: 2, magnitude: 5, color: 0xff0000 },
    };
    const foe = withEnergy(
      makeEntity("foe", 100, 100, "red", { strategy: "rush", abilities: [MOVE, bite(), field] }),
      5,
    );
    const state = makeState([foe, makeEntity("hero", 150, 100, "blue")]);
    expect(abilityIds(plan(state))).toEqual(["field", "bite"]);
  });

  test("a zone without a kit rule on a kit entity is never cast (opt-in)", () => {
    const field: ZoneAbility = {
      id: "field", name: "Field", kind: "zone", cost: { blue: 1 }, range: 150,
      zone: { effect: "damage", radius: 60, duration: 2, magnitude: 5, color: 0xff0000 },
    };
    const foe = withEnergy(
      makeEntity("foe", 100, 100, "red", { strategy: "rush", abilities: [MOVE, bite({ cooldown: 1 }), field] }),
      5,
    );
    const state = makeState([foe, makeEntity("hero", 150, 100, "blue")]);
    expect(abilityIds(plan(state))).toEqual(["bite"]);
  });
});
