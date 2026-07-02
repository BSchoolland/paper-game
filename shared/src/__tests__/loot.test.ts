import { describe, it, expect } from "bun:test";
import {
  LOOT_RICHNESS_BY_ICON,
  LOOT_EXCLUDED_ITEM_IDS,
  richnessForIcon,
  rollDrops,
  isManifestable,
  effectiveStartingTier,
} from "../core/loot.js";
import { HEX_ICON_TYPES } from "../map/hex-map.js";
import type { ItemDefinition, ItemRarity } from "../core/items.js";

function weapon(id: string, rarity: ItemRarity, dimensionId = 1): ItemDefinition {
  return {
    type: "weapon",
    id,
    name: id,
    description: "",
    rarity,
    sprite: `${id}.webp`,
    dimensionId,
    slotCost: { hand: 1 },
    abilities: [],
    animSet: "sword",
  };
}

function consumable(id: string, rarity: ItemRarity = "common", dimensionId = 1): ItemDefinition {
  return {
    type: "consumable",
    id,
    name: id,
    description: "",
    rarity,
    sprite: `${id}.webp`,
    dimensionId,
    slotCost: { utility: 1 },
    effect: { kind: "heal", amount: 10 },
  };
}

/** Deterministic RNG: replays `values`, then throws — so a test can prove rand-call counts. */
function scriptedRand(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`scriptedRand exhausted after ${values.length} values`);
    return values[i++]!;
  };
}

describe("richnessForIcon", () => {
  it("maps every hex icon per LOOT_RICHNESS_BY_ICON", () => {
    for (const icon of HEX_ICON_TYPES) {
      expect(richnessForIcon(icon)).toBe(LOOT_RICHNESS_BY_ICON[icon]);
    }
  });

  it("covers every HexIconType key (no gaps in the table)", () => {
    for (const icon of HEX_ICON_TYPES) {
      expect(LOOT_RICHNESS_BY_ICON[icon]).toBeDefined();
    }
  });

  it("null (plain hex) drops like an enemy-camp: standard", () => {
    expect(richnessForIcon(null)).toBe("standard");
    expect(richnessForIcon("enemy-camp")).toBe("standard");
  });
});

describe("rollDrops — drop gate", () => {
  it("standard rolls nothing when the first rand >= dropChance (0.6)", () => {
    // scriptedRand throws on a 2nd call — proves the gate short-circuits before any rarity roll.
    const drops = rollDrops([weapon("c1", "common")], "town", scriptedRand([0.6]));
    expect(drops).toEqual([]);
  });

  it("standard yields exactly one item when the gate rand < 0.6", () => {
    const drops = rollDrops([weapon("c1", "common")], "town", scriptedRand([0.5, 0.0, 0.0]));
    expect(drops.map((d) => d.id)).toEqual(["c1"]);
  });
});

describe("rollDrops — rarity weights", () => {
  const pool = [weapon("c1", "common"), weapon("u1", "uncommon"), weapon("r1", "rare")];

  it("standard bands: rand 0.0 -> common, 0.80 -> uncommon, 0.97 -> rare", () => {
    expect(rollDrops(pool, "town", scriptedRand([0.0, 0.0, 0.0]))[0]!.id).toBe("c1");
    expect(rollDrops(pool, "town", scriptedRand([0.0, 0.8, 0.0]))[0]!.id).toBe("u1");
    expect(rollDrops(pool, "town", scriptedRand([0.0, 0.97, 0.0]))[0]!.id).toBe("r1");
  });

  it("grand yields 3 items, bands honored across the count loop", () => {
    const drops = rollDrops(pool, "great-ruins", scriptedRand([0.5, 0.0, 0.0, 0.5, 0.0, 0.99, 0.0]));
    expect(drops.map((d) => d.id)).toEqual(["c1", "u1", "r1"]);
  });

  it("same rand sequence twice -> identical drops (determinism)", () => {
    const script = [0.5, 0.0, 0.0, 0.5, 0.0, 0.99, 0.0];
    const a = rollDrops(pool, "great-ruins", scriptedRand(script));
    const b = rollDrops(pool, "great-ruins", scriptedRand(script));
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
  });
});

