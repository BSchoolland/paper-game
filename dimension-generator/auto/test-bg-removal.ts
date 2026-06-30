#!/usr/bin/env bun
/**
 * Iterate on image-gen prompts to optimize for easy background removal.
 * Generates an image, runs the existing bg-removal algorithm, and reports metrics.
 */
import OpenAI from "openai";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const openai = new OpenAI();
const OUT_DIR = join(import.meta.dir, "..", "bg-test");
await Bun.write(join(OUT_DIR, ".gitkeep"), ""); // ensure dir exists via parent

const BASE_PROMPT = [
  "A 4x4 sprite sheet of fantasy weapon items.",
  "Hand-drawn pencil and crayon style, simple and not too detailed.",
  "Each cell contains one item: swords, axes, bows, shields, potions, staffs.",
  "Consistent style across all 16 cells, clear spacing between items.",
].join(" ");

const iterations: { name: string; suffix: string }[] = [
  {
    name: "v1-plain-white",
    suffix: " Pure white background (#FFFFFF). No texture, no grain, no shading on the background — just flat white.",
  },
  {
    name: "v2-high-contrast",
    suffix: " Pure flat white background (#FFFFFF), no texture or grain. Each item should have strong dark outlines and bold colors that contrast sharply against the white. No soft edges or fading into the background.",
  },
  {
    name: "v3-green-screen",
    suffix: " Solid bright green background (#00FF00), like a green screen. No texture, no grain, perfectly uniform green. Items should have no green in them — use warm colors (browns, golds, silvers, reds).",
  },
  {
    name: "v4-best-refined",
    suffix: "", // will be filled after seeing results
  },
];

// Python script to test bg removal and report metrics
const BG_TEST_PY = `
import sys, json
import numpy as np
from PIL import Image

img = Image.open(sys.argv[1]).convert("RGB")
arr = np.array(img)
h, w = arr.shape[:2]

# Sample corners (same as scripts/process-spritesheet.py)
corners = np.concatenate([
    arr[0:20, 0:20].reshape(-1, 3),
    arr[0:20, w-20:w].reshape(-1, 3),
    arr[h-20:h, 0:20].reshape(-1, 3),
    arr[h-20:h, w-20:w].reshape(-1, 3),
])
bg_color = np.median(corners, axis=0)
bg_std = np.std(corners, axis=0)

# Distance from bg color for every pixel
diff = np.sqrt(np.sum((arr.astype(float) - bg_color) ** 2, axis=2))

threshold = 30
alpha = np.clip((diff - threshold) * (255 / 30), 0, 255).astype(np.uint8)

total = alpha.size
fully_transparent = int(np.sum(alpha == 0))
fully_opaque = int(np.sum(alpha == 255))
partial = total - fully_transparent - fully_opaque

# Save the alpha channel as a preview
alpha_img = Image.fromarray(alpha, "L")
alpha_img.save(sys.argv[1].replace(".png", "-alpha.png"))

# Save the RGBA result
rgba = np.dstack([arr, alpha])
Image.fromarray(rgba, "RGBA").save(sys.argv[1].replace(".png", "-removed.png"))

result = {
    "bg_color": bg_color.tolist(),
    "bg_std": bg_std.tolist(),
    "bg_uniformity": float(np.mean(bg_std)),
    "total_pixels": total,
    "fully_transparent_pct": round(100 * fully_transparent / total, 1),
    "fully_opaque_pct": round(100 * fully_opaque / total, 1),
    "partial_alpha_pct": round(100 * partial / total, 1),
}
print(json.dumps(result))
`;

const pyPath = join(OUT_DIR, "bg-test.py");
await Bun.write(pyPath, BG_TEST_PY);

async function runIteration(name: string, prompt: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Prompt suffix: ...${prompt.slice(BASE_PROMPT.length)}`);

  const imgPath = join(OUT_DIR, `${name}.png`);

  const t0 = Date.now();
  const response = await openai.images.generate({
    model: "gpt-image-2",
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "low",
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  Generated in ${elapsed}s`);

  const image = response.data![0]!;
  if (image.b64_json) {
    await Bun.write(imgPath, Buffer.from(image.b64_json, "base64"));
  } else if (image.url) {
    const res = await fetch(image.url);
    await Bun.write(imgPath, await res.arrayBuffer());
  }
  console.log(`  Saved: ${imgPath}`);

  // Run bg removal analysis
  const result = spawnSync("python3", [pyPath, imgPath], { encoding: "utf-8" });
  if (result.status !== 0) {
    console.log(`  BG analysis FAILED: ${result.stderr}`);
    return null;
  }

  const metrics = JSON.parse(result.stdout.trim());
  console.log(`  BG color: [${metrics.bg_color.map((c: number) => c.toFixed(0)).join(", ")}]`);
  console.log(`  BG uniformity (lower=better): ${metrics.bg_uniformity.toFixed(2)}`);
  console.log(`  Fully transparent: ${metrics.fully_transparent_pct}%`);
  console.log(`  Fully opaque: ${metrics.fully_opaque_pct}%`);
  console.log(`  Partial alpha (ambiguous, lower=better): ${metrics.partial_alpha_pct}%`);
  console.log(`  Alpha preview: ${imgPath.replace(".png", "-alpha.png")}`);
  console.log(`  BG-removed preview: ${imgPath.replace(".png", "-removed.png")}`);

  return metrics;
}

// Run iterations
const results: Record<string, any> = {};

for (let i = 0; i < iterations.length; i++) {
  const iter = iterations[i]!;

  // v4: pick best approach from v1-v3 and refine
  if (iter.name === "v4-best-refined" && Object.keys(results).length >= 3) {
    let bestName = "";
    let bestPartial = 100;
    for (const [name, m] of Object.entries(results)) {
      if (m && m.partial_alpha_pct < bestPartial) {
        bestPartial = m.partial_alpha_pct;
        bestName = name;
      }
    }
    console.log(`\n  v4: Best so far is ${bestName} (${bestPartial}% partial alpha). Refining that approach.`);

    const bestSuffix = iterations.find(it => it.name === bestName)!.suffix;
    iter.suffix = bestSuffix + " Items should have crisp hard edges with no anti-aliasing or soft blending into the background. Each item is fully self-contained with no shadows or glow extending outward.";
  }

  const prompt = BASE_PROMPT + iter.suffix;
  results[iter.name] = await runIteration(iter.name, prompt);
}

// Summary
console.log(`\n${"=".repeat(60)}`);
console.log("  SUMMARY");
console.log(`${"=".repeat(60)}`);
console.log(`  ${"Name".padEnd(22)} ${"BG Uniform".padEnd(12)} ${"Transparent".padEnd(13)} ${"Opaque".padEnd(10)} Partial`);
for (const [name, m] of Object.entries(results)) {
  if (!m) continue;
  console.log(`  ${name.padEnd(22)} ${m.bg_uniformity.toFixed(2).padEnd(12)} ${(m.fully_transparent_pct + "%").padEnd(13)} ${(m.fully_opaque_pct + "%").padEnd(10)} ${m.partial_alpha_pct}%`);
}
console.log(`\n  Images saved in: ${OUT_DIR}`);
