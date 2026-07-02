/**
 * Shared payload builders for the mock fixtures — realistic protocol objects without a server.
 * Item definitions are intentionally partial (`as ItemDefinition`): fixtures exercise the UI,
 * not the combat engine.
 */
import type {
  AuthStatePayload,
  CodexEntryPayload,
  ItemDefinition,
  ProfilePayload,
  AccountStatsPayload,
} from "shared";
import { xpToReachLevel } from "shared";
import { dimMeta, type DimensionMeta } from "../src/state/dim-meta.svelte.js";

export const DIMS: Record<number, { name: string; tier: number; thumb: string; ext: "webp" | "png" }> = {
  1: { name: "The Shallows", tier: 0, thumb: "sprites/maps/dimension-1/town-0.png", ext: "webp" },
  2: { name: "The Gloom Hollows", tier: 1, thumb: "sprites/maps/dimension-2/dense-wilderness-0.png", ext: "webp" },
  704: { name: "Nestlands", tier: 2, thumb: "sprites/maps/dimension-704/city-0.png", ext: "png" },
};

const FAUNA: Record<number, string[]> = {
  1: ["/api/sprites/enemies/dimension-1/jellybell/jellybell-idle.webp", "/api/sprites/enemies/dimension-1/mud-crab/mud-crab-idle.webp"],
  2: [
    "/api/sprites/enemies/dimension-2/fungal-shambler/fungal-shambler-idle.webp",
    "/api/sprites/enemies/dimension-2/crystal-scarab/crystal-scarab-idle.webp",
  ],
  704: ["/api/sprites/enemies/dimension-704/big-raptor-idle.png", "/api/sprites/enemies/dimension-704/bone-shaman-idle.png"],
};

/** Pre-seed dimension meta so fixture rendering never fetches from a server that isn't there. */
export function seedDimensions(): void {
  for (const [idStr, d] of Object.entries(DIMS)) {
    const id = Number(idStr);
    const itemSprites: Record<string, string> = {};
    for (const item of ITEMS.filter((i) => i.dimensionId === id)) {
      itemSprites[item.sprite] = `sprites/items/dimension-${id}/${item.sprite}.${d.ext}`;
    }
    dimMeta.byId[id] = {
      id,
      name: d.name,
      spritePaths: FAUNA[id] ?? [],
      structureSprites: {},
      itemSprites,
      backgroundPath: null,
      hexDecorationsPath: null,
      tier: d.tier,
      thumbPath: d.thumb,
    } satisfies DimensionMeta;
  }
}

interface FixtureItemSpec {
  id: string;
  name: string;
  rarity: ItemDefinition["rarity"];
  type: ItemDefinition["type"];
  dimensionId: number;
}

const ITEM_SPECS: FixtureItemSpec[] = [
  { id: "coral-blade", name: "Coral Blade", rarity: "uncommon", type: "weapon", dimensionId: 1 },
  { id: "nautilus-shield", name: "Nautilus Shield", rarity: "uncommon", type: "shield", dimensionId: 1 },
  { id: "leviathan-jaw-blade", name: "Leviathan-Jaw Blade", rarity: "rare", type: "weapon", dimensionId: 1 },
  { id: "driftwood-bow", name: "Driftwood Bow", rarity: "common", type: "weapon", dimensionId: 1 },
  { id: "riptide-flask", name: "Riptide Flask", rarity: "common", type: "consumable", dimensionId: 1 },
  { id: "prism-staff", name: "Prism Staff", rarity: "rare", type: "weapon", dimensionId: 2 },
  { id: "crystal-shard-blade", name: "Crystal Shard Blade", rarity: "uncommon", type: "weapon", dimensionId: 2 },
  { id: "spore-bomb", name: "Spore Bomb", rarity: "uncommon", type: "consumable", dimensionId: 2 },
  { id: "fungal-bulwark", name: "Fungal Bulwark", rarity: "uncommon", type: "shield", dimensionId: 2 },
  { id: "titan-jawbone", name: "Titan Jawbone", rarity: "rare", type: "weapon", dimensionId: 2 },
  { id: "obsidian-blade", name: "Obsidian Blade", rarity: "rare", type: "weapon", dimensionId: 704 },
  { id: "skull-staff", name: "Skull Staff", rarity: "rare", type: "weapon", dimensionId: 704 },
];

