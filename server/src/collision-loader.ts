import sharp from "sharp";
import { resolve } from "path";
import type { GridState, MapObjectPlacement, StructureEntry } from "shared";
import { stampMapObjects, CELL_WALL } from "shared";
import type { AlphaImage } from "shared";
import { ASSETS_DIR } from "../../shared/src/paths.js";

const SPRITES_DIR = resolve(ASSETS_DIR, "sprites/map-objects");

function objectFolder(name: string): string {
  if (name.startsWith("tree-") || name.startsWith("bush-") || name.startsWith("grass-"))
    return "plants";
  if (name.startsWith("rock-")) return "rocks";
  if (name.startsWith("wall-") || name.startsWith("stone-")) return "walls";
  return "";
}

export async function loadCollisionGrid(
  grid: GridState,
  placements: readonly MapObjectPlacement[],
  structures?: readonly StructureEntry[]
): Promise<void> {
  const imageCache = new Map<string, AlphaImage | null>();
  const spritePathByName = new Map(
    (structures ?? []).filter((s) => s.spritePath).map((s) => [s.name, s.spritePath!])
  );

  const resolvePath = (name: string): string => {
    const sp = spritePathByName.get(name);
    if (sp) return resolve(ASSETS_DIR, sp);
    const folder = objectFolder(name);
    const subpath = folder ? `${folder}/` : "";
    return resolve(SPRITES_DIR, `${subpath}${name}.webp`);
  };

  const uniqueNames = [...new Set(placements.map((p) => p.name))];
  await Promise.all(
    uniqueNames.map(async (name) => {
      try {
        const { data, info } = await sharp(resolvePath(name))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        const alpha = new Uint8Array(info.width * info.height);
        for (let i = 0; i < alpha.length; i++) {
          alpha[i] = data[i * 4 + 3]!;
        }
        imageCache.set(name, { alpha, width: info.width, height: info.height });
      } catch {
        imageCache.set(name, null);
      }
    })
  );

  stampMapObjects(grid, placements, (name) => imageCache.get(name) ?? null);
}

/**
 * Stamp collision from a pre-generated mask image (white = non-walkable). The
 * mask covers the same world as the grid; each grid cell samples the mask at the
 * corresponding normalized position. Masked cells become walls.
 */
export async function loadMaskCollision(grid: GridState, maskPath: string): Promise<void> {
  let raw;
  try {
    raw = await sharp(resolve(ASSETS_DIR, maskPath))
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    console.warn(`[collision] mask missing, encounter has no walls: ${maskPath}`);
    return;
  }
  const { data, info } = raw;
  const mw = info.width;
  const mh = info.height;
  for (let cy = 0; cy < grid.height; cy++) {
    const my = Math.min(mh - 1, ((cy / grid.height) * mh) | 0);
    for (let cx = 0; cx < grid.width; cx++) {
      const mx = Math.min(mw - 1, ((cx / grid.width) * mw) | 0);
      if (data[my * mw + mx]! > 127) {
        grid.walls[cy * grid.width + cx] = CELL_WALL;
      }
    }
  }
}
