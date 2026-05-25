#!/usr/bin/env bun
/**
 * Generate art for a dimension by calling gpt-image-2 on each diffusion bundle.
 *
 * Can be used as CLI:
 *   bun dimension-generator/auto/art-agent.ts <dimension-slug>
 *
 * Or imported:
 *   import { generateArt } from "./art-agent.js";
 *   await generateArt(dimId, spec, bundlesRoot);
 */
import OpenAI from "openai";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const openai = new OpenAI();
const ROOT = join(import.meta.dir, "..", "..");
const BUNDLES_DIR = join(import.meta.dir, "..", "diffusion-bundles");
const SCRIPTS = join(ROOT, "scripts");

const BG_SUFFIX = " Pure flat white background (#FFFFFF), no texture or grain. Each subject should have strong dark outlines and bold colors that contrast sharply against the white. No soft edges or fading into the background.";

interface BundleResult {
  name: string;
  imagePath: string;
  elapsed: number;
}

async function generateBundle(bundleDir: string): Promise<BundleResult> {
  const name = basename(bundleDir);
  const promptPath = join(bundleDir, "prompt.txt");
  const prompt = await readFile(promptPath, "utf-8");

  const files = await readdir(bundleDir);
  const refFile = files.find(f => f.startsWith("reference"));
  if (!refFile) throw new Error(`No reference image in ${bundleDir}`);
  const refPath = join(bundleDir, refFile);

  const fullPrompt = prompt + BG_SUFFIX;

  console.log(`  Generating: ${name}`);
  console.log(`    Prompt: ${prompt.slice(0, 80).replace(/\n/g, " ")}...`);

  const t0 = Date.now();

  const refBuffer = await Bun.file(refPath).arrayBuffer();
  const refBlob = new File([refBuffer], refFile, {
    type: refFile.endsWith(".png") ? "image/png" : "image/jpeg",
  });

  const response = await openai.images.edit({
    model: "gpt-image-2",
    image: refBlob,
    prompt: fullPrompt,
    size: "1024x1024",
    quality: "low",
  });

  const elapsed = (Date.now() - t0) / 1000;
  const image = response.data![0]!;

  const outPath = join(bundleDir, "output.png");
  if (image.b64_json) {
    await Bun.write(outPath, Buffer.from(image.b64_json, "base64"));
  } else if (image.url) {
    const res = await fetch(image.url);
    await Bun.write(outPath, await res.arrayBuffer());
  } else {
    throw new Error(`No image data for ${name}`);
  }

  console.log(`    Done in ${elapsed.toFixed(1)}s -> ${outPath}`);
  return { name, imagePath: outPath, elapsed };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function extractEnemyNames(spec: any, batchIdx: number): string {
  // Structured format (enemyBatches array)
  if (spec.enemyBatches?.[batchIdx]?.enemies) {
    return spec.enemyBatches[batchIdx].enemies
      .map((e: any) => slugify(e.name))
      .join(",");
  }
  // Freeform format — parse names from the text
  if (spec.enemies && typeof spec.enemies === "string") {
    const tiers = ["FODDER", "STANDARD", "ELITE", "BOSS"];
    const lines = spec.enemies.split("\n");
    const tierNames: string[][] = [[], [], [], []];
    let currentTier = -1;
    for (const line of lines) {
      const tierMatch = tiers.findIndex(t => line.toUpperCase().includes(t));
      if (tierMatch >= 0) { currentTier = tierMatch; continue; }
      const nameMatch = line.match(/^-\s*(.+?)\s*[—–-]\s*/);
      if (nameMatch && currentTier >= 0) {
        tierNames[currentTier]!.push(slugify(nameMatch[1]!));
      }
    }
    if (tierNames[batchIdx]!.length === 4) return tierNames[batchIdx]!.join(",");
  }
  return "enemy-a,enemy-b,enemy-c,enemy-d";
}

function extractItemNames(spec: any): string {
  // Structured format
  if (Array.isArray(spec.items) && spec.items[0]?.name) {
    return spec.items.map((i: any) => slugify(i.name)).join(",");
  }
  // Freeform format
  if (typeof spec.items === "string") {
    const names: string[] = [];
    for (const line of spec.items.split("\n")) {
      const m = line.match(/^-\s*(.+?)\s*\(/);
      if (m) names.push(slugify(m[1]!));
    }
    if (names.length === 16) return names.join(",");
  }
  return Array.from({ length: 16 }, (_, i) => `item-${i}`).join(",");
}

function extractSprites(dimId: number, result: BundleResult, spec: any) {
  const { name, imagePath } = result;
  console.log(`  Extracting: ${name}`);

  if (name === "01-background") {
    const outDir = join(ROOT, "client/public/sprites/map-objects", `dimension-${dimId}`);
    spawnSync("mkdir", ["-p", outDir]);
    spawnSync("cp", [imagePath, join(outDir, "background.png")]);
    console.log(`    Copied background`);
    return;
  }

  if (name === "02-decorations") {
    const outDir = join(ROOT, "client/public/sprites/map-objects", `dimension-${dimId}`);
    spawnSync("mkdir", ["-p", outDir]);
    const r = spawnSync("python3", [
      join(SCRIPTS, "process-decoration-sheet.py"), imagePath, outDir,
    ], { encoding: "utf-8" });
    console.log(`    ${r.stdout?.split("\n").filter(Boolean).slice(-2).join("; ") || r.stderr?.trim()}`);
    return;
  }

  if (name === "07-map-decorations") {
    const outDir = join(ROOT, "client/public/sprites/map-decorations", `dimension-${dimId}`);
    spawnSync("mkdir", ["-p", outDir]);
    const r = spawnSync("python3", [
      join(SCRIPTS, "process-decoration-sheet.py"), imagePath, outDir,
    ], { encoding: "utf-8" });
    console.log(`    ${r.stdout?.split("\n").filter(Boolean).slice(-2).join("; ") || r.stderr?.trim()}`);
    return;
  }

  if (name.match(/^\d+-enemies-/)) {
    const outDir = join(ROOT, "server/sprites/enemies", `dimension-${dimId}`);
    spawnSync("mkdir", ["-p", outDir]);

    const batchIdx = parseInt(name.slice(0, 2)) - 3;
    const names = extractEnemyNames(spec, batchIdx);

    const r = spawnSync("python3", [
      join(SCRIPTS, "process-spritesheet.py"), imagePath, outDir,
      "--cols", "4", "--rows", "4",
      "--names", names,
      "--states", "idle,attack,hit,move",
    ], { encoding: "utf-8" });
    console.log(`    ${r.stdout?.split("\n").filter(Boolean).slice(-2).join("; ") || r.stderr?.trim()}`);
    return;
  }

  if (name === "08-items") {
    const outDir = join(ROOT, "client/public/sprites/items", `dimension-${dimId}`);
    spawnSync("mkdir", ["-p", outDir]);

    const names = extractItemNames(spec);
    const r = spawnSync("python3", [
      join(SCRIPTS, "process-item-sheet.py"), imagePath, outDir,
      "--cols", "4", "--rows", "4",
      "--names", names,
    ], { encoding: "utf-8" });
    console.log(`    ${r.stdout?.split("\n").filter(Boolean).slice(-2).join("; ") || r.stderr?.trim()}`);
    return;
  }

  console.log(`    Skipping unknown bundle: ${name}`);
}

export async function generateArt(dimId: number, spec: any, bundlesRoot: string): Promise<void> {
  console.log(`\n--- Art Agent: ${spec.name} (dim ${dimId}) ---\n`);

  const entries = await readdir(bundlesRoot, { withFileTypes: true });
  const bundleDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  console.log(`  ${bundleDirs.length} bundles: ${bundleDirs.join(", ")}\n`);

  const t0 = Date.now();
  const results: BundleResult[] = [];

  for (const dir of bundleDirs) {
    const result = await generateBundle(join(bundlesRoot, dir));
    results.push(result);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  All ${results.length} images generated in ${elapsed}s\n`);

  console.log("  Extracting sprites...\n");
  for (const result of results) {
    extractSprites(dimId, result, spec);
  }

  console.log(`\n  Art done — ${results.length} bundles in ${elapsed}s`);
}

// --- CLI entry point ---
if (import.meta.main) {
  const dimSlug = process.argv[2];
  if (!dimSlug) {
    console.error("Usage: bun dimension-generator/auto/art-agent.ts <dimension-slug>");
    process.exit(1);
  }

  const bundlesRoot = join(BUNDLES_DIR, dimSlug);
  if (!existsSync(bundlesRoot)) {
    console.error(`Bundle directory not found: ${bundlesRoot}`);
    process.exit(1);
  }

  let spec: any = {};
  const specFiles = await readdir(join(import.meta.dir, ".."));
  for (const f of specFiles) {
    if (!f.endsWith("-spec.json")) continue;
    const s = JSON.parse(await readFile(join(import.meta.dir, "..", f), "utf-8"));
    if (slugify(s.name ?? "") === dimSlug) { spec = s; break; }
  }

  await generateArt(spec.id ?? 0, spec, bundlesRoot);
}
