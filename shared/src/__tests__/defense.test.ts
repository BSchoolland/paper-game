import { describe, expect, test } from "bun:test";
import { ShapeKind } from "../core/types.js";
import type { AttackAbility, GameState } from "../core/types.js";
import { resolveAction } from "../combat/turn-resolver.js";
import { consequenceApplies } from "../combat/defense.js";
import { makeEntity, makeState } from "./test-helpers.js";

/**
 * The defense CONTRACT: these tests pin the policy table (combat/defense.ts) and the
 * per-target independence invariant the client's frame-perfect outcome prediction relies on.
 * If a change here is intentional, update the policy — but know that prediction, balance,
 * and the block tutorialization all key off these exact behaviors.
 */
const VENOM_SLAM: AttackAbility = {
  id: "venom-slam",
  name: "Venom Slam",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 },
  damage: 20,
  knockback: 30,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.5 }],
};

function attackState(): GameState {
  const attacker = makeEntity("atk", 100, 100, "blue", { abilities: [VENOM_SLAM] });
  const defender = makeEntity("def", 150, 100, "red");
  return makeState([attacker, defender], { activeTeam: "blue" });
}

function swing(state: GameState, defenseMap?: ReadonlyMap<string, number>) {
  return resolveAction(
    state,
    { type: "ability", entityId: "atk", abilityId: "venom-slam", aimDirection: { x: 1, y: 0 } },
    defenseMap ? { defenseMap: new Map(defenseMap) } : undefined,
  );
}

describe("defense policy", () => {
  test("unblocked: full damage, knockback, and status all land", () => {
    const result = swing(attackState());
    expect(result.state.entities.get("def")!.hp).toBe(80);
    expect(result.events.some((e) => e.type === "knockback" && e.entityId === "def")).toBe(true);
    expect(result.events.some((e) => e.type === "statusApplied" && e.entityId === "def")).toBe(true);
  });

  test("guard: half damage, no displacement, but the status seeps through", () => {
    const result = swing(attackState(), new Map([["def", 0.5]]));
    expect(result.state.entities.get("def")!.hp).toBe(90);
    expect(result.events.some((e) => e.type === "knockback" && e.entityId === "def")).toBe(false);
    expect(result.state.entities.get("def")!.position).toEqual({ x: 150, y: 100 });
    expect(result.events.some((e) => e.type === "statusApplied" && e.entityId === "def")).toBe(true);
  });

  test("parry: nothing lands — no damage, no displacement, no status", () => {
    const result = swing(attackState(), new Map([["def", 0]]));
    expect(result.state.entities.get("def")!.hp).toBe(100);
    expect(result.events.some((e) => e.type === "knockback" && e.entityId === "def")).toBe(false);
    expect(result.events.some((e) => e.type === "statusApplied" && e.entityId === "def")).toBe(false);
    expect(result.state.entities.get("def")!.statusEffects ?? []).toHaveLength(0);
  });

  test("INDEPENDENCE INVARIANT: a target's outcome depends only on its own defense entry", () => {
    // The client predicts its own hero's outcome by dry-running the resolver with ONLY its
    // own multiplier in the map. Another defender's entry must never change my result.
    const attacker = makeEntity("atk", 100, 100, "blue", { abilities: [VENOM_SLAM] });
    const d1 = makeEntity("d1", 150, 80, "red");
    const d2 = makeEntity("d2", 150, 120, "red");
    const state = makeState([attacker, d1, d2], { activeTeam: "blue" });
    const act = (map: ReadonlyMap<string, number>) =>
      resolveAction(state, { type: "ability", entityId: "atk", abilityId: "venom-slam", aimDirection: { x: 1, y: 0 } }, { defenseMap: new Map(map) });

    const d1Only = act(new Map([["d1", 0]]));
    const both = act(new Map([["d1", 0], ["d2", 0.5]]));
    // d1's outcome is identical whether or not d2's entry exists…
    expect(d1Only.state.entities.get("d1")!.hp).toBe(both.state.entities.get("d1")!.hp);
    expect(d1Only.state.entities.get("d1")!.hp).toBe(100);
    // …and d2 unlisted resolves as undefended (full damage), listed at 0.5 takes half.
    expect(d1Only.state.entities.get("d2")!.hp).toBe(80);
    expect(both.state.entities.get("d2")!.hp).toBe(90);
  });

  test("policy table answers per consequence", () => {
    expect(consequenceApplies("knockback", 1)).toBe(true);
    expect(consequenceApplies("knockback", 0.5)).toBe(false);
    expect(consequenceApplies("knockback", 0)).toBe(false);
    expect(consequenceApplies("slowed", 0.5)).toBe(true);
    expect(consequenceApplies("slowed", 0)).toBe(false);
    expect(consequenceApplies("pull", 0.5)).toBe(false);
  });
});
