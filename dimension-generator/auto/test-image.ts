#!/usr/bin/env bun
/**
 * Quick test: generate a single image with gpt-5.4-image-2.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... bun dimension-generator/auto/test-image.ts
 *
 * Or add OPENAI_API_KEY to dimension-generator/.env (Bun auto-loads it).
 */
import OpenAI from "openai";
import { join } from "node:path";

const openai = new OpenAI();

const prompt = [
  "A 4x4 sprite sheet of fantasy weapon items on a parchment background.",
  "Hand-drawn pencil and crayon style, simple and not too detailed.",
  "Each cell contains one item: swords, axes, bows, shields, potions, staffs.",
  "Consistent style across all 16 cells, clear spacing between items.",
].join(" ");

console.log("Generating image...");
console.log(`  Model: gpt-image-2`);
console.log(`  Prompt: ${prompt.slice(0, 80)}...`);

const t0 = Date.now();
const response = await openai.images.generate({
  model: "gpt-image-2",
  prompt,
  n: 1,
  size: "1024x1024",
  quality: "low",
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const image = response.data![0]!;

const outPath = join(import.meta.dir, "..", "test-output.png");

if (image.b64_json) {
  const buf = Buffer.from(image.b64_json, "base64");
  await Bun.write(outPath, buf);
} else if (image.url) {
  const res = await fetch(image.url);
  await Bun.write(outPath, await res.arrayBuffer());
} else {
  console.error("No image data in response:", image);
  process.exit(1);
}

console.log(`\n✓ Image generated in ${elapsed}s`);
console.log(`  Saved to: ${outPath}`);
console.log(`  Revised prompt: ${image.revised_prompt ?? "(none)"}`);
