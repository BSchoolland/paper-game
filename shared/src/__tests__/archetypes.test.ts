import { describe, it, expect } from "bun:test";
import {
  ARCHETYPES,
  archetypeById,
  pickArchetype,
  fillArchetype,
  type ArchetypeId,
  type EncounterArchetype,
} from "../encounter/archetypes.js";
import { getEncounterProfile, type EncounterType } from "../encounter/encounter-profiles.js";
import { HEX_ICON_TYPES } from "../map/hex-map.js";
import { Rng } from "../core/rng.js";
import type { EnemyTag, UnitTemplate } from "../core/types.js";

const ALL_TYPES: readonly EncounterType[] = [...HEX_ICON_TYPES, "wilderness", "dense-wilderness"];

function mk(className: string, cost: number, tags: readonly EnemyTag[]): UnitTemplate {
  return {
    abilities: [],
    hp: 10,
    energy: { red: 0, blue: 0 },
    collisionRadius: 1,
    className,
    cost,
    tags,
  };
}

/** A pool covering all six ENEMY_TAGS (the generator's authored guarantee). */
function dim0Pool(): UnitTemplate[] {
  return [
    mk("gnat", 1, ["swarm", "melee"]),
    mk("brute", 3, ["melee", "tank"]),
    mk("archer", 3, ["ranged"]),
    mk("captain", 8, ["elite"]),
    mk("wall", 5, ["tank"]),
    mk("dragon", 12, ["boss"]),
  ];
}

/** Deterministic scripted rng: cycles the supplied [0,1) draws. */
function scriptRng(seq: readonly number[]): Rng {
  let i = 0;
  return { next: () => seq[i++ % seq.length]!, symmetric: () => 0 } as unknown as Rng;
}

