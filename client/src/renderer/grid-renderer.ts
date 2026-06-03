import { Assets, Sprite, Texture } from "pixi.js";
import type { GridState, MapObjectPlacement } from "shared";
import { stampMapObjects } from "shared";
import type { AlphaImage } from "shared";
import { assetUrl } from "./asset-url.js";

const ALL_OBJECT_NAMES = [
  "tree-oak-small",
  "tree-oak-medium",
  "tree-oak-large",
  "tree-pine",
  "bush-small",
  "bush-medium",
  "bush-large",
  "grass-small",
  "grass-medium",
  "grass-large",
  "rock-small",
  "rock-medium",
  "rock-large",
  "rock-pile",
  "ruins-rubble",
  "stone-block",
  "stone-brick",
  "stone-pillar",
  "wall-corner",
  "wall-enclosure",
  "wall-long",
  "wall-medium",
  "wall-short",
  "wall-t-junction",
  "wall-u-shape",
];

function objectFolder(name: string): string {
  if (name.startsWith("tree-") || name.startsWith("bush-") || name.startsWith("grass-"))
    return "plants";
  if (name.startsWith("rock-")) return "rocks";
  if (name.startsWith("wall-") || name.startsWith("stone-")) return "walls";
  return "";
}

export async function loadMapAssets(): Promise<void> {
  const entries = ALL_OBJECT_NAMES.map((name) => {
    const folder = objectFolder(name);
    const subpath = folder ? `${folder}/` : "";
    return {
      alias: `map-${name}`,
      src: assetUrl(`sprites/map-objects/${subpath}${name}.webp`),
    };
  });
  await Assets.load(entries);
}

export function createBackground(grid: GridState, bgUrl?: string): Sprite {
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const loaded: Texture | undefined = bgUrl ? Assets.get(bgUrl) : Assets.get("map-background");
  const bg = new Sprite(loaded ?? Texture.EMPTY);
  bg.width = worldW;
  bg.height = worldH;
  // Fallback when not preloaded (e.g. replay): load async and swap in if the
  // sprite is still alive (the scene may have rebuilt while loading).
  if (bgUrl && !loaded) {
    Assets.load(bgUrl)
      .then((tex: Texture) => {
        if (bg.destroyed) return;
        bg.texture = tex;
        bg.width = worldW;
        bg.height = worldH;
      })
      .catch(() => {});
  }
  return bg;
}

export function getBottomY(sprite: Sprite): number {
  const tex = sprite.texture;
  return sprite.position.y + tex.height * sprite.scale.y * (1 - sprite.anchor.y);
}

function getTextureAlpha(tex: Texture): AlphaImage | null {
  const source = tex.source.resource;
  if (!(source instanceof HTMLImageElement || source instanceof ImageBitmap))
    return null;
  const w = tex.width;
  const h = tex.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    alpha[i] = data[i * 4 + 3]!;
  }
  return { alpha, width: w, height: h };
}

export function createMapObjects(
  placements: readonly MapObjectPlacement[],
  grid: GridState
): Sprite[] {
  const sprites: Sprite[] = [];
  const imageCache = new Map<string, AlphaImage | null>();

  for (const obj of placements) {
    const tex: Texture = Assets.get(`map-${obj.name}`);
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5, 0.9);
    sprite.scale.set(obj.scale);
    sprite.position.set(obj.position.x, obj.position.y);
    sprites.push(sprite);

    if (!imageCache.has(obj.name)) {
      imageCache.set(obj.name, getTextureAlpha(tex));
    }
  }

  stampMapObjects(grid, placements, (name) => imageCache.get(name) ?? null);

  return sprites;
}
