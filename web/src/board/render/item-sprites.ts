import { Assets, Texture } from "pixi.js";
import type { ItemDefinition } from "shared";
import { assetUrl } from "../../lib/urls.js";
import { dimMeta } from "../../state/dim-meta.svelte.js";

type ItemRef = Pick<ItemDefinition, "sprite" | "dimensionId">;

/**
 * Root-absolute URL for an item's sprite image. Dimension-0 starters are always webp; other
 * dimensions' extensions come from the dimension meta's server-resolved itemSprites map
 * (loaded before combat entry via loadDimensionSprites).
 */
export function itemSpriteUrl(item: ItemRef): string {
  if (item.dimensionId === 0) return assetUrl(`sprites/items/${item.sprite}.webp`);
  const resolved = dimMeta.byId[item.dimensionId]?.itemSprites[item.sprite];
  if (resolved) return assetUrl(resolved);
  console.error(`itemSpriteUrl: no dimension meta for ${item.dimensionId}/${item.sprite}; guessing webp`);
  return assetUrl(`sprites/items/dimension-${item.dimensionId}/${item.sprite}.webp`);
}

const textures = new Map<string, Texture>();

/** Load (and cache) a pixi texture for an item, fetching the image on demand. */
export async function loadItemTexture(item: ItemRef): Promise<Texture | null> {
  const url = itemSpriteUrl(item);
  const cached = textures.get(url);
  if (cached) return cached;
  try {
    const tex = await Assets.load<Texture>(url);
    if (tex) textures.set(url, tex);
    return tex ?? null;
  } catch (err) {
    console.error(`loadItemTexture: ${url}`, err);
    return null;
  }
}
