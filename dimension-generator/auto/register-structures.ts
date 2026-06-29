#!/usr/bin/env bun
/**
 * Register structure sprites for an auto-generated dimension.
 *
 *   bun register-structures.ts <dimId>
 *
 * Reads the sprite manifest at:
 *   client/public/sprites/map-objects/dimension-<dimId>/manifest.json
 *
 * Builds StructureEntry[] with the same cost/scale formula as buildDim3Structures(),
 * then updates the dimension row in the DB (preserving name and status).
 *
 * Respects GAME_DB_PATH env var.
 */
import { Database } from "bun:sqlite";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

interface StructureEntry {
  name: string;
  index: number;
  cost: number;
  scale: number;
  spritePath: string;
}

const dimId = Number(process.argv[2]);
if (!dimId || isNaN(dimId)) {
  console.error("Usage: bun register-structures.ts <dimId>");
  process.exit(1);
}

const ROOT = resolve(import.meta.dir, "..", "..");
const PUBLIC_DIR = join(ROOT, "client", "public");
const DB_PATH = process.env.GAME_DB_PATH ?? join(ROOT, "server", "hex-discovery.sqlite");

// v2 dimensions render encounters from baked map images, not runtime-composited
// structures, so they register zero structures. The overworld background +
// hex decorations below are still registered — those are unrelated to encounter
// structures and needed regardless of map style.
const decorationsOnly = process.argv.includes("--decorations-only");

let structures: StructureEntry[] = [];
if (!decorationsOnly) {
  // Read manifest — fail loud if missing
  const manifestPath = join(PUBLIC_DIR, `sprites/map-objects/dimension-${dimId}/manifest.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest missing: ${manifestPath}`);
  }
  const names: string[] = await Bun.file(manifestPath).json();
  const count = names.length;
  if (count === 0) throw new Error(`Manifest at ${manifestPath} is empty`);

  // Build StructureEntry[] — same cost/scale formula as buildDim3Structures()
  structures = names.map((name, i) => {
    const t = count > 1 ? i / (count - 1) : 0;
    return {
      name: `structure-${String(i).padStart(2, "0")}`,
      index: i,
      cost: t < 0.33 ? 1 : t < 0.66 ? 2 : 3,
      scale: 0.25 + t * 0.15,
      spritePath: `sprites/map-objects/dimension-${dimId}/${name}.png`,
    };
  });
}

// Resolve optional asset paths
const bgFile = join(PUBLIC_DIR, `sprites/map-objects/dimension-${dimId}/background.png`);
const backgroundPath = existsSync(bgFile)
  ? `sprites/map-objects/dimension-${dimId}/background.png`
  : null;

const hexDecorDir = join(PUBLIC_DIR, `sprites/map-decorations/dimension-${dimId}`);
const hexDecorationsPath = existsSync(hexDecorDir)
  ? `sprites/map-decorations/dimension-${dimId}`
  : null;

// Load existing row to preserve name + status
const db = new Database(DB_PATH, { create: true });

const row = db
  .prepare("SELECT name, status FROM dimensions WHERE id = ?")
  .get(dimId) as { name: string; status: string } | null;

if (!row) throw new Error(`Dimension ${dimId} not found in DB at ${DB_PATH}`);

db.prepare(
  "UPDATE dimensions SET structures_json = ?, background_path = ?, hex_decorations_path = ? WHERE id = ?",
).run(JSON.stringify(structures), backgroundPath, hexDecorationsPath, dimId);

console.log(
  `Dimension ${dimId} (${row.name}): registered ${structures.length} structures${decorationsOnly ? " (v2 decorations-only)" : ""}`,
);
console.log(`  backgroundPath:      ${backgroundPath ?? "(none)"}`);
console.log(`  hexDecorationsPath:  ${hexDecorationsPath ?? "(none)"}`);
