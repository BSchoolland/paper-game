import { describe, it, expect } from "vitest";
import { pointInSector, entitiesInSector } from "../geometry.js";
import { resolveSwordAttack } from "../combat.js";
import type { Entity } from "../types.js";

function makeEntity(id: string, x: number, y: number, team: "red" | "blue"): Entity {
  return {
    id,
    position: { x, y },
    collisionRadius: 16,
    hp: 100,
    maxHp: 100,
    team,
    movementBudget: 150,
    movementRemaining: 150,
    actionsRemaining: 1,
    canMoveAfterAttack: false,
    hasAttackedThisTurn: false,
  };
}

describe("pointInSector", () => {
  it("point directly in front", () => {
    expect(pointInSector({ x: 30, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 60, Math.PI / 4)).toBe(true);
  });

  it("point behind attacker", () => {
    expect(pointInSector({ x: -30, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 60, Math.PI / 4)).toBe(false);
  });

  it("point out of range", () => {
    expect(pointInSector({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 60, Math.PI / 4)).toBe(false);
  });

  it("point at edge of angle", () => {
    const x = 30 * Math.cos(Math.PI / 4 - 0.01);
    const y = 30 * Math.sin(Math.PI / 4 - 0.01);
    expect(pointInSector({ x, y }, { x: 0, y: 0 }, { x: 1, y: 0 }, 60, Math.PI / 4)).toBe(true);
  });
});

describe("resolveSwordAttack", () => {
  it("hits enemy in arc", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", 40, 0, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    const hits = resolveSwordAttack(attacker, { x: 1, y: 0 }, entities);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe("b");
  });

  it("misses enemy behind attacker", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", -40, 0, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    const hits = resolveSwordAttack(attacker, { x: 1, y: 0 }, entities);
    expect(hits).toHaveLength(0);
  });

  it("does not hit friendly", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const friendly = makeEntity("b", 40, 0, "red");
    const entities = new Map([["a", attacker], ["b", friendly]]);
    const hits = resolveSwordAttack(attacker, { x: 1, y: 0 }, entities);
    expect(hits).toHaveLength(0);
  });
});
