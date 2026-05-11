import { Assets, Texture } from "pixi.js";
import type { AnimSet, SpriteSet } from "shared";
import { loadCharacterAnchors } from "./anchor-loader.js";
import { loadHexDecorations } from "./hex-map-renderer.js";

export type AnimState = "idle" | "attack" | "hit" | "move";

const PLAYER_ANIM_SETS: AnimSet[] = [
  "sword", "dual-wield", "spear", "bow", "staff", "two-handed",
];

const ITEM_SPRITES = [
  "short-sword", "long-sword", "spear", "axe", "bow", "broadsword",
  "battle-axe", "mace", "round-shield", "kite-shield", "buckler",
  "quiver", "staff", "spellbook", "potion", "bomb",
];

const SERVER_BASE = `http://${window.location.hostname}:3001`;

const enemyTextures = new Map<string, Texture>();
const playerTextures = new Map<string, Texture>();
const itemTextures = new Map<string, Texture>();
const loadedDimensions = new Set<number>();

function playerKey(animSet: AnimSet, state: AnimState): string {
  return `${animSet}-${state}`;
}

export async function loadSpriteAssets(): Promise<void> {
  const entries: { alias: string; src: string }[] = [];

  for (const animSet of PLAYER_ANIM_SETS) {
    for (const state of (["idle", "attack", "hit", "move"] as AnimState[])) {
      const k = playerKey(animSet, state);
      entries.push({ alias: k, src: `sprites/char1/${k}.webp` });
    }
  }

  for (const itemId of ITEM_SPRITES) {
    entries.push({ alias: `item-${itemId}`, src: `sprites/items/${itemId}.webp` });
  }

  await Promise.all([
    Assets.load(entries),
    loadCharacterAnchors("char1"),
  ]);

  for (const animSet of PLAYER_ANIM_SETS) {
    for (const state of (["idle", "attack", "hit", "move"] as AnimState[])) {
      const k = playerKey(animSet, state);
      playerTextures.set(k, Assets.get(k));
    }
  }
  for (const itemId of ITEM_SPRITES) {
    const tex = Assets.get<Texture>(`item-${itemId}`);
    if (tex) itemTextures.set(itemId, tex);
  }
}

export interface DimensionManifest {
  id: number;
  name: string;
  spritePaths: string[];
  structureSprites: Record<string, string>;
  itemSprites: Record<string, string>;
  backgroundPath: string | null;
  hexDecorationsPath: string | null;
}

export async function loadDimensionSprites(dimensionId: number): Promise<DimensionManifest> {
  const res = await fetch(`${SERVER_BASE}/api/dimensions/${dimensionId}`);
  const manifest: DimensionManifest = await res.json();

  if (loadedDimensions.has(dimensionId)) return manifest;

  const entries: { alias: string; src: string }[] = [];
  for (const path of manifest.spritePaths) {
    entries.push({ alias: path, src: `${SERVER_BASE}${path}` });
  }
  for (const [name, path] of Object.entries(manifest.structureSprites)) {
    entries.push({ alias: `map-${name}`, src: path });
  }
  for (const [spriteId, path] of Object.entries(manifest.itemSprites)) {
    entries.push({ alias: `item-${spriteId}`, src: path });
  }
  if (manifest.backgroundPath) {
    entries.push({ alias: "map-background", src: manifest.backgroundPath });
  }

  if (entries.length > 0) {
    await Assets.load(entries);
    for (const path of manifest.spritePaths) {
      enemyTextures.set(path, Assets.get(path));
    }
    for (const spriteId of Object.keys(manifest.itemSprites)) {
      const tex = Assets.get<Texture>(`item-${spriteId}`);
      if (tex) itemTextures.set(spriteId, tex);
    }
  }

  await loadHexDecorations(manifest.hexDecorationsPath ?? "sprites/map-decorations");

  loadedDimensions.add(dimensionId);
  return manifest;
}

export function getItemTexture(itemId: string): Texture | null {
  return itemTextures.get(itemId) ?? null;
}

export function getPlayerTexture(
  animSet: AnimSet,
  state: AnimState,
): Texture {
  return playerTextures.get(playerKey(animSet, state))!;
}

export function getEnemyTexture(path: string): Texture | null {
  return enemyTextures.get(path) ?? null;
}
