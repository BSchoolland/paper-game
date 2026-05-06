import { describe, it, expect } from "vitest";
import { pointInSector } from "../geometry/sector.js";
import { entityInRectangle } from "../geometry/rectangle.js";
import { resolveWeaponAttack } from "../combat/combat.js";
import { SHORT_SWORD, SPEAR, BOW } from "../core/types.js";
import { createGrid } from "../map/collision-grid.js";
import { makeEntity } from "./test-helpers.js";

const emptyGrid = createGrid(100, 100, 8);

describe("pointInSector", () => {
  it("point directly in front", () => {
    expect(
      pointInSector({ x: 30, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 80, Math.PI / 3)
    ).toBe(true);
  });

  it("point behind attacker", () => {
    expect(
      pointInSector({ x: -30, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 80, Math.PI / 3)
    ).toBe(false);
  });

  it("point out of range", () => {
    expect(
      pointInSector({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 80, Math.PI / 3)
    ).toBe(false);
  });
});

describe("sword attack", () => {
  it("hits enemy in arc", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", 40, 0, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, SHORT_SWORD, emptyGrid)).toHaveLength(1);
  });

  it("misses enemy behind attacker", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", -40, 0, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, SHORT_SWORD, emptyGrid)).toHaveLength(0);
  });

  it("does not hit friendly", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const friendly = makeEntity("b", 40, 0, "red");
    const entities = new Map([["a", attacker], ["b", friendly]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, SHORT_SWORD, emptyGrid)).toHaveLength(0);
  });
});

describe("spear attack (rectangle)", () => {
  it("hits enemy in line", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", 80, 0, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, SPEAR, emptyGrid)).toHaveLength(1);
  });

  it("misses enemy to the side", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", 80, 60, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, SPEAR, emptyGrid)).toHaveLength(0);
  });

  it("hits multiple enemies in a line", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const t1 = makeEntity("b", 40, 0, "blue");
    const t2 = makeEntity("c", 90, 0, "blue");
    const entities = new Map([["a", attacker], ["b", t1], ["c", t2]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, SPEAR, emptyGrid)).toHaveLength(2);
  });

  it("accounts for collision radius", () => {
    const entity = makeEntity("b", 80, 25, "blue");
    expect(entityInRectangle(entity, { x: 0, y: 0 }, { x: 1, y: 0 }, 110, 20)).toBe(true);
  });
});

describe("bow attack (point/ray)", () => {
  it("hits closest enemy in line of fire", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", 200, 0, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, BOW, emptyGrid)).toHaveLength(1);
  });

  it("misses enemy out of range", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", 400, 0, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, BOW, emptyGrid)).toHaveLength(0);
  });

  it("misses enemy off to the side", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const target = makeEntity("b", 200, 50, "blue");
    const entities = new Map([["a", attacker], ["b", target]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, BOW, emptyGrid)).toHaveLength(0);
  });

  it("does not hit friendly", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const friendly = makeEntity("b", 100, 0, "red");
    const entities = new Map([["a", attacker], ["b", friendly]]);
    expect(resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, BOW, emptyGrid)).toHaveLength(0);
  });

  it("only hits first enemy, not one behind", () => {
    const attacker = makeEntity("a", 0, 0, "red");
    const t1 = makeEntity("b", 100, 0, "blue");
    const t2 = makeEntity("c", 200, 0, "blue");
    const entities = new Map([["a", attacker], ["b", t1], ["c", t2]]);
    const hits = resolveWeaponAttack(attacker, { x: 1, y: 0 }, entities, BOW, emptyGrid);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe("b");
  });
});
