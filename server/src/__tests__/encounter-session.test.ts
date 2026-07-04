import { describe, it, expect } from "bun:test";
import type { Entity, GameState, MoveAbility } from "shared";
import { createGameState, createGrid, planMove, getAbilityCost } from "shared";
import { EncounterSession } from "../encounter-session.js";

const MOVE: MoveAbility = { id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 130 };

function hero(id: string, x: number, y: number, teamId: "red" | "blue"): Entity {
  return {
    id, name: id, position: { x, y }, collisionRadius: 16,
    hp: 100, maxHp: 100, barrier: 0, teamId,
    energy: { red: 2, blue: 2, regenRed: 2, regenBlue: 2, maxRed: 2, maxBlue: 2 },
    abilities: [MOVE],
  };
}

function makeSession(entities: Entity[]): EncounterSession {
  const state: GameState = createGameState({
    entities: new Map(entities.map(e => [e.id, e])),
    grid: createGrid(100, 100, 8), // 800×800
    mapDefinition: { seed: 0, objects: [] },
  });
  return EncounterSession.fromState(state);
}

// Wire-level counterpart of the shared planMove ⊆ resolver property test: drives the actual
// applyAction handler (turn-order gate + path-based resolve + denial logging) rather than
// resolveAction directly.
describe("EncounterSession.applyAction", () => {
  it("accepts a planMove destination and charges the planned cost", () => {
    const session = makeSession([hero("h1", 100, 100, "red")]);
    const h = session.state.entities.get("h1")!;
    // Click far past max range so the plan clamps to the reachable boundary — the exact
    // population of moves the pre-unification server denied.
    const plan = planMove(h, { x: 500, y: 320 }, session.state.grid, session.state.entities);
    expect(plan).not.toBeNull();

    const { changed, events } = session.applyAction(
      { type: "ability", entityId: "h1", abilityId: "move", destination: plan!.dest },
    );
    expect(changed).toBe(true);
    expect(events.some(e => e.type === "move")).toBe(true);
    const after = session.state.entities.get("h1")!;
    expect(after.position).toEqual(plan!.dest);
    expect(h.energy.blue - after.energy.blue).toBe(getAbilityCost(MOVE, { distance: plan!.cost }).blue ?? 0);
  });

  it("denies a destination beyond the move budget without changing state", () => {
    const session = makeSession([hero("h1", 100, 100, "red")]);
    const before = session.state;
    const { changed, events } = session.applyAction(
      { type: "ability", entityId: "h1", abilityId: "move", destination: { x: 400, y: 100 } },
    );
    expect(changed).toBe(false);
    expect(events).toHaveLength(0);
    expect(session.state).toBe(before);
  });

  it("denies an out-of-turn action from the inactive team", () => {
    const session = makeSession([hero("h1", 100, 100, "red"), hero("b1", 600, 600, "blue")]);
    const { changed } = session.applyAction(
      { type: "ability", entityId: "b1", abilityId: "move", destination: { x: 560, y: 600 } },
    );
    expect(changed).toBe(false);
  });
});
