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
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { slugify } from "../slugify.js";
import { generateImage, resizeToSquare, ART_BACKEND } from "./generate-image.js";
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
  const prompt = await readFile(join(bundleDir, "prompt.txt"), "utf-8");

  const files = await readdir(bundleDir);
  const refFile = files.find(f => f.startsWith("reference"));
  if (!refFile) throw new Error(`No reference image in ${bundleDir}`);
  const refPath = join(bundleDir, refFile);
  const outPath = join(bundleDir, "output.png");
  const fullPrompt = prompt + BG_SUFFIX;

  console.log(`  Generating: ${name} [${ART_BACKEND}]`);
  console.log(`    Prompt: ${prompt.slice(0, 80).replace(/\n/g, " ")}...`);
  const t0 = Date.now();

  await generateImage({
    prompt: fullPrompt,
    outPath,
    referencePath: refPath,
    size: "1024x1024",
    quality: "low",
    aspectHint: "SQUARE (1:1 aspect ratio)",
    label: name,
  });
  resizeToSquare(outPath, 1024);

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`    Done in ${elapsed.toFixed(1)}s -> ${outPath}`);
  return { name, imagePath: outPath, elapsed };
}

// Sprite names come straight from the structured roster — no text parsing. The names here must match
// the kebab-case ids the enemy/item agents assign (both go through the shared slugify).
function extractEnemyNames(spec: any, batchIdx: number): string {
  const batch = spec.enemyBatches?.[batchIdx];
  if (!batch?.enemies) throw new Error(`spec.enemyBatches[${batchIdx}] missing (structured roster required)`);
  if (batch.enemies.length !== 4) throw new Error(`enemy batch ${batchIdx} has ${batch.enemies.length} enemies; need 4`);
  return batch.enemies.map((e: any) => slugify(e.name)).join(",");
}

function extractItemNames(spec: any): string {
  if (!Array.isArray(spec.items)) throw new Error("spec.items must be a structured array (structured roster required)");
  return spec.items.map((i: any) => slugify(i.name)).join(",");
}

export function extractSprites(dimId: number, result: BundleResult, spec: any) {
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

export async function generateArt(dimId: number, spec: any, bundlesRoot: string, onlyFilter?: string): Promise<void> {
  console.log(`\n--- Art Agent: ${spec.name} (dim ${dimId}) ---\n`);

  const entries = await readdir(bundlesRoot, { withFileTypes: true });
  let bundleDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  if (onlyFilter) {
    bundleDirs = bundleDirs.filter(d => d.includes(onlyFilter));
    console.log(`  Filtered to bundles matching "${onlyFilter}": ${bundleDirs.join(", ")}`);
  }

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
  const args = process.argv.slice(2);
  const dimSlug = args.find(a => !a.startsWith("--"));
  const onlyArg = args.find(a => a.startsWith("--only="))?.slice("--only=".length);

  if (!dimSlug) {
    console.error("Usage: bun dimension-generator/auto/art-agent.ts <dimension-slug> [--only=<filter>]");
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

  await generateArt(spec.id ?? 0, spec, bundlesRoot, onlyArg);
}
