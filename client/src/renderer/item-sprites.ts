import { Assets, Texture } from "pixi.js";
import type { ItemDefinition } from "shared";
import { assetUrl } from "./asset-url.js";

type ItemRef = Pick<ItemDefinition, "sprite" | "dimensionId">;

/** Root-absolute URL for an item's sprite image. The single place this path is built. */
export function itemSpriteUrl(item: ItemRef): string {
  const prefix = item.dimensionId === 0 ? "" : `dimension-${item.dimensionId}/`;
  return assetUrl(`sprites/items/${prefix}${item.sprite}.webp`);
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
  } catch {
    return null;
  }
}
