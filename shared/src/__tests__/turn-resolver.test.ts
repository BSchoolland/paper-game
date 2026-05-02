import { describe, it, expect } from "vitest";
import { resolveAction } from "../turn-resolver.js";
import { makeEntity, makeState } from "./test-helpers.js";

describe("turn-resolver", () => {
  it("move updates position", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const next = resolveAction(state, { type: "move", entityId: "r1", destination: { x: 150, y: 100 } });
    expect(next.entities.get("r1")!.position.x).toBeCloseTo(150);
  });

  it("move deducts movement", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const next = resolveAction(state, { type: "move", entityId: "r1", destination: { x: 150, y: 100 } });
    expect(next.entities.get("r1")!.movementRemaining).toBeCloseTo(100);
  });

  it("rejects move beyond remaining movement", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const next = resolveAction(state, { type: "move", entityId: "r1", destination: { x: 400, y: 100 } });
    expect(next).toBe(state);
  });

  it("rejects wrong team action", () => {
    const state = makeState([makeEntity("b1", 100, 100, "blue")]);
    const next = resolveAction(state, { type: "move", entityId: "b1", destination: { x: 150, y: 100 } });
    expect(next).toBe(state);
  });

  it("attack damages enemy in range", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const next = resolveAction(state, { type: "attack", entityId: "r1", aimDirection: { x: 1, y: 0 } });
    expect(next.entities.get("b1")!.hp).toBe(75);
  });

  it("attack removes dead entity", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue", { hp: 20 }),
    ]);
    const next = resolveAction(state, { type: "attack", entityId: "r1", aimDirection: { x: 1, y: 0 } });
    expect(next.entities.has("b1")).toBe(false);
  });

  it("end turn switches team and resets resources", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue"),
    ]);
    const moved = resolveAction(state, { type: "move", entityId: "r1", destination: { x: 150, y: 100 } });
    const next = resolveAction(moved, { type: "endTurn" });
    expect(next.activeTeam).toBe("blue");
    expect(next.entities.get("b1")!.movementRemaining).toBe(150);
    expect(next.entities.get("b1")!.actionsRemaining).toBe(1);
    expect(next.turnNumber).toBe(2);
  });

  it("detects winner when team eliminated", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue", { hp: 20 }),
    ]);
    const next = resolveAction(state, { type: "attack", entityId: "r1", aimDirection: { x: 1, y: 0 } });
    expect(next.winner).toBe("red");
  });

  it("canMoveAfterAttack=true allows movement after attacking", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const attacked = resolveAction(state, { type: "attack", entityId: "r1", aimDirection: { x: 1, y: 0 } });
    const moved = resolveAction(attacked, { type: "move", entityId: "r1", destination: { x: 80, y: 100 } });
    expect(moved.entities.get("r1")!.position.x).toBeCloseTo(80);
  });

  it("canMoveAfterAttack=false prevents movement after attacking", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { canMoveAfterAttack: false }),
      makeEntity("b1", 500, 100, "blue"),
    ]);
    const attacked = resolveAction(state, { type: "attack", entityId: "r1", aimDirection: { x: 1, y: 0 } });
    const moved = resolveAction(attacked, { type: "move", entityId: "r1", destination: { x: 120, y: 100 } });
    expect(moved).toBe(attacked);
  });

  it("rejects move that overlaps another entity", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("r2", 130, 100, "red"),
    ]);
    const next = resolveAction(state, { type: "move", entityId: "r1", destination: { x: 125, y: 100 } });
    expect(next).toBe(state);
  });
});
