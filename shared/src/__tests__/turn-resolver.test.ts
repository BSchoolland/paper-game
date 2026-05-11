import { describe, it, expect } from "vitest";
import { resolveAction } from "../combat/turn-resolver.js";
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

  it("rejects wrong team action", () => {
    const state = makeState([makeEntity("b1", 100, 100, "blue")]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "b1", abilityId: "move", destination: { x: 150, y: 100 } });
    expect(next).toBe(state);
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

  it("end turn switches team and resets energy", () => {
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue"),
    ]);
    const { state: moved } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "move", destination: { x: 150, y: 100 } });
    const { state: next } = resolveAction(moved, { type: "endTurn" });
    expect(next.activeTeam).toBe("blue");
    expect(next.entities.get("b1")!.energy.red).toBe(2);
    expect(next.entities.get("b1")!.energy.blue).toBe(2);
    expect(next.turnNumber).toBe(2);
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
      makeEntity("r1", 100, 100, "red", { energy: { red: 0, blue: 0, maxRed: 2, maxBlue: 2 } }),
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

  it("weak attacker deals reduced damage", () => {
    const weakStatus: StatusEffect = { type: "weak", duration: 1, value: 0.5 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { statusEffects: [weakStatus] }),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    expect(next.entities.get("b1")!.hp).toBe(87);
  });

  it("vulnerable target takes increased damage", () => {
    const vulnStatus: StatusEffect = { type: "vulnerable", duration: 1, value: 0.5 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 140, 100, "blue", { statusEffects: [vulnStatus] }),
    ]);
    const { state: next } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "short-sword-slash", aimDirection: { x: 1, y: 0 } });
    expect(next.entities.get("b1")!.hp).toBe(62);
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

  it("DoT ticks damage on turn start and decrements duration", () => {
    const burn: StatusEffect = { type: "burning", duration: 2, value: 10 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue", { statusEffects: [burn] }),
    ]);
    const { state: next, events } = resolveAction(state, { type: "endTurn" });
    expect(next.entities.get("b1")!.hp).toBe(90);
    expect(events.some(e => e.type === "dotTick")).toBe(true);
    const remaining = next.entities.get("b1")!.statusEffects;
    expect(remaining).toHaveLength(1);
    expect(remaining![0]!.duration).toBe(1);
  });

  it("DoT can kill an entity", () => {
    const poison: StatusEffect = { type: "poisoned", duration: 3, value: 15 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue", { hp: 10, statusEffects: [poison] }),
    ]);
    const { state: next } = resolveAction(state, { type: "endTurn" });
    expect(next.entities.get("b1")!.dead).toBe(true);
    expect(next.winner).toBe("red");
  });

  it("status effects expire after duration runs out", () => {
    const weak: StatusEffect = { type: "weak", duration: 1, value: 0.5 };
    const state = makeState([
      makeEntity("r1", 100, 100, "red"),
      makeEntity("b1", 500, 100, "blue", { statusEffects: [weak] }),
    ]);
    const { state: next } = resolveAction(state, { type: "endTurn" });
    expect(next.entities.get("b1")!.statusEffects).toBeUndefined();
  });

  it("applyStatus on-hit applies status to target", () => {
    const poisonSlash: AttackAbility = {
      id: "poison-slash",
      name: "Poison Slash",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
      damage: 10,
      onHit: [{ type: "applyStatus", status: "poisoned", duration: 2, value: 5 }],
    };
    const state = makeState([
      makeEntity("r1", 100, 100, "red", { abilities: [poisonSlash] }),
      makeEntity("b1", 140, 100, "blue"),
    ]);
    const { state: next, events } = resolveAction(state, { type: "ability", entityId: "r1", abilityId: "poison-slash", aimDirection: { x: 1, y: 0 } });
    const b1 = next.entities.get("b1")!;
    expect(b1.statusEffects).toHaveLength(1);
    expect(b1.statusEffects![0]!.type).toBe("poisoned");
    expect(events.some(e => e.type === "statusApplied")).toBe(true);
  });

  it("pull on-hit moves target toward attacker", () => {
    const hookAbility: AttackAbility = {
      id: "hook",
      name: "Hook",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 120, halfAngle: Math.PI / 4 },
      damage: 5,
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
