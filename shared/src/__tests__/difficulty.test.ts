import { describe, it, expect } from "bun:test";
import {
  BASELINE_SCALING,
  effectiveTier,
  tierBudgetMult,
  distanceBudgetMult,
  partySizeBudgetMult,
  effectiveEnemyBudget,
  scaledXp,
  threatMultiplier,
  DISTANCE_BUDGET_MULT_CAP,
} from "../encounter/difficulty.js";
import { getEncounterProfile, type EncounterType } from "../encounter/encounter-profiles.js";
import { HEX_ICON_TYPES } from "../map/hex-map.js";

const ALL_TYPES: readonly EncounterType[] = [...HEX_ICON_TYPES, "wilderness", "dense-wilderness"];

describe("effectiveEnemyBudget baseline identity", () => {
  it("reproduces every profile's base budget under BASELINE_SCALING (no-rebalance proof)", () => {
    for (const type of ALL_TYPES) {
      const base = getEncounterProfile(type).enemyBudget;
      expect(effectiveEnemyBudget(base, BASELINE_SCALING)).toBe(base);
    }
  });
});

describe("effectiveTier", () => {
  it("null coerces to 0 (flag #4)", () => {
    expect(effectiveTier(null)).toBe(0);
    expect(effectiveTier(3)).toBe(3);
  });
});

describe("tierBudgetMult", () => {
  it("known values", () => {
    expect(tierBudgetMult(0)).toBeCloseTo(1.0);
    expect(tierBudgetMult(1)).toBeCloseTo(1.4);
    expect(tierBudgetMult(2)).toBeCloseTo(1.8);
  });
  it("null scales as tier 0", () => {
    expect(tierBudgetMult(null)).toBeCloseTo(1.0);
  });
});

describe("distanceBudgetMult", () => {
  it("grace radius: 0/1/2 → 1.0", () => {
    expect(distanceBudgetMult(0)).toBeCloseTo(1.0);
    expect(distanceBudgetMult(1)).toBeCloseTo(1.0);
    expect(distanceBudgetMult(2)).toBeCloseTo(1.0);
  });
  it("scales past grace", () => {
    expect(distanceBudgetMult(3)).toBeCloseTo(1.07);
    expect(distanceBudgetMult(5)).toBeCloseTo(1.21);
    expect(distanceBudgetMult(10)).toBeCloseTo(1.56);
  });
  it("caps at DISTANCE_BUDGET_MULT_CAP", () => {
    expect(distanceBudgetMult(100000)).toBeCloseTo(DISTANCE_BUDGET_MULT_CAP);
  });
});

describe("partySizeBudgetMult", () => {
  it("table values", () => {
    expect(partySizeBudgetMult(2)).toBeCloseTo(1.0);
    expect(partySizeBudgetMult(3)).toBeCloseTo(1.2);
    expect(partySizeBudgetMult(4)).toBeCloseTo(1.4);
  });
  it("throws on unknown party sizes (fail loud)", () => {
    expect(() => partySizeBudgetMult(1)).toThrow();
    expect(() => partySizeBudgetMult(5)).toThrow();
  });
});

describe("effectiveEnemyBudget combined math (§2.1 worked examples)", () => {
  it("tier 1 near origin: wilderness 6 → 8, enemy-camp 18 → 25", () => {
    const s = { dimensionTier: 1, distanceFromOrigin: 0, partySize: 2 };
    expect(effectiveEnemyBudget(6, s)).toBe(8);   // round(6 × 1.4) = round(8.4)
    expect(effectiveEnemyBudget(18, s)).toBe(25);  // round(18 × 1.4) = round(25.2)
  });
  it("tier 2 at distance 8: enemy-camp 18 → 46", () => {
    const s = { dimensionTier: 2, distanceFromOrigin: 8, partySize: 2 };
    expect(effectiveEnemyBudget(18, s)).toBe(46);  // round(18 × 1.8 × 1.42)
  });
  it("party 4 multiplies by 1.4", () => {
    const s = { dimensionTier: 0, distanceFromOrigin: 0, partySize: 4 };
    expect(effectiveEnemyBudget(10, s)).toBe(14);  // round(10 × 1.4)
  });
});

describe("scaledXp (tier × distance only — party never scales reward)", () => {
  it("baseline identity: 25 stays 25", () => {
    expect(scaledXp(25, 0, 0)).toBe(25);
    expect(scaledXp(25, null, 0)).toBe(25);
    expect(scaledXp(25, 0, 2)).toBe(25); // within grace radius
  });
  it("tier 1 distance 5 → 42", () => {
    expect(scaledXp(25, 1, 5)).toBe(42); // round(25 × 1.4 × 1.21)
  });
  it("has no party-size parameter (signature is base, tier, distance)", () => {
    expect(scaledXp.length).toBe(3);
  });
});

describe("threatMultiplier", () => {
  it("spot values", () => {
    expect(threatMultiplier(0, 0)).toBeCloseTo(1.0);
    expect(threatMultiplier(1, 5)).toBeCloseTo(1.694); // 1.4 × 1.21
    expect(threatMultiplier(null, 0)).toBeCloseTo(1.0);
  });
});
