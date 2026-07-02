/**
 * Loot generation & manifest gating (docs/meta-loop/03-loot-codex.md §2.1).
 *
 * Pure data + pure functions: the server rolls drops here, the client renders richness
 * labels from the same constants, and both sides gate manifests through one predicate so
 * they cannot drift.
 */
import type { HexIconType } from "../map/hex-map.js";
import type { ItemDefinition, ItemRarity } from "./items.js";

/** Drop-richness class per hex icon (locked #12 + master: treasure hexes drop more/better). */
export type LootRichness = "standard" | "elite" | "treasure" | "grand" | "apex";

export const LOOT_RICHNESS_BY_ICON: Readonly<Record<HexIconType, LootRichness>> = {
  town: "standard",
  city: "standard",
  gateway: "standard",
  "gateway-city": "standard",
  "enemy-camp": "standard",
  ruins: "elite",
  "elite-encounter": "elite",
  treasure: "treasure",
  "great-ruins": "grand",
  "great-treasure": "grand",
  boss: "apex",
  calamity: "apex",
};

/** A plain hex (no icon) fights like an enemy-camp and drops like one. */
export function richnessForIcon(icon: HexIconType | null): LootRichness {
  return icon === null ? "standard" : LOOT_RICHNESS_BY_ICON[icon];
}

export interface DropProfile {
  /** Probability the encounter drops at all (rolled once). */
  readonly dropChance: number;
  /** Independent item rolls when it does. */
  readonly count: number;
  readonly rarityWeights: Readonly<Record<ItemRarity, number>>;
}

/**
 * THE tunable table. epic/legendary weights are 0 until such content exists (live pools carry
 * common/uncommon/rare only); the fallback walk in rollDrops handles sparse pools either way.
 */
export const DROP_PROFILES: Readonly<Record<LootRichness, DropProfile>> = {
  standard: { dropChance: 0.6, count: 1, rarityWeights: { common: 70, uncommon: 25, rare: 5, epic: 0, legendary: 0 } },
  elite: { dropChance: 1.0, count: 1, rarityWeights: { common: 45, uncommon: 40, rare: 15, epic: 0, legendary: 0 } },
  treasure: { dropChance: 1.0, count: 2, rarityWeights: { common: 40, uncommon: 40, rare: 20, epic: 0, legendary: 0 } },
  grand: { dropChance: 1.0, count: 3, rarityWeights: { common: 15, uncommon: 45, rare: 40, epic: 0, legendary: 0 } },
  apex: { dropChance: 1.0, count: 2, rarityWeights: { common: 10, uncommon: 40, rare: 50, epic: 0, legendary: 0 } },
};

export const RARITY_ORDER: readonly ItemRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Dev/test items that must never drop (present in live pools). */
export const LOOT_EXCLUDED_ITEM_IDS: ReadonlySet<string> = new Set(["abilitytest"]);

/**
 * Nearest present rarity bucket to `rolled`: the rolled rarity if it has items, else the
 * closest lower rarity, else the closest higher one. Callers guarantee a non-empty pool, so
 * some bucket is always present.
 */
function nearestPresentRarity(byRarity: Map<ItemRarity, ItemDefinition[]>, rolled: ItemRarity): ItemRarity {
  const idx = RARITY_ORDER.indexOf(rolled);
  for (let i = idx; i >= 0; i--) {
    const r = RARITY_ORDER[i]!;
    if ((byRarity.get(r)?.length ?? 0) > 0) return r;
  }
  for (let i = idx + 1; i < RARITY_ORDER.length; i++) {
    const r = RARITY_ORDER[i]!;
    if ((byRarity.get(r)?.length ?? 0) > 0) return r;
  }
  throw new Error("nearestPresentRarity: no present rarity (non-empty pool guaranteed by caller)");
}

/**
 * Roll an encounter's drops from a dimension pool. Pure: all randomness flows through `rand`
 * (() => number in [0,1)). A rolled rarity whose bucket is empty walks DOWN RARITY_ORDER to
 * the nearest present rarity, then UP — deterministic, never empty-handed while the pool has
 * items. Duplicate designs across rolls are allowed (flag #7). Empty/excluded-only pool -> [].
 */
export function rollDrops(
  pool: readonly ItemDefinition[],
  icon: HexIconType | null,
  rand: () => number,
): ItemDefinition[] {
  const profile = DROP_PROFILES[richnessForIcon(icon)];
  const eligible = pool.filter((i) => !LOOT_EXCLUDED_ITEM_IDS.has(i.id));
  if (eligible.length === 0) return [];
  if (rand() >= profile.dropChance) return [];

  const byRarity = new Map<ItemRarity, ItemDefinition[]>();
  for (const item of eligible) {
    const bucket = byRarity.get(item.rarity);
    if (bucket) bucket.push(item);
    else byRarity.set(item.rarity, [item]);
  }

  const totalWeight = RARITY_ORDER.reduce((sum, r) => sum + profile.rarityWeights[r], 0);
  const drops: ItemDefinition[] = [];
  for (let n = 0; n < profile.count; n++) {
    let roll = rand() * totalWeight;
    let rolled: ItemRarity = "common";
    for (const r of RARITY_ORDER) {
      roll -= profile.rarityWeights[r];
      if (roll < 0) {
        rolled = r;
        break;
      }
    }
    const bucket = byRarity.get(nearestPresentRarity(byRarity, rolled))!;
    drops.push(bucket[Math.floor(rand() * bucket.length)]!);
  }
  return drops;
}

/** Locked #5's manifest gate, shared so lobby UI and server validation cannot drift. */
export function isManifestable(item: ItemDefinition, designTier: number, startingTier: number): boolean {
  return item.type !== "consumable" && designTier <= startingTier;
}

/** 04 §10's NULL-tier rule for dev-override runs: gate manifests as tier 0. */
export function effectiveStartingTier(dimensionTier: number | null): number {
  return dimensionTier ?? 0;
}
