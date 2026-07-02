import { describe, it, expect } from "bun:test";
import { generateEncounter } from "../encounter/encounter.js";
import { getEncounterProfile, type EncounterType } from "../encounter/encounter-profiles.js";
import {
  BASELINE_SCALING,
  effectiveEnemyBudget,
  type EncounterScaling,
} from "../encounter/difficulty.js";
import type { ArchetypeId } from "../encounter/archetypes.js";
import type { Dimension } from "../encounter/dimension.js";
import { HEX_ICON_TYPES } from "../map/hex-map.js";
import type { EnemyTag, UnitTemplate } from "../core/types.js";

const ALL_TYPES: readonly EncounterType[] = [...HEX_ICON_TYPES, "wilderness", "dense-wilderness"];

function mk(className: string, cost: number, tags: readonly EnemyTag[]): UnitTemplate {
  return { abilities: [], hp: 10, energy: { red: 0, blue: 0 }, collisionRadius: 1, className, cost, tags };
}

function mkDim(): Dimension {
  return {
    id: "test-dim",
    name: "Test",
    backgroundPath: null,
    hexDecorationsPath: null,
    status: "ready",
    enemies: [
      mk("gnat", 1, ["swarm", "melee"]),
      mk("brute", 3, ["melee", "tank"]),
      mk("archer", 3, ["ranged"]),
      mk("captain", 8, ["elite"]),
      mk("wall", 5, ["tank"]),
      mk("dragon", 12, ["boss"]),
    ],
    structures: [],
  };
}

describe("generateEncounter determinism", () => {
  it("same (runId, x, y) → identical enemies, archetype, and map", () => {
    const dim = mkDim();
    const a = generateEncounter("enemy-camp", dim, 3, -2, 42, BASELINE_SCALING);
    const b = generateEncounter("enemy-camp", dim, 3, -2, 42, BASELINE_SCALING);
    expect(a.enemies.map((e) => e.className)).toEqual(b.enemies.map((e) => e.className));
    expect(a.archetype).toBe(b.archetype);
    expect(a.map).toEqual(b.map);
    expect(a.effectiveBudget).toBe(b.effectiveBudget);
  });

  it("different runId keeps the map identical (Rng.seeded vs Rng.perRun separation)", () => {
    const dim = mkDim();
    const a = generateEncounter("enemy-camp", dim, 3, -2, 1, BASELINE_SCALING);
    const b = generateEncounter("enemy-camp", dim, 3, -2, 2, BASELINE_SCALING);
    expect(a.map).toEqual(b.map);
  });
});

describe("generateEncounter archetype + budget reporting", () => {
  it("rolled archetype is always one of the profile's weighted archetypes", () => {
    const dim = mkDim();
    for (const type of ALL_TYPES) {
      const keys = Object.keys(getEncounterProfile(type).archetypeWeights) as ArchetypeId[];
      const enc = generateEncounter(type, dim, 1, 1, 7, BASELINE_SCALING);
      expect(keys).toContain(enc.archetype);
    }
  });

  it("effectiveBudget equals effectiveEnemyBudget(profile.enemyBudget, scaling)", () => {
    const dim = mkDim();
    const scaling: EncounterScaling = { dimensionTier: 2, distanceFromOrigin: 8, partySize: 4 };
    for (const type of ALL_TYPES) {
      const base = getEncounterProfile(type).enemyBudget;
      const enc = generateEncounter(type, dim, 1, 1, 7, scaling);
      expect(enc.effectiveBudget).toBe(effectiveEnemyBudget(base, scaling));
    }
  });
});

describe("generateEncounter scaled composition", () => {
  it("total enemy cost stays within the effective budget and count ≤ 12", () => {
    const dim = mkDim();
    const scaling: EncounterScaling = { dimensionTier: 2, distanceFromOrigin: 8, partySize: 4 };
    const enc = generateEncounter("enemy-camp", dim, 5, 9, 13, scaling);
    const cost = enc.enemies.reduce((s, e) => s + (e.cost ?? 1), 0);
    expect(cost).toBeLessThanOrEqual(enc.effectiveBudget);
    expect(enc.enemies.length).toBeLessThanOrEqual(12);
    expect(enc.enemies.length).toBeGreaterThan(0);
  });
});
