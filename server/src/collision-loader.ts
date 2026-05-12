import sharp from "sharp";
import { resolve } from "path";
import type { GridState, MapObjectPlacement, StructureEntry } from "shared";
import { stampMapObjects } from "shared";
import type { AlphaImage } from "shared";

const PUBLIC_DIR = resolve(import.meta.dir, "../../client/public");
const SPRITES_DIR = resolve(PUBLIC_DIR, "sprites/map-objects");

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
    if (sp) return resolve(PUBLIC_DIR, sp);
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