export const ITEMS: ItemDefinition[] = ITEM_SPECS.map(
  (s) =>
    ({
      id: s.id,
      name: s.name,
      description: `${s.name} (mock)`,
      rarity: s.rarity,
      sprite: s.id,
      dimensionId: s.dimensionId,
      slotCost: { hand: 1 },
      type: s.type,
      abilities: [],
      animSet: "sword",
      effect: s.type === "consumable" ? { kind: "heal", amount: 10 } : undefined,
    }) as unknown as ItemDefinition,
);

export function item(id: string): ItemDefinition {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`fixture item ${id}`);
  return found;
}

export function codexEntry(itemId: string, opts: { mine?: boolean; acquiredDaysAgo?: number } = {}): CodexEntryPayload {
  const it = item(itemId);
  const dim = DIMS[it.dimensionId]!;
  return {
    item: it,
    dimensionId: it.dimensionId,
    dimensionName: dim.name,
    tier: dim.tier,
    acquiredAt: "2026-06-20T12:00:00Z",
    first: {
      accountId: opts.mine ? "acc-fen" : "acc-someone",
      displayName: opts.mine ? "Fen" : "Odo",
      at: "2026-06-01T12:00:00Z",
      mine: opts.mine ?? false,
    },
  };
}

const ZERO_STATS: AccountStatsPayload = {
  encountersWon: 0,
  hexesCharted: 0,
  dimensionsDiscovered: 0,
  wipes: 0,
  contractsCompleted: 0,
  dimensionsTraveled: 0,
  designsRecovered: 0,
  firstsRecovered: 0,
};

export function guestAuth(): AuthStatePayload {
  const profile: ProfilePayload = {
    accountId: "acc-guest",
    displayName: "Wanderer",
    isGuest: true,
    username: null,
    xp: 0,
    level: 1,
    equippedTitleId: null,
    titles: [],
    stats: ZERO_STATS,
    createdAt: "2026-07-01T00:00:00Z",
  };
  return { accountId: "acc-guest", isGuest: true, username: null, authToken: "mock-token", profile };
}

export function fenAuth(): AuthStatePayload {
  const level = 15;
  const profile: ProfilePayload = {
    accountId: "acc-fen",
    displayName: "Fen",
    isGuest: false,
    username: "fenwick",
    xp: xpToReachLevel(level) + 1860,
    level,
    equippedTitleId: "pathfinder",
    titles: ["greenhorn", "veteran", "pathfinder", "sealbearer", "archivist", "trailblazer"],
    stats: {
      encountersWon: 214,
      hexesCharted: 163,
      dimensionsDiscovered: 5,
      wipes: 12,
      contractsCompleted: 31,
      dimensionsTraveled: 9,
      designsRecovered: 38,
      firstsRecovered: 3,
    },
    createdAt: "2026-03-14T00:00:00Z",
  };
  return { accountId: "acc-fen", isGuest: false, username: "fenwick", authToken: "mock-token", profile };
}

export const FEN_CODEX: CodexEntryPayload[] = [
  codexEntry("leviathan-jaw-blade", { mine: true }),
  codexEntry("prism-staff"),
  codexEntry("coral-blade"),
  codexEntry("nautilus-shield"),
  codexEntry("crystal-shard-blade"),
  codexEntry("obsidian-blade", { mine: true }),
  codexEntry("fungal-bulwark"),
  codexEntry("skull-staff"),
  codexEntry("titan-jawbone"),
  codexEntry("driftwood-bow"),
  codexEntry("riptide-flask"),
  codexEntry("spore-bomb"),
];
