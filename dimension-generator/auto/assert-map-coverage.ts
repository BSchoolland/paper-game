#!/usr/bin/env bun
/**
 * Fail loud unless a dimension's map manifest covers every encounter type.
 *
 * The v2 pipeline mandates baked image maps for all encounters — newly
 * generated dimensions register no structures, so a missing encounter type
 * would silently produce a wall-less, art-less encounter. This gate makes that
 * a hard failure at generation time instead.
 *
 *   bun assert-map-coverage.ts <dimId>
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { HEX_ICON_TYPES } from "../../shared/src/map/hex-map.js";
import type { MapManifest } from "../../shared/src/encounter/map-manifest.js";
import { ASSETS_DIR } from "../../shared/src/paths.js";

const REQUIRED = [...HEX_ICON_TYPES, "wilderness", "dense-wilderness"];

const dimId = Number(process.argv[2]);
if (!Number.isFinite(dimId)) {
  console.error("Usage: bun assert-map-coverage.ts <dimId>");
  process.exit(1);
}

const manifestPath = join(ASSETS_DIR, "sprites/maps", `dimension-${dimId}`, "manifest.json");
if (!existsSync(manifestPath)) {
  throw new Error(`v2 map coverage: manifest missing for dimension ${dimId} at ${manifestPath}`);
}

const manifest = (await Bun.file(manifestPath).json()) as MapManifest;
const present = new Set(
  Object.entries(manifest.maps ?? {})
    .filter(([, files]) => files.length > 0)
    .map(([type]) => type),
);
const missing = REQUIRED.filter((t) => !present.has(t));

if (missing.length > 0) {
  throw new Error(
    `v2 map coverage FAILED for dimension ${dimId}: missing maps for [${missing.join(", ")}]. ` +
      `Every encounter type must have at least one image — v2 dimensions have no structure fallback.`,
  );
}

console.log(`v2 map coverage OK for dimension ${dimId}: all ${REQUIRED.length} encounter types have maps.`);
