#!/usr/bin/env bun
/**
 * Map agent — generate a dimension's full set of encounter maps.
 *
 * Pipeline:
 *   Phase A (new dimensions only): canonical reference + dimension style/color
 *     prompt -> the dimension's OWN reference map (a dense-wilderness-density
 *     image). Skipped when a finished reference is passed in.
 *   Phase B: that reference -> 24 maps via MAP_PROMPTS, run as parallel low
 *     singles (concurrency-limited). The reference itself is then slotted in as
 *     an extra dense-wilderness variant (the 25th map).
 *   Manifest: encounterType -> [public sprite paths] for runtime selectMap().
 *
 * CLI:
 *   bun dimension-generator/auto/map-agent.ts <dimId> <referencePath>
 *     -> Phase B only, using an existing finished reference (e.g. grasslands).
 */
import OpenAI from "openai";
import { join, extname } from "node:path";
import { ASSETS_DIR } from "../../shared/src/paths.js";
import { mkdir, copyFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { MAP_PROMPTS, fullPrompt } from "./map-prompts.js";
import { client, SMART_MODEL } from "./llm.js";
import { generateImage, ART_BACKEND } from "./generate-image.js";
import type { MapManifest } from "../../shared/src/encounter/map-manifest.js";

// Map + reference generation goes through the shared generateImage (codex by default). Collision
// detection (detectPass) stays on the OpenAI API: it needs faithful in-place recoloring — keep the
// scene identical, paint non-walkable regions red — which codex's generative tool can't do reliably.
// Lazy client so codex-only runs (--no-collision) need no OPENAI_API_KEY.
let openai: OpenAI | undefined;
const getOpenAI = () => (openai ??= new OpenAI());
const ROOT = join(import.meta.dir, "..", "..");

export const MAP_MODEL = "gpt-image-2";
const MAP_SIZE = "1456x1088"; // ~4:3, matches reference, both divisible by 16 (API path only)
const MAP_QUALITY = "low";
const MAP_ASPECT = "4:3 LANDSCAPE (clearly wider than tall)"; // codex aspect hint
const CONCURRENCY = ART_BACKEND === "codex" ? 8 : 6;

// --- collision detection ---
const COLLISION_PY = join(ROOT, "dimension-generator/scripts/collision_mask.py");
const DETECT_SIZE = "1024x768"; // near the model's min pixel budget — cheaper + segments more consistently
// Verbatim region-detection prompt: recolor non-walkable areas solid red.
const COLLISION_PROMPT =
  "I want to see if the image generator can do region detection too. Treat it like normal, but please ask it to keep this image the exact same, but replace all collision areas the player cannot walk over with solid red versions of themselves. Small items like small flowers or shrubs shorter than the player are walk-able. Large items like trees or boulders are not. Things the player can walk through like doors, stairs or floors are walk able, walls or roofs are not. Cliffs and rivers are not walk-able. If the image does not match up directly with my prompt, use judgement.";
// Encounter types with large solid-fill buildings — a single low pass under-fills
// roofs, so these get 3 passes + majority merge. Thin-wall/scatter/open types
// detect reliably in one pass.
export const MULTIPASS_TYPES = new Set([
  "town", "city", "gateway-city", "gateway", "enemy-camp", "great-treasure", "great-ruins",
]);

// --- bounded-concurrency pool ---

async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- Description rewrite: enforce the colorful-palette visual requirement ---

const COLOR_REQUIREMENT =
  "The image must contain saturated color, concentrated in vegetation and living/painted accents against a pale neutral ground. " +
  "Never let the palette collapse into a single low-saturation hue (especially all-brown). " +
  "Arid biomes keep their pale ground and weathered stone, but vegetation stays genuinely colorful — green scrub, green creek-bed trees, bright fruit. " +
  "This is a colorful game; desaturated monochrome is the failure to avoid.";

export async function rewriteDescription(description: string): Promise<string> {
  const instructions = [
    "Rewrite the following dimension description so it does not break the visual requirement below, while not completely changing the biome/dimension's identity.",
    "The hard question that might show up is: how do we communicate harsh/barren conditions while keeping the game fun, eye-catching, and colorful?",
    "",
    "VISUAL REQUIREMENT:",
    COLOR_REQUIREMENT,
    "",
    "Add color through ordinary green plants and worn or painted accents on pale ground — don't invent a glow or magic gimmick to justify it. A dim place can simply have colorful green plants.",
    "Keep color simple and concentrated; don't list many hues.",
    "BANNED WORDS (AI-slop fantasy — never use): bioluminescent, glowing, phosphorescent, luminous, neon, iridescent, grotto, ethereal, sapphire, prismatic.",
    "",
    "Return only the new description, with no markdown and without renaming the dimension. If no change is needed, return it as is.",
  ].join("\n");
  const result = client.callModel({ model: SMART_MODEL, instructions, input: description });
  let text = "";
  for await (const delta of result.getTextStream()) text += delta;
  await result.getResponse();
  return text.trim();
}

// --- Phase A: style-transfer the canonical reference into this dimension ---

export async function generateDimensionReference(
  name: string,
  description: string,
  canonicalRefPath: string,
  outPath: string,
): Promise<void> {
  const prompt = [
    `This is "The grasslands". Please generate an image using the same style and the same gameplay elements of another biome/dimension called ${name}: ${description}`,
    "Important:",
    "- The description is light guidance. Avoid images that look all one color — even if the description implies a flat dead palette, override it and make something colorful and good-looking while staying faithful to the example image.",
    "- The image must contain saturated color, concentrated in vegetation and living/painted accents against a pale neutral ground. Never let the palette collapse into a single low-saturation hue (especially all-brown).",
    "- The walkable ground should remain light and parchment colored.",
    "- Keep the minimal theme from the reference image; do not overwhelm with detail.",
  ].join("\n");
  await generateImage({
    prompt,
    outPath,
    referencePath: canonicalRefPath,
    size: MAP_SIZE,
    quality: MAP_QUALITY,
    aspectHint: MAP_ASPECT,
    label: "dimension reference",
  });
  console.log(`  Phase A: dimension reference -> ${outPath}`);
}

// --- Phase B: generate all encounter maps from the dimension reference ---

const PUBLIC_SUBDIR = (dimId: number) => `sprites/maps/dimension-${dimId}`;

function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; // IHDR width/height
}

