#!/usr/bin/env bun
// CLI wrapper around the art pipeline (build-diffusion-bundles + art-agent), which are
// only exposed as functions. Generates gpt-image-2 art and extracts sprites to disk.
import { buildFromSpec } from "../build-diffusion-bundles.js";
import { generateArt } from "./art-agent.js";

const [dimIdArg, specPath] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !specPath) throw new Error("usage: run-art.ts <dimId> <specPath>");

const spec = JSON.parse(await Bun.file(specPath).text());
if (spec.id !== dimId) spec.id = dimId;

console.log(`[run-art] building bundles for dim ${dimId} "${spec.name}"`);
const bundlesRoot = await buildFromSpec(spec);
console.log(`[run-art] bundles at ${bundlesRoot} — generating art (gpt-image-2)...`);
await generateArt(dimId, spec, bundlesRoot);
console.log(JSON.stringify({ ok: true, dimId, bundlesRoot }));
