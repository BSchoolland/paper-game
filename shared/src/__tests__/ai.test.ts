import { describe, expect, test } from "bun:test";
import { AiController } from "../ai/ai-runner.js";
import { resolveAction } from "../combat/turn-resolver.js";
import type { PlayerAction } from "../core/types.js";
import { makeEntity, makeState } from "./test-helpers.js";

function plan(controller: AiController, state: ReturnType<typeof makeState>): PlayerAction[] {
  // Strip the trailing endTurn the controller always appends.
  const actions = controller.computeActions(state, "red");
  return actions.slice(0, -1);
}

function abilityIds(actions: PlayerAction[]): string[] {
  return actions.map(a => (a.type === "ability" ? a.abilityId : a.type));
}

describe("rush AI", () => {
  test("attacks in place when a shot already connects, without moving", () => {
    const state = makeState([
      makeEntity("hero", 150, 100, "blue"),
      makeEntity("foe", 100, 100, "red", { strategy: "rush" }),
    ]);
    const actions = plan(new AiController(), state);
    expect(abilityIds(actions)).toEqual(["short-sword-slash"]);
  });

  test("closes the distance and then attacks when the target is reachable", () => {
    const state = makeState([
      makeEntity("hero", 300, 100, "blue"),
      makeEntity("foe", 100, 100, "red", { strategy: "rush" }),
    ]);
    const actions = plan(new AiController(), state);
    expect(abilityIds(actions)).toEqual(["move", "short-sword-slash"]);
  });
});

describe("AI respects slowed", () => {
  test("a slowed enemy does not plan an attack from a spot it cannot reach", () => {
    const baseFoe = () => makeEntity("foe", 100, 100, "red", { strategy: "rush" });

    // Control: at full move range it reaches the hero and attacks.
    const control = plan(new AiController(), makeState([
      makeEntity("hero", 300, 100, "blue"),
      baseFoe(),
    ]));
    expect(abilityIds(control)).toEqual(["move", "short-sword-slash"]);

    // Slowed 50%: it can only move half as far, so no follow-up attack should be planned —
    // and crucially it must not emit an out-of-range swing.
    const slowed = plan(new AiController(), makeState([
      makeEntity("hero", 300, 100, "blue"),
      makeEntity("foe", 100, 100, "red", {
        strategy: "rush",
        statusEffects: [{ type: "slowed", duration: 2, value: 0.5 }],
      }),
    ]));
    expect(abilityIds(slowed)).toEqual(["move"]);
  });
});

describe("AI never emits an action the resolver would reject", () => {
  test("every planned action changes state when replayed in order", () => {
    const state = makeState([
      makeEntity("hero", 280, 130, "blue"),
      makeEntity("foe", 100, 100, "red", { strategy: "rush" }),
      makeEntity("ally", 120, 400, "red", { strategy: "kite" }),
    ]);
    let working = state;
    for (const action of new AiController().computeActions(state, "red")) {
      const next = resolveAction(working, action);
      expect(next.state).not.toBe(working);
      working = next.state;
    }
  });
});
