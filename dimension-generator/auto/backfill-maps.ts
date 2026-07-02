#!/usr/bin/env bun
/**
 * Backfill v2 encounter maps for every legacy dimension that lacks them, so the
 * v1 structure fallback can be deleted. For each dim: generate maps (codex) ->
 * assert full coverage -> upload art to the CDN. Sequential, fail-loud: stops at
 * the first dimension that errors rather than leaving partial coverage.
 *
 *   ART_BACKEND=codex GAME_DB_PATH=<abs> bun backfill-maps.ts
 */
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { generateDimensionMaps } from "./map-agent.js";
import { uploadMaps } from "./upload-maps-s3.js";
import { HEX_ICON_TYPES } from "../../shared/src/map/hex-map.js";
import type { MapManifest } from "../../shared/src/encounter/map-manifest.js";
import { ASSETS_DIR } from "../../shared/src/paths.js";

const ROOT = resolve(import.meta.dir, "..", "..");
const REQUIRED = [...HEX_ICON_TYPES, "wilderness", "dense-wilderness"];

// Mapless db dimensions. dim 502 ("Thornwood") has no spec file — it shares the
// theme of dim 500, so reuse that description. Override via argv, e.g.
// `bun backfill-maps.ts 600` to backfill a single dimension.
const DEFAULT_DIMS = [1, 2, 3, 4, 100, 500, 502, 600, 700, 702];
const argDims = process.argv.slice(2).map(Number).filter(Number.isFinite);
const DIMS = argDims.length > 0 ? argDims : DEFAULT_DIMS;
const DESC_502 = "A dense world of hardwood forest and thorny scrubland where every clearing is contested.";

async function specFor(dimId: number): Promise<{ name: string; description: string }> {
  const p = join(ROOT, "dimension-generator", `dimension-${dimId}-spec.json`);
  if (existsSync(p)) {
    const s = JSON.parse(await Bun.file(p).text());
    return { name: s.name, description: s.description };
  }
  if (dimId === 502) return { name: "Thornwood", description: DESC_502 };
  throw new Error(`No spec for dimension ${dimId} and no fallback configured`);
}

function coverageMissing(manifest: MapManifest): string[] {
  const present = new Set(
    Object.entries(manifest.maps ?? {}).filter(([, f]) => f.length > 0).map(([t]) => t),
  );
  return REQUIRED.filter((t) => !present.has(t));
}

// A dim is done when its manifest already covers every type for BOTH maps and
// masks — lets the backfill resume after a codex usage-limit stop without
// regenerating finished dimensions.
async function alreadyComplete(dimId: number): Promise<boolean> {
  const p = join(ASSETS_DIR, "sprites/maps", `dimension-${dimId}`, "manifest.json");
  if (!existsSync(p)) return false;
  const m = JSON.parse(await Bun.file(p).text()) as MapManifest;
  const mapsOk = coverageMissing(m).length === 0;
  const masksPresent = new Set(
    Object.entries(m.masks ?? {}).filter(([, f]) => f.length > 0).map(([t]) => t),
  );
  const masksOk = REQUIRED.every((t) => masksPresent.has(t));
  return mapsOk && masksOk;
}

const results: Record<number, string> = {};
for (const dimId of DIMS) {
  const { name, description } = await specFor(dimId);

  if (await alreadyComplete(dimId)) {
    console.log(`\n=== dimension ${dimId} (${name}) already complete — uploading + skipping gen ===`);
    await uploadMaps(dimId);
    results[dimId] = `${name}: already complete`;
    continue;
  }

  console.log(`\n=== Backfilling dimension ${dimId} (${name}) ===`);

  const manifest = await generateDimensionMaps(dimId, name, description);

  const missing = coverageMissing(manifest);
  if (missing.length > 0) {
    throw new Error(`Dimension ${dimId} (${name}) coverage FAILED — missing [${missing.join(", ")}]`);
  }
  console.log(`  coverage OK: all ${REQUIRED.length} encounter types`);

  await uploadMaps(dimId);
  results[dimId] = `${name}: ${Object.keys(manifest.maps).length} types`;
  console.log(`  uploaded to CDN`);
}

console.log(`\n=== Backfill complete ===`);
for (const [d, r] of Object.entries(results)) console.log(`  dim ${d}: ${r}`);
