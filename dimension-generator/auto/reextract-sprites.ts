#!/usr/bin/env bun
// Re-extract enemy + item sprites from already-generated 4x4 sheets (each bundle's output.png) using
// the current extractSprites logic. Recovers a dimension whose sprite names were mis-parsed, without
// re-paying for image generation. Background/decorations/maps aren't name-coupled, so they're skipped.
import { extractSprites } from "./art-agent.js";
import { join } from "node:path";

const [dimIdArg, bundlesRoot, specPath] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !bundlesRoot || !specPath) {
  throw new Error("usage: reextract-sprites.ts <dimId> <bundlesRoot> <specPath>");
}

const spec = JSON.parse(await Bun.file(specPath).text());
const bundles = ["03-enemies-fodder", "04-enemies-standard", "05-enemies-elite", "06-enemies-boss", "08-items"];
for (const name of bundles) {
  const imagePath = join(bundlesRoot, name, "output.png");
  if (!(await Bun.file(imagePath).exists())) throw new Error(`missing source sheet: ${imagePath}`);
  extractSprites(dimId, { name, imagePath } as never, spec);
}
console.log(JSON.stringify({ ok: true, dimId, bundles }));
