import { describe, it, expect } from "vitest";
import { resolveAction, isActionLegal } from "../combat/turn-resolver.js";
import { makeEntity, makeState } from "./test-helpers.js";
import type { AttackAbility, StatusEffect } from "../core/types.js";
import { ShapeKind } from "../core/types.js";

describe("turn-resolver", () => {
  it("move updates position", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 150, y: 100 } });
    expect(next.entities.get("r1")!.position.x).toBeCloseTo(150);
  });

  it("move deducts blue energy", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 150, y: 100 } });
    expect(next.entities.get("r1")!.energy.blue).toBe(1);
  });

  it("rejects move beyond ability distance", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 400, y: 100 } });
    expect(next).toBe(state);
  });

  it("flags a wrong-team action as illegal", () => {
    const state = makeState([makeEntity("b1", 100, 100, "blue")]);
    expect(isActionLegal(state, { type: "ability", entityId: "b1", abilityId: "move", destination: { x: 150, y: 100 } })).toBe(false);
  });

  it("attack damages enemy in range", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    expect(next.entities.get("b1")!.hp).toBe(75);
  });

  it("attack flags dead entity", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue", { hp: 20 }),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    expect(next.entities.get("b1")!.dead).toBe(true);
  });

  it("end turn switches team and regenerates energy up to the cap", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue"),
    ]);
    const { state: moved } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 150, y: 100 } });
    const { state: next } = resolveAction(moved, { type: "endTurn" });
    expect(next.activeTeam).toBe("blue");
    expect(next.entities.get("b1")!.energy.red).toBe(4);
    expect(next.entities.get("b1")!.energy.blue).toBe(4);
    expect(next.turnNumber).toBe(2);
  });

  it("unspent energy banks across turns up to the cap", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { energy: { red: 1, blue: 1, regenRed: 2, regenBlue: 2, maxRed: 4, maxBlue: 4 } }),
      makeEntity("b1", 500, 100, "blue"),
    ]);
    // red ends turn -> blue's turn; blue ends turn -> red's turn-start regen fires
    const after1 = resolveAction(resolveAction(state, { type: "endTurn" }).state, { type: "endTurn" }).state;
    expect(after1.entities.get("r1")!.energy.red).toBe(3); // 1 + 2 regen
    expect(after1.entities.get("r1")!.energy.blue).toBe(3);
    const after2 = resolveAction(resolveAction(after1, { type: "endTurn" }).state, { type: "endTurn" }).state;
    expect(after2.entities.get("r1")!.energy.red).toBe(4); // 3 + 2 regen, clamped to 4
    expect(after2.entities.get("r1")!.energy.blue).toBe(4);
  });

  it("detects winner when team eliminated", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue", { hp: 20 }),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    expect(next.winner).toBe("red");
  });

  it("can move after attacking (energy permitting)", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const { state: attacked } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    const { state: moved } = resolveAction(attacked, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 80, y: 100 } });
    expect(moved.entities.get("r1")!.position.x).toBeCloseTo(80);
  });

  it("rejects action when out of energy", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { energy: { red: 0, blue: 0, regenRed: 2, regenBlue: 2, maxRed: 4, maxBlue: 4 } }),
      makeEntity("b1", 500, 100, "blue"),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 120, y: 100 } });
    expect(next).toBe(state);
  });

  it("rejects move that overlaps another entity", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("r2", 130, 100, "red"),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 125, y: 100 } });
    expect(next).toBe(state);
  });

  it("move emits move event with from/to", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const { events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 150, y: 100 } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "move", entityId: "r1", from: { x: 100, y: 100 }, to: { x: 150, y: 100 } });
  });

  it("attack emits attack event with hits", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const { events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    expect(events[0]).toMatchObject({ type: "attack", attackerId: "r1", hits: [{ targetId: "b1", damage: 25, killed: false }] });
    expect(events[1]).toMatchObject({ type: "knockback", entityId: "b1" });
  });

  it("attack event marks killed targets", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue", { hp: 20 }),
    ]);
    const { events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    expect(events[0]).toMatchObject({ type: "attack", hits: [{ targetId: "b1", killed: true }] });
  });

  it("rejected action emits no events", () => {
    const state = makeState([makeEntity("r1", 100, 100, "red")]);
    const { events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 400, y: 100 } });
    expect(events).toHaveLength(0);
  });

  it("slowed entity has reduced move range", () => {
    const slowStatus: StatusEffect = { type: "slowed", duration: 1, value: 0.5 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { statusEffects: [slowStatus] }),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 160, y: 100 } });
    expect(next.entities.get("r1")!.position.x).toBeCloseTo(160);

    const { state: rejected } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 170, y: 100 } });
    expect(rejected).toBe(state);
  });

  it("status effects expire after duration runs out", () => {
    const slow: StatusEffect = { type: "slowed", duration: 1, value: 0.5 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue", { statusEffects: [slow] }),
    ]);
    const { state: next } = resolveAction(state, { type: "endTurn" });
    expect(next.entities.get("b1")!.statusEffects).toBeUndefined();
  });

  it("applyStatus on-hit applies status to target", () => {
    const slowSlash: AttackAbility = {
      id: "slow-slash",
      name: "Slow Slash",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
      damage: 10,
      knockback: 0,
      onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.5 }],
    };
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { abilities: [slowSlash] }),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const { state: next, events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "slow-slash", aimDirection: { x: 1, y: 0 } });
    const b1 = next.entities.get("b1")!;
    expect(b1.statusEffects).toHaveLength(1);
    expect(b1.statusEffects![0]!.type).toBe("slowed");
    expect(events.some(e => e.type === "statusApplied")).toBe(true);
  });

  it("suppressed reduces attack-energy (red) regen on turn start", () => {
    const suppressed: StatusEffect = { type: "suppressed", duration: 2, value: 1 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue", { statusEffects: [suppressed] }),
    ]);
    const { state: next } = resolveAction(state, { type: "endTurn" });
    const b1 = next.entities.get("b1")!;
    // base regenRed is 2; suppressed value 1 → +1 instead of +2 (from 2 → 3)
    expect(b1.energy.red).toBe(3);
    expect(b1.energy.blue).toBe(4);
  });

  it("winded reduces movement-energy (blue) regen on turn start", () => {
    const winded: StatusEffect = { type: "winded", duration: 2, value: 1 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue", { statusEffects: [winded] }),
    ]);
    const { state: next } = resolveAction(state, { type: "endTurn" });
    const b1 = next.entities.get("b1")!;
    expect(b1.energy.blue).toBe(3);
    expect(b1.energy.red).toBe(4);
  });

  it("regen penalty never drops regen below zero", () => {
    const winded: StatusEffect = { type: "winded", duration: 2, value: 2 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue", {
        energy: { red: 2, blue: 2, regenRed: 2, regenBlue: 1, maxRed: 4, maxBlue: 4 },
        statusEffects: [winded],
      }),
    ]);
    const { state: next } = resolveAction(state, { type: "endTurn" });
    expect(next.entities.get("b1")!.energy.blue).toBe(2);
  });

  it("pull on-hit moves target toward attacker", () => {
    const hookAbility: AttackAbility = {
      id: "hook",
      name: "Hook",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 120, halfAngle: Math.PI / 4 },
      damage: 5,
      knockback: 0,
      onHit: [{ type: "pull", distance: 40 }],
    };
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { abilities: [hookAbility] }),
      makeEntity("b1", 200, 100, "blue"),
    ]);
    const { state: next, events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "hook", aimDirection: { x: 1, y: 0 } });
    const b1 = next.entities.get("b1")!;
    expect(b1.position.x).toBeLessThan(200);
    expect(b1.position.x).toBeGreaterThan(100);
    expect(events.some(e => e.type === "pull")).toBe(true);
  });
});
