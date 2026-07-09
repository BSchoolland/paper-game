import { Assets } from "pixi.js";
import { mapAssetUrl } from "../../lib/urls.js";
import { loadSpriteAssets, loadDimensionSprites, type DimensionManifest } from "./sprite-assets.js";
import { loadMapAssets } from "./grid-renderer.js";
import { loadMapIconAssets } from "./hex-map-renderer.js";

/**
 * Single owner of which assets a scene needs before it is presentable. Scene hosts gate on these
 * promises (BoardHost under the LoadingOverlay, ReplayViewer behind its notice); renderers then
 * read every texture synchronously from the module caches. Promises are cached so concurrent
 * callers share one load, and dropped on failure so the next attempt retries.
 */

let basePromise: Promise<void> | null = null;
const dimensionPromises = new Map<number, Promise<DimensionManifest>>();

/** What every scene draws: player anim sheets + anchors, map objects, hex icons. */
export function baseAssetsReady(): Promise<void> {
  basePromise ??= Promise.all([loadSpriteAssets(), loadMapAssets(), loadMapIconAssets()]).then(
    () => undefined,
    (err: unknown) => {
      basePromise = null;
      throw err;
    },
  );
  return basePromise;
}

/** A dimension's enemy/structure sprites, background, and hex decorations. */
export function dimensionAssetsReady(dimensionId: number): Promise<DimensionManifest> {
  let promise = dimensionPromises.get(dimensionId);
  if (!promise) {
    promise = loadDimensionSprites(dimensionId).catch((err: unknown) => {
      dimensionPromises.delete(dimensionId);
      throw err;
    });
    dimensionPromises.set(dimensionId, promise);
  }
  return promise;
}

/** One encounter's CDN-hosted map image (Assets dedupes repeat loads by URL). */
export function mapImageReady(mapImage: string): Promise<void> {
  return Assets.load(mapAssetUrl(mapImage)).then(() => undefined);
}

/** Everything the first combat frame draws. */
export function encounterAssetsReady(
  dimensionId: number,
  mapImage: string | undefined,
): Promise<void> {
  return Promise.all([
    dimensionAssetsReady(dimensionId),
    mapImage !== undefined ? mapImageReady(mapImage) : null,
  ]).then(() => undefined);
}
