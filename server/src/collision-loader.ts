import sharp from "sharp";
import { resolve } from "path";
import type { GridState, MapObjectPlacement } from "shared";
import { stampMapObjects } from "shared";
import type { AlphaImage } from "shared";

const SPRITES_DIR = resolve(import.meta.dir, "../../client/public/sprites/map-objects");

function objectFolder(name: string): string {
  if (name.startsWith("tree-") || name.startsWith("bush-") || name.startsWith("grass-"))
    return "plants";
  if (name.startsWith("rock-")) return "rocks";
  if (name.startsWith("wall-") || name.startsWith("stone-")) return "walls";
  return "";
}

export async function loadCollisionGrid(
  grid: GridState,
  placements: readonly MapObjectPlacement[]
): Promise<void> {
  const imageCache = new Map<string, AlphaImage | null>();

  const uniqueNames = [...new Set(placements.map((p) => p.name))];
  await Promise.all(
    uniqueNames.map(async (name) => {
      const folder = objectFolder(name);
      const subpath = folder ? `${folder}/` : "";
      const filePath = resolve(SPRITES_DIR, `${subpath}${name}.webp`);
      try {
        const { data, info } = await sharp(filePath)
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
