#!/usr/bin/env bun
/**
 * Auto-generate a complete dimension: theme → art → enemies → items → balanced.
 *
 *   bun dimension-generator/auto/run.ts [dimId] [--skip-art]
 *
 * If dimId is omitted, defaults to 100.
 * Pass --skip-art to skip image generation (reuse existing bundles).
 */
import { join } from "node:path";
import { generateSpec } from "./generate-spec.js";
import { runEnemyAgent } from "./enemy-agent.js";
import { runItemAgent } from "./item-agent.js";
import { buildFromSpec } from "../build-diffusion-bundles.js";
import { generateArt } from "./art-agent.js";

const ROOT = join(import.meta.dir, "..", "..");
const totalT0 = Date.now();

const skipArt = process.argv.includes("--skip-art");

// Ensure we're in the server directory so DB paths resolve (SQLite uses relative path)
process.chdir(join(ROOT, "server"));

// Seed existing dimensions into the DB (the balance test references dim-0 enemies)
console.log("Seeding existing dimensions...");
const { seedDimension0 } = await import("../../server/src/seed.js");
const { seedDimension1 } = await import("../../server/src/seed-dimension-1.js");
const { seedDimension2 } = await import("../../server/src/seed-dimension-2.js");
const { seedDimension3 } = await import("../../server/src/seed-dimension-3.js");
const { saveDimension, seedDiscovery, startNewRun } = await import("../../server/src/db.js");
seedDiscovery(startNewRun(0, "local"), 15);
seedDimension0();
seedDimension1();
seedDimension2();
seedDimension3();
console.log("Seeding done.\n");

// --- Resolve dimension ID ---
const dimId = Number(process.argv.find(a => /^\d+$/.test(a))) || 100;
console.log(`========================================`);
console.log(`  Auto-generating dimension ${dimId}`);
console.log(`========================================\n`);

// --- Step 1: Generate spec ---
console.log("--- Step 1: Generating dimension spec ---");
const specT0 = Date.now();
const spec = { ...(await generateSpec(dimId)), id: dimId };
const specElapsed = ((Date.now() - specT0) / 1000).toFixed(1);
console.log(`  Name: ${spec.name}`);
console.log(`  Biome: ${spec.biome}`);
console.log(`  Mood: ${spec.mood}`);
console.log(`  Mechanical Identity: ${(spec as any).mechanicalIdentity ?? "N/A"}`);
console.log(`  Enemies:\n${spec.enemies}`);
console.log(`  Items:\n${spec.items}`);
console.log(`  Spec generated in ${specElapsed}s\n`);

// Save dimension shell to DB
saveDimension(dimId, spec.name, [], undefined, undefined);

// Write spec to disk for reference
const specPath = join(ROOT, "dimension-generator", `dimension-${dimId}-spec.json`);
await Bun.write(specPath, JSON.stringify(spec, null, 2));
console.log(`  Spec written to ${specPath}\n`);

// --- Step 2: Build diffusion bundles + generate art ---
if (!skipArt) {
  console.log("--- Step 2: Building diffusion bundles ---");
  const bundlesRoot = await buildFromSpec(spec as any);

  console.log("\n--- Step 3: Generating art ---");
  const artT0 = Date.now();
  await generateArt(dimId, spec, bundlesRoot);
  const artElapsed = ((Date.now() - artT0) / 1000).toFixed(1);
  console.log(`  Art generated in ${artElapsed}s\n`);
} else {
  console.log("--- Skipping art generation (--skip-art) ---\n");
}

// --- Step 4: Enemy balance + Item balance (in parallel) ---
console.log("--- Step 4: Enemy + Item agents (parallel) ---\n");
const agentT0 = Date.now();

const [enemies, items] = await Promise.all([
  runEnemyAgent(dimId, spec),
  runItemAgent(dimId, spec),
]);

const agentElapsed = ((Date.now() - agentT0) / 1000).toFixed(1);
const totalElapsed = ((Date.now() - totalT0) / 1000).toFixed(1);

console.log(`\n========================================`);
console.log(`  DONE — Dimension ${dimId}: ${spec.name}`);
console.log(`========================================`);
console.log(`  Enemies: ${Object.keys(enemies).length}`);
console.log(`  Items:   ${Object.keys(items).length}`);
console.log(`  Agent phase: ${agentElapsed}s`);
console.log(`  Total time:  ${totalElapsed}s`);
console.log(`\n  All data is in the SQLite database.`);
console.log(`  Art assets are in place.`);
console.log(`  Restart the server or hot-reload to play.`);