describe("rollDrops — rarity fallback walk", () => {
  it("only-uncommon pool + rolled rare walks DOWN to uncommon", () => {
    // elite (ruins): count 1, c45/u40/r15; rand 0.99 lands the rare band.
    const drops = rollDrops([weapon("u1", "uncommon")], "ruins", scriptedRand([0.5, 0.99, 0.0]));
    expect(drops.map((d) => d.id)).toEqual(["u1"]);
  });

  it("only-rare pool + rolled common walks UP to rare", () => {
    // standard: rand 0.0 lands the common band; no common/uncommon present -> up to rare.
    const drops = rollDrops([weapon("r1", "rare")], "town", scriptedRand([0.5, 0.0, 0.0]));
    expect(drops.map((d) => d.id)).toEqual(["r1"]);
  });

  it("dim-1-shaped pool (common/uncommon only) under apex weights never returns undefined", () => {
    // apex (boss): count 2, r50 weight; both rolls land rare -> must fall back, never undefined.
    const pool = [weapon("c1", "common"), weapon("u1", "uncommon")];
    const drops = rollDrops(pool, "boss", scriptedRand([0.5, 0.99, 0.0, 0.99, 0.0]));
    expect(drops.length).toBe(2);
    for (const d of drops) {
      expect(d).toBeDefined();
      expect(["c1", "u1"]).toContain(d.id);
    }
  });
});

describe("rollDrops — exclusion set", () => {
  it("abilitytest is a member of LOOT_EXCLUDED_ITEM_IDS", () => {
    expect(LOOT_EXCLUDED_ITEM_IDS.has("abilitytest")).toBe(true);
  });

  it("a pool of only excluded ids drops nothing (and never rolls)", () => {
    const throwing = () => {
      throw new Error("should not roll: empty eligible pool");
    };
    expect(rollDrops([weapon("abilitytest", "common")], "boss", throwing)).toEqual([]);
  });

  it("a mixed pool never drops an excluded id", () => {
    const pool = [weapon("abilitytest", "common"), weapon("c0", "common"), weapon("c1", "common"), weapon("c2", "common")];
    // eligible = [c0,c1,c2]; sweep the pick index across all three.
    for (const pick of [0.0, 0.4, 0.8]) {
      const drops = rollDrops(pool, "town", scriptedRand([0.5, 0.0, pick]));
      expect(drops).toHaveLength(1);
      expect(drops[0]!.id).not.toBe("abilitytest");
      expect(drops[0]!.id).toStartWith("c");
    }
  });
});

describe("rollDrops — duplicates allowed", () => {
  it("two rolls from a one-item pool yield the same design twice", () => {
    // treasure: count 2, dropChance 1.0.
    const drops = rollDrops([weapon("c1", "common")], "treasure", scriptedRand([0.5, 0.0, 0.0, 0.0, 0.0]));
    expect(drops.map((d) => d.id)).toEqual(["c1", "c1"]);
  });
});

describe("isManifestable", () => {
  it("consumables are never manifestable, even at an eligible tier", () => {
    expect(isManifestable(consumable("potion"), 0, 5)).toBe(false);
  });

  it("gates on design tier <= starting tier", () => {
    const w = weapon("blade", "rare", 2);
    expect(isManifestable(w, 2, 2)).toBe(true);
    expect(isManifestable(w, 1, 2)).toBe(true);
    expect(isManifestable(w, 3, 2)).toBe(false);
  });
});

describe("effectiveStartingTier", () => {
  it("null (unplaced dev-override) -> 0", () => {
    expect(effectiveStartingTier(null)).toBe(0);
  });

  it("passes a concrete tier through", () => {
    expect(effectiveStartingTier(3)).toBe(3);
    expect(effectiveStartingTier(0)).toBe(0);
  });
});
