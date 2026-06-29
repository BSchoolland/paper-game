#!/usr/bin/env bun
console.log("[debug] Starting script");
console.log("[debug] process.argv:", process.argv);

const [dimIdArg, specPath] = process.argv.slice(2);
console.log("[debug] dimIdArg:", dimIdArg);
console.log("[debug] specPath:", specPath);

const dimId = Number(dimIdArg);
console.log("[debug] dimId:", dimId);

if (!Number.isFinite(dimId) || !specPath) throw new Error("usage: run-art.ts <dimId> <specPath>");

console.log("[debug] Reading spec from:", specPath);
const spec = JSON.parse(await Bun.file(specPath).text());
console.log("[debug] spec.name:", spec.name);

if (spec.id !== dimId) spec.id = dimId;

console.log("[debug] Importing buildFromSpec");
import { buildFromSpec } from "./build-diffusion-bundles.ts";

console.log("[debug] Importing generateArt");
import { generateArt } from "./auto/art-agent.ts";

console.log("[debug] Calling buildFromSpec");
const bundlesRoot = await buildFromSpec(spec);
console.log("[debug] bundlesRoot:", bundlesRoot);

console.log("[debug] Calling generateArt");
await generateArt(dimId, spec, bundlesRoot);
console.log(JSON.stringify({ ok: true, dimId, bundlesRoot }));
