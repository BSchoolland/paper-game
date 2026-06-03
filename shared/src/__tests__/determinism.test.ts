import { describe, it, expect } from "bun:test";
import { serializeGameState, deserializeGameState } from "../core/serialization.js";
import { resolveAction } from "../combat/turn-resolver.js";
import { makeEntity, makeState } from "./test-helpers.js";

// Phase 1 guard rail (DESIGN.md R2/R1): `controllerId` must survive the wire round-trip
// for free (entities are serialized whole, no serialization.ts edit), and the pure resolver
// must stay deterministic — both are load-bearing for networked play.
describe("controllerId + determinism", () => {
  it("controllerId round-trips through serialize/deserialize; enemies stay undefined", () => {
    const hero = makeEntity("s0-hero", 50, 50, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 80, 50, "blue");
    const state = makeState([hero, enemy]);

    const round = deserializeGameState(serializeGameState(state));
    expect(round.entities.get("s0-hero")?.controllerId).toBe("s0");
    expect(round.entities.get("e0")?.controllerId).toBeUndefined();
  });

  it("serialize is a fixed point (serialize ∘ deserialize ∘ serialize === serialize)", () => {
    const hero = makeEntity("s0-hero", 50, 50, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 80, 50, "blue");
    const state = makeState([hero, enemy]);

    const once = serializeGameState(state);
    const twice = serializeGameState(deserializeGameState(once));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("resolveAction is deterministic and preserves controllerId", () => {
    const hero = makeEntity("s0-hero", 50, 50, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 80, 50, "blue");
    const state = makeState([hero, enemy]);

    const a = resolveAction(state, { type: "endTurn" });
    const b = resolveAction(state, { type: "endTurn" });
    expect(JSON.stringify(serializeGameState(a.state))).toBe(JSON.stringify(serializeGameState(b.state)));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.state.entities.get("s0-hero")?.controllerId).toBe("s0");
  });
});
