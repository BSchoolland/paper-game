#!/usr/bin/env bun
// Rebuild bundle prompts from the spec, then regenerate + extract a single enemy bundle's art.
// Repairs a batch whose image was generated from a malformed prompt (e.g. a truncated roster).
import { buildFromSpec } from "../build-diffusion-bundles.js";
import { generateArt } from "./art-agent.js";

const [dimIdArg, specPath, filter] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !specPath || !filter) {
  throw new Error("usage: regen-bundle.ts <dimId> <specPath> <bundleFilter>");
}

const spec = JSON.parse(await Bun.file(specPath).text());
if (spec.id !== dimId) spec.id = dimId;

const bundlesRoot = await buildFromSpec(spec);
console.log(`[regen] rebuilt prompts at ${bundlesRoot}; regenerating bundles matching "${filter}"...`);
await generateArt(dimId, spec, bundlesRoot, filter);
console.log(JSON.stringify({ ok: true, dimId, filter }));
