#!/usr/bin/env bun
/**
 * Run ONLY the enemy agent on an existing spec JSON. Useful for A/B testing
 * prompt or model changes without paying for the spec + item passes again.
 *
 *   bun dimension-generator/auto/run-enemy-only.ts <spec-path> <dimId> [model]
 *
 * Example:
 *   bun dimension-generator/auto/run-enemy-only.ts \
 *     dimension-generator/dimension-500-spec.json 502 xiaomi/mimo-v2.5-pro
 */
import { join, resolve } from "node:path";
import { runEnemyAgent } from "./enemy-agent.js";

const ROOT = join(import.meta.dir, "..", "..");
const ORIGINAL_CWD = process.cwd();

const specPath = process.argv[2];
const dimId = Number(process.argv[3]);
const model = process.argv[4];

if (!specPath || !dimId) {
  console.error("Usage: bun run-enemy-only.ts <spec-path> <dimId> [model]");
  process.exit(1);
}

// Resolve the spec path relative to the original cwd before we chdir.
const candidates = [
  specPath,
  join(ORIGINAL_CWD, specPath),
  join(ROOT, specPath),
  join(ROOT, "dimension-generator", specPath),
];
let resolvedSpecPath = "";
for (const p of candidates) {
  const abs = resolve(p);
  if (await Bun.file(abs).exists()) { resolvedSpecPath = abs; break; }
}
if (!resolvedSpecPath) {
  console.error(`Could not find spec file. Tried:\n  ${candidates.join("\n  ")}`);
  process.exit(1);
}

process.chdir(join(ROOT, "server"));

console.log("Seeding reference dimensions...");
const { seedDimension0 } = await import("../../server/src/seed.js");
const { seedDimension1 } = await import("../../server/src/seed-dimension-1.js");
const { seedDimension2 } = await import("../../server/src/seed-dimension-2.js");
const { seedDimension3 } = await import("../../server/src/seed-dimension-3.js");
const { seedDiscovery } = await import("../../server/src/db.js");
seedDiscovery(15);
seedDimension0();
seedDimension1();
seedDimension2();
seedDimension3();

const spec = JSON.parse(await Bun.file(resolvedSpecPath).text());
spec.id = dimId;

console.log(`\nRunning enemy agent for dim ${dimId} "${spec.name}"`);
console.log(`Source spec: ${specPath}`);
console.log(`Model: ${model ?? "(default)"}`);
console.log();

const t0 = Date.now();
const enemies = await runEnemyAgent(dimId, spec, model);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\nDone in ${elapsed}s — ${Object.keys(enemies).length} enemies saved to dim ${dimId}`);

const kinds = { attack: 0, barrier: 0, zone: 0 };
for (const t of Object.values(enemies)) {
  for (const a of t.abilities) {
    if (a.kind === "attack" || a.kind === "barrier" || a.kind === "zone") kinds[a.kind]++;
  }
}
console.log(`Ability kind tally: attack=${kinds.attack}  barrier=${kinds.barrier}  zone=${kinds.zone}`);