describe("catalog sanity", () => {
  it("every ArchetypeId resolves via archetypeById", () => {
    for (const a of ARCHETYPES) {
      expect(archetypeById(a.id).id).toBe(a.id);
    }
  });
  it("archetypeById throws on an unknown id", () => {
    expect(() => archetypeById("nonsense" as ArchetypeId)).toThrow();
  });
  it("every profile's archetypeWeights keys resolve", () => {
    for (const type of ALL_TYPES) {
      const weights = getEncounterProfile(type).archetypeWeights;
      for (const key of Object.keys(weights) as ArchetypeId[]) {
        expect(() => archetypeById(key)).not.toThrow();
      }
    }
  });
  it("each archetype's budgetShares sum to ~1", () => {
    for (const a of ARCHETYPES) {
      const sum = a.slots.reduce((s, slot) => s + slot.budgetShare, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });
});

describe("pickArchetype", () => {
  it("is deterministic under a scripted rng and respects weight order", () => {
    // wilderness = { horde 3, ambush 2, warband 1 }; entries keep ARCHETYPES order:
    // horde(3), warband(1), ambush(2); total 6. roll 0 → horde.
    const weights = getEncounterProfile("wilderness").archetypeWeights;
    expect(pickArchetype(weights, scriptRng([0])).id).toBe("horde");
  });
  it("a single-weight profile always resolves to that archetype (boss → guardian)", () => {
    const weights = getEncounterProfile("boss").archetypeWeights;
    for (const draw of [0, 0.3, 0.5, 0.99]) {
      expect(pickArchetype(weights, scriptRng([draw])).id).toBe("guardian");
    }
  });
  it("throws on an empty weight table", () => {
    expect(() => pickArchetype({}, scriptRng([0.5]))).toThrow();
  });
});

describe("fillArchetype determinism", () => {
  it("same pool + budget + fresh Rng.perRun(7,3,-2) twice → identical sequence", () => {
    const guardian = archetypeById("guardian");
    const a = fillArchetype(dim0Pool(), guardian, 30, 12, Rng.perRun(7, 3, -2));
    const b = fillArchetype(dim0Pool(), guardian, 30, 12, Rng.perRun(7, 3, -2));
    expect(a.map((t) => t.className)).toEqual(b.map((t) => t.className));
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("tag matching (preference ladder, flag #5)", () => {
  it("warband puts an elite-tagged unit in the leader slot", () => {
    const enemies = fillArchetype(dim0Pool(), archetypeById("warband"), 30, 12, Rng.perRun(1, 0, 0));
    expect(enemies[0]!.tags).toContain("elite");
  });
  it("guardian anchor is boss/elite-tagged", () => {
    const enemies = fillArchetype(dim0Pool(), archetypeById("guardian"), 30, 12, Rng.perRun(2, 0, 0));
    const anchorTags = enemies[0]!.tags ?? [];
    expect(anchorTags.some((t) => t === "boss" || t === "elite")).toBe(true);
  });
  it("a slot with no matching tags falls back to the whole pool", () => {
    // Pool has NO ranged units; a slot requiring "ranged" must still field melee from the pool
    // (fallback, not the floor — the floor would yield exactly one unit).
    const meleeOnly = [mk("a", 3, ["melee"]), mk("b", 3, ["melee"])];
    const rangedSlot: EncounterArchetype = {
      id: "ambush",
      name: "x",
      flavor: "x",
      slots: [{ role: "shooters", tags: ["ranged"], budgetShare: 1, minCount: 1, maxCount: 3, bias: "mid" }],
      overflow: [],
    };
    const enemies = fillArchetype(meleeOnly, rangedSlot, 20, 5, Rng.perRun(3, 0, 0));
    expect(enemies.length).toBeGreaterThan(1); // >1 proves fallback, not the single-unit floor
    expect(enemies.every((t) => (t.tags ?? []).includes("melee"))).toBe(true);
  });
});

describe("budget discipline", () => {
  it("total picked cost never exceeds the budget (no floor case)", () => {
    const budget = 50;
    const enemies = fillArchetype(dim0Pool(), archetypeById("guardian"), budget, 12, Rng.perRun(9, 1, 1));
    const cost = enemies.reduce((s, t) => s + (t.cost ?? 1), 0);
    expect(cost).toBeLessThanOrEqual(budget);
  });
  it("overflow spends leftover budget (guardian at 50 fields more than its slot maxima)", () => {
    // Cheap minions/overflow → the fill pushes past anchor(1)+minions(5) via overflow.
    const cheap = [mk("boss", 12, ["boss"]), mk("mote", 1, ["swarm", "melee"])];
    const enemies = fillArchetype(cheap, archetypeById("guardian"), 50, 12, Rng.perRun(11, 2, 2));
    expect(enemies.length).toBeGreaterThan(6);
  });
  it("maxEnemies caps a horde at 12 even with a huge budget", () => {
    const cheap = [mk("mote", 1, ["swarm", "melee"])];
    const enemies = fillArchetype(cheap, archetypeById("horde"), 1000, 12, Rng.perRun(12, 3, 3));
    expect(enemies.length).toBe(12);
  });
});

describe("floor and empty pool (flag #5)", () => {
  it("a pool of one unaffordable unit still fields exactly that one unit", () => {
    const enemies = fillArchetype([mk("colossus", 99, ["melee"])], archetypeById("horde"), 6, 12, Rng.perRun(4, 0, 0));
    expect(enemies).toHaveLength(1);
    expect(enemies[0]!.className).toBe("colossus");
  });
  it("an empty pool yields []", () => {
    expect(fillArchetype([], archetypeById("guardian"), 30, 12, Rng.perRun(5, 0, 0))).toEqual([]);
  });
});

describe("cost bias", () => {
  function soloSlot(bias: "heavy" | "mid" | "light"): EncounterArchetype {
    return {
      id: "guardian",
      name: "x",
      flavor: "x",
      slots: [{ role: "s", tags: [], budgetShare: 1, minCount: 1, maxCount: 1, bias }],
      overflow: [],
    };
  }
  const pool = [mk("light-unit", 2, ["melee"]), mk("heavy-unit", 14, ["melee"])];

  it("heavy bias favors the expensive unit (weight ∝ cost²)", () => {
    // weights [4, 196], total 200; roll 0.5×200 = 100 → falls in the heavy-unit bucket.
    const picked = fillArchetype(pool, soloSlot("heavy"), 100, 1, scriptRng([0.5]));
    expect(picked[0]!.className).toBe("heavy-unit");
  });
  it("light bias favors the cheap unit (weight ∝ 1/cost)", () => {
    // weights [0.5, ~0.071], total ~0.571; roll 0.5×0.571 = 0.286 → falls in the light-unit bucket.
    const picked = fillArchetype(pool, soloSlot("light"), 100, 1, scriptRng([0.5]));
    expect(picked[0]!.className).toBe("light-unit");
  });
});
