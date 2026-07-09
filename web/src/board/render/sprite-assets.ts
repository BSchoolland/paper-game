import { Assets, Texture } from "pixi.js";
import type { AnimSet, SpriteSet } from "shared";
import { loadCharacterAnchors } from "./anchor-loader.js";
import { loadHexDecorations } from "./hex-map-renderer.js";
import { assetUrl, apiUrl } from "../../lib/urls.js";
import { dimMeta } from "../../state/dim-meta.svelte.js";

export type AnimState = "idle" | "attack" | "hit" | "move";

const PLAYER_ANIM_SETS: AnimSet[] = [
  "sword", "dual-wield", "spear", "bow", "staff", "two-handed",
];

const enemyTextures = new Map<string, Texture>();
const playerTextures = new Map<string, Texture>();

function playerKey(animSet: AnimSet, state: AnimState): string {
  return `${animSet}-${state}`;
}

export async function loadSpriteAssets(): Promise<void> {
  const entries: { alias: string; src: string }[] = [];

  for (const animSet of PLAYER_ANIM_SETS) {
    for (const state of (["idle", "attack", "hit", "move"] as AnimState[])) {
      const k = playerKey(animSet, state);
      entries.push({ alias: k, src: assetUrl(`sprites/char1/${k}.webp`) });
    }
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

/** Load once per dimension via asset-manifest's dimensionAssetsReady, which caches the promise. */
export async function loadDimensionSprites(dimensionId: number): Promise<DimensionManifest> {
  const res = await fetch(apiUrl(`/api/dimensions/${dimensionId}`));
  const manifest: DimensionManifest = await res.json();
  // Same payload the dim-meta store fetches — seed it so item-sprite ext resolution never guesses.
  dimMeta.byId[dimensionId] ??= manifest;

  const entries: { alias: string; src: string }[] = [];
  for (const path of manifest.spritePaths) {
    entries.push({ alias: path, src: apiUrl(path) });
  }
  for (const [name, path] of Object.entries(manifest.structureSprites)) {
    entries.push({ alias: `map-${name}`, src: assetUrl(path) });
  }
  if (manifest.backgroundPath) {
    entries.push({ alias: "map-background", src: assetUrl(manifest.backgroundPath) });
  }

  if (entries.length > 0) {
    await Assets.load(entries);
    for (const path of manifest.spritePaths) {
      enemyTextures.set(path, Assets.get(path));
    }
  }

  await loadHexDecorations(manifest.hexDecorationsPath ?? "sprites/map-decorations");

  return manifest;
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
