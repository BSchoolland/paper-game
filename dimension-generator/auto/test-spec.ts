#!/usr/bin/env bun
/**
 * Run just the spec generation step, print the result.
 *
 *   bun dimension-generator/auto/test-spec.ts [dimId]
 */
import { join } from "node:path";
import { generateSpec } from "./generate-spec.js";

const ROOT = join(import.meta.dir, "..", "..");
process.chdir(join(ROOT, "server"));

const dimId = Number(process.argv[2]) || 900;
const t0 = Date.now();
const spec = await generateSpec(dimId);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`-- ${elapsed}s --`);
console.log(`Name:        ${spec.name}`);
console.log(`Biome:       ${spec.biome}`);
console.log(`Mood:        ${spec.mood}`);
console.log(`Description: ${spec.description}`);
console.log(`Palette:     ${JSON.stringify(spec.palette)}`);
console.log(`\nEnemies:\n${spec.enemies}`);
console.log(`\nItems:\n${spec.items}`);