// One detection pass: recolor non-walkable regions red on a downscaled map.
async function detectPass(smallPath: string): Promise<Buffer> {
  const buf = await Bun.file(smallPath).arrayBuffer();
  const blob = new File([buf], "in.png", { type: "image/png" });
  const res = await getOpenAI().images.edit({ model: MAP_MODEL, image: blob, prompt: COLLISION_PROMPT, n: 1, size: DETECT_SIZE as any, quality: "low" as any });
  const img = res.data![0]!;
  if (img.b64_json) return Buffer.from(img.b64_json, "base64");
  if (img.url) return Buffer.from(await (await fetch(img.url)).arrayBuffer());
  throw new Error("No image data in collision pass");
}

// Detect -> N passes -> majority merge -> mask at the map's resolution.
export async function generateCollisionMask(mapPath: string, outMaskPath: string, passes: number): Promise<void> {
  const [w, h] = pngSize(Buffer.from(await Bun.file(mapPath).arrayBuffer()));
  const tmp = outMaskPath.replace(/\.png$/i, "");
  const small = `${tmp}.small.png`;
  const [dw, dh] = DETECT_SIZE.split("x");
  spawnSync("python3", [COLLISION_PY, "downscale", mapPath, small, dw!, dh!], { encoding: "utf-8" });

  const bufs = await Promise.all(Array.from({ length: passes }, () => detectPass(small)));
  const passPaths = bufs.map((_, i) => `${tmp}.r${i}.png`);
  await Promise.all(bufs.map((b, i) => Bun.write(passPaths[i]!, b)));

  const r = spawnSync("python3", [COLLISION_PY, "extract", "--inputs", ...passPaths, "--out", outMaskPath, "--out-size", `${w}x${h}`], { encoding: "utf-8" });
  if (r.stdout) process.stdout.write(`    ${r.stdout.trim()}\n`);
  await Promise.all([small, ...passPaths].map(p => rm(p, { force: true })));
}

// Generate collision masks for every map in an already-generated dimension,
// using MULTIPASS_TYPES to decide pass count. Idempotent; updates the manifest.
export async function generateMasks(dimId: number): Promise<void> {
  const sub = PUBLIC_SUBDIR(dimId);
  const dir = join(ASSETS_DIR, sub);
  const manifest = JSON.parse(await Bun.file(join(dir, "manifest.json")).text()) as MapManifest;

  const tasks = Object.entries(manifest.maps).flatMap(([type, files]) =>
    files.map(file => ({ type, file, passes: MULTIPASS_TYPES.has(type) ? 3 : 1 })));

  console.log(`\n--- Collision masks: dimension ${dimId} (${tasks.length} maps) ---`);
  const masks: Record<string, string[]> = {};
  await pool(tasks, 3, async (t) => {
    const maskFile = t.file.replace(/\.png$/i, ".mask.png");
    await generateCollisionMask(join(ASSETS_DIR, t.file), join(ASSETS_DIR, maskFile), t.passes);
    (masks[t.type] ??= []).push(maskFile);
    console.log(`  ✓ ${maskFile.split("/").pop()} (${t.passes}-pass)`);
  });
  for (const k of Object.keys(masks)) masks[k]!.sort();

  manifest.masks = masks;
  await Bun.write(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`  Masks written + manifest updated.`);
}

