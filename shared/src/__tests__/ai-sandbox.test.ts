import { describe, expect, test } from "bun:test";
import { AiController } from "../ai/ai-runner.js";
import { resolveAction } from "../combat/turn-resolver.js";
import { setBlocked } from "../map/collision-grid.js";
import type { GameEvent, GameState } from "../core/types.js";
import { makeEntity, makeState } from "./test-helpers.js";

/**
 * Pit two AI-controlled teams against each other and run the fight to a conclusion. Returns the
 * full event log plus the final state. Throughout, it enforces the invariants the AI is supposed
 * to uphold:
 *  - every action the controller emits actually changes state (no dead/no-op actions), and
 *  - every attack an AI entity makes connects with at least one target (no swinging at air, which
 *    is the tell-tale of an enemy "attacking as if it had moved" when it didn't).
 */
function simulateBattle(initial: GameState, maxTurns = 40): { events: GameEvent[]; final: GameState } {
  const ai = new AiController();
  let state = initial;
  const events: GameEvent[] = [];

  for (let turn = 0; turn < maxTurns && !state.winner; turn++) {
    const acting = state.activeTeam;
    const actingIds = new Set(
      [...state.entities.values()].filter(e => e.teamId === acting && !e.dead).map(e => e.id),
    );

    for (const action of ai.computeActions(state, acting)) {
      const result = resolveAction(state, action);
      expect(result.state, `controller emitted a no-op ${action.type} for team ${acting}`).not.toBe(state);
      state = result.state;
      for (const ev of result.events) {
        if (ev.type === "attack" && actingIds.has(ev.attackerId)) {
          expect(ev.hits.length, `AI ${ev.attackerId} attacked but hit nothing — confused planning?`).toBeGreaterThan(0);
        }
        events.push(ev);
      }
      if (state.winner) break;
    }
  }

  return { events, final: state };
}

describe("AI vs AI sandbox", () => {
  test("rush vs rush resolves cleanly", () => {
    const { final } = simulateBattle(makeState([
      makeEntity("red1", 120, 120, "red", { strategy: "rush" }),
      makeEntity("red2", 120, 360, "red", { strategy: "rush" }),
      makeEntity("blue1", 640, 120, "blue", { strategy: "rush" }),
      makeEntity("blue2", 640, 360, "blue", { strategy: "rush" }),
    ]));
    expect(final.winner === "red" || final.winner === "blue" || final.winner === null).toBe(true);
  });

  test("kite vs rush resolves cleanly", () => {
    simulateBattle(makeState([
      makeEntity("kiter", 120, 240, "red", { strategy: "kite" }),
      makeEntity("rusher", 640, 240, "blue", { strategy: "rush" }),
    ]));
  });

  test("slowed enemies never swing at air across a long fight", () => {
    simulateBattle(makeState([
      makeEntity("red1", 120, 120, "red", {
        strategy: "rush",
        statusEffects: [{ type: "slowed", duration: 99, value: 0.6 }],
      }),
      makeEntity("red2", 120, 400, "red", { strategy: "kite" }),
      makeEntity("blue1", 640, 120, "blue", {
        strategy: "rush",
        statusEffects: [{ type: "slowed", duration: 99, value: 0.6 }],
      }),
      makeEntity("blue2", 640, 400, "blue", { strategy: "rush" }),
    ]));
  });

  test("a wall between the teams does not confuse anyone", () => {
    let grid = makeState([]).grid;
    // Vertical wall down the middle (cells ~x=400), with a gap near the top.
    for (let cy = 12; cy < 88; cy++) grid = setBlocked(grid, 50, cy);
    const { final } = simulateBattle(makeState([
      makeEntity("red1", 120, 240, "red", { strategy: "rush" }),
      makeEntity("red2", 200, 500, "red", { strategy: "kite" }),
      makeEntity("blue1", 680, 240, "blue", { strategy: "rush" }),
      makeEntity("blue2", 600, 500, "blue", { strategy: "rush" }),
    ], { grid }));
    expect(final).toBeDefined();
  });
});