export async function generateMaps(dimId: number, referencePath: string): Promise<MapManifest> {
  const sub = PUBLIC_SUBDIR(dimId);
  const outDir = join(ASSETS_DIR, sub);
  await mkdir(outDir, { recursive: true });

  console.log(`\n--- Map Agent: dimension ${dimId} ---`);
  console.log(`  Reference: ${referencePath}`);
  console.log(`  ${MAP_PROMPTS.length} maps @ ${MAP_SIZE} ${MAP_QUALITY}, concurrency ${CONCURRENCY}\n`);

  const refExt = extname(referencePath).toLowerCase() === ".png" ? "png" : "jpeg";

  const t0 = Date.now();
  const files = await pool(MAP_PROMPTS, CONCURRENCY, async (p) => {
    const file = `${p.encounterType}-${p.variant}.png`;
    await generateImage({
      prompt: fullPrompt(p),
      outPath: join(outDir, file),
      referencePath,
      size: MAP_SIZE,
      quality: MAP_QUALITY,
      aspectHint: MAP_ASPECT,
      label: file,
    });
    console.log(`  ✓ ${file}`);
    return { encounterType: p.encounterType as string, file };
  });

  // 25th map: the dimension's own reference doubles as a dense-wilderness variant.
  const refFile = `dense-wilderness-3.${refExt}`;
  await copyFile(referencePath, join(outDir, refFile));
  files.push({ encounterType: "dense-wilderness", file: refFile });
  console.log(`  ✓ ${refFile} (reference, reused as dense-wilderness)`);

  // Build manifest: encounterType -> sorted public paths
  const maps: Record<string, string[]> = {};
  for (const { encounterType, file } of files) {
    (maps[encounterType] ??= []).push(`${sub}/${file}`);
  }
  for (const k of Object.keys(maps)) maps[k]!.sort();

  const manifest: MapManifest = { dimensionId: dimId, maps };
  await Bun.write(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  ${files.length} maps in ${elapsed}s -> ${outDir}`);
  console.log(`  Manifest: ${join(sub, "manifest.json")}`);
  return manifest;
}

const CANONICAL_REF = join(import.meta.dir, "..", "reference", "grasslands.png");

// Full flow for a new dimension: description -> rewrite -> Phase A -> Phase B.
// skipRewrite treats `description` as already-rewritten (e.g. OpenRouter down).
export async function generateDimensionMaps(dimId: number, name: string, description: string, skipRewrite = false, collision = true): Promise<MapManifest> {
  console.log(`\n=== Map gen for "${name}" (dim ${dimId}) ===`);

  let rewritten = description;
  if (skipRewrite) {
    console.log(`\n[1/4] Rewrite skipped — using description as-is.`);
  } else {
    console.log(`\n[1/4] Rewriting description for the color requirement...`);
    rewritten = await rewriteDescription(description);
    console.log(`  Original:  ${description}`);
  }
  console.log(`  Description: ${rewritten}`);

  console.log(`\n[2/4] Phase A: generating the dimension's reference image...`);
  const refPath = join(import.meta.dir, "..", "reference", `dimension-${dimId}-ref.png`);
  await generateDimensionReference(name, rewritten, CANONICAL_REF, refPath);

  console.log(`\n[3/4] Phase B: generating the encounter maps...`);
  const manifest = await generateMaps(dimId, refPath);

  if (collision) {
    console.log(`\n[4/4] Generating collision masks...`);
    await generateMasks(dimId);
  }
  return manifest;
}

// --- CLI ---
if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--collision") {
    const dimId = Number(argv[1]);
    if (!Number.isFinite(dimId)) {
      console.error("Usage: bun map-agent.ts --collision <dimId>");
      process.exit(1);
    }
    await generateMasks(dimId);
  } else if (argv[0] === "--new") {
    const skipRewrite = argv.includes("--skip-rewrite");
    const collision = !argv.includes("--no-collision");
    const pos = argv.slice(1).filter(a => !a.startsWith("--"));
    const [dimId, name, description] = [Number(pos[0]), pos[1], pos[2]];
    if (!Number.isFinite(dimId) || !name || !description) {
      console.error('Usage: bun map-agent.ts --new [--skip-rewrite] [--no-collision] <dimId> "<name>" "<description>"');
      process.exit(1);
    }
    await generateDimensionMaps(dimId, name!, description!, skipRewrite, collision);
  } else {
    const args = argv.filter(a => !a.startsWith("--"));
    const dimId = Number(args[0]);
    const refPath = args[1];
    if (!Number.isFinite(dimId) || !refPath) {
      console.error("Usage: bun map-agent.ts <dimId> <referencePath>   |   bun map-agent.ts --new <dimId> \"<name>\" \"<description>\"");
      process.exit(1);
    }
    await generateMaps(dimId, refPath);
  }
}
