/**
 * Build folder bundles for sending to a diffusion-model API.
 *
 * Each bundle is a directory containing:
 *   - dimension.json   — the full dimension spec
 *   - prompt.txt       — the natural-language instruction for this batch
 *   - reference.*      — a sample image from dimension 0 showing the target style
 *
 * Usage:
 *   bun run build-diffusion-bundles.ts <spec.json>
 *
 * Output:
 *   diffusion-bundles/<dimension-name>/01-background/
 *   diffusion-bundles/<dimension-name>/02-decorations/
 *   diffusion-bundles/<dimension-name>/03-enemies-fodder/
 *   diffusion-bundles/<dimension-name>/04-enemies-standard/
 *   diffusion-bundles/<dimension-name>/05-enemies-elite/
 *   diffusion-bundles/<dimension-name>/06-enemies-boss/
 *   diffusion-bundles/<dimension-name>/07-items/
 */

import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, dirname, resolve, join } from "node:path";
import { slugify } from "./slugify.js";

interface EnemySpec {
  name: string;
  role: string;
  description: string;
}

interface EnemyBatch {
  name: string;
  description: string;
  enemies: EnemySpec[];
}

interface ItemSpec {
  name: string;
  type: string;
  rarity: string;
  description: string;
}

interface DimensionSpec {
  id: number;
  name: string;
  description: string;
  palette: { primary: string; secondary: string; accent: string };
  mood: string;
  biome: string;
  enemyBatches: EnemyBatch[];
  items: ItemSpec[];
}

const SCRIPT_DIR = dirname(import.meta.path);
const REF_DIR = join(SCRIPT_DIR, "reference-images");
const REFERENCES = {
  background: join(REF_DIR, "dim0-background.jpeg"),
  decorations: join(REF_DIR, "dim0-decorations.jpeg"),
  enemies: join(REF_DIR, "dim0-enemies.jpeg"),
  items: join(REF_DIR, "dim0-items.png"),
  mapDecorations: join(REF_DIR, "dim0-map-decorations.png"),
};

async function writeBundle(opts: {
  outDir: string;
  name: string;
  spec: DimensionSpec;
  prompt: string;
  referenceImage: string;
}) {
  const bundleDir = join(opts.outDir, opts.name);
  await rm(bundleDir, { recursive: true, force: true });
  await mkdir(bundleDir, { recursive: true });

  await writeFile(join(bundleDir, "dimension.json"), JSON.stringify(opts.spec, null, 2));
  await writeFile(join(bundleDir, "prompt.txt"), opts.prompt);

  const refExt = extname(opts.referenceImage);
  await copyFile(opts.referenceImage, join(bundleDir, `reference${refExt}`));
}

function formatEnemy(e: EnemySpec): string {
  return `  ${e.name} — ${e.role}. ${e.description}`;
}

function formatItem(item: ItemSpec): string {
  return `  ${item.name} (${item.type}, ${item.rarity}) — ${item.description}`;
}

const ART_STYLE = "Art style: simple, not too detailed, pencil and crayon drawing, but more pencil than crayon.";

function dimensionContext(spec: DimensionSpec): string {
  return [
    `Dimension: ${spec.name}`,
    `Biome: ${spec.biome}`,
    `Mood: ${spec.mood}`,
    `Palette: primary ${spec.palette.primary}, secondary ${spec.palette.secondary}, accent ${spec.palette.accent}`,
    "",
    `Description: ${spec.description}`,
    "",
    ART_STYLE,
  ].join("\n");
}

function lightContext(spec: DimensionSpec): string {
  return [
    `Dimension: ${spec.name}`,
    `Biome: ${spec.biome}`,
    "",
    ART_STYLE,
  ].join("\n");
}

async function buildFromSpec(spec: DimensionSpec): Promise<string> {

  const outDir = join(SCRIPT_DIR, "diffusion-bundles", slugify(spec.name));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const ref of Object.values(REFERENCES)) {
    if (!existsSync(ref)) {
      throw new Error(`Missing reference image: ${ref}`);
    }
  }

  // 1. Background
  await writeBundle({
    outDir,
    name: "01-background",
    spec,
    referenceImage: REFERENCES.background,
    prompt: [
      dimensionContext(spec),
      "",
      "Task: Generate an empty map background that things will be placed on top of — no structures, no plants, nothing. Just the ground texture, edges, and ambient feel of this dimension.",
      "",
      "Match the style of the starter dimension's background (attached as reference.jpeg) exactly: same dimensions, same paper-grain texture, same soft vignetting at the edges, same parchment-overlay quality. The only difference should be the colors and the edge motifs, which should reflect the new dimension's palette and biome.",
    ].join("\n"),
  });

  // 2. Decorations
  await writeBundle({
    outDir,
    name: "02-decorations",
    spec,
    referenceImage: REFERENCES.decorations,
    prompt: [
      dimensionContext(spec),
      "",
      "Task: Generate a decoration sprite sheet for this new dimension. The attached reference.jpeg shows the equivalent sheet from the starter dimension — match its hand-drawn linework, color saturation, isometric three-quarter perspective, and drop shadows. Ignore the reference's parchment background.",
      "",
      "Each decoration should be a single distinct object with clear space around it, suitable for cutting out individually. A mix of organic decorations (plants/natural objects) and structural decorations (walls/ruins/built objects) — choose what fits this dimension's biome and mood.",
      "",
      "Important: Use a variety of colors across the decorations — not everything should be the same color as the dimension palette. Natural environments have diverse coloring, so include variety (e.g. different plant greens, browns, grays for rocks, varied flower colors).",
    ].join("\n"),
  });

  // 3-6. Enemies (one bundle per tier). Structured roster required — freeform strings are not parsed.
  if (!spec.enemyBatches?.length) {
    throw new Error("spec.enemyBatches is required (structured roster). Freeform enemy strings are no longer supported.");
  }
  for (let i = 0; i < spec.enemyBatches.length; i++) {
    const batch = spec.enemyBatches[i]!;
    if (batch.enemies.length !== 4) {
      throw new Error(`enemy batch "${batch.name}" has ${batch.enemies.length} enemies; need exactly 4 for a 4×4 grid.`);
    }
    const enemyList = batch.enemies.map(formatEnemy).join("\n\n");
    const idx = String(3 + i).padStart(2, "0");
    await writeBundle({
      outDir,
      name: `${idx}-enemies-${slugify(batch.name)}`,
      spec,
      referenceImage: REFERENCES.enemies,
      prompt: [
        lightContext(spec),
        "",
        "Task: Generate a 4×4 enemy sprite sheet for this dimension. The attached reference.jpeg shows the equivalent sheet from the starter dimension — match its style exactly: same parchment background, same hand-drawn linework, same color quality, same character proportions, same animation poses.",
        "",
        "The image must be a 4×4 grid:",
        "  - COLUMNS are 4 different enemies (column 1 = first enemy, column 2 = second, etc.)",
        "  - ROWS are 4 animation poses (row 1 = idle, row 2 = attacking, row 3 = hit/staggered, row 4 = moving)",
        "  - Each enemy is consistent across its column (same character drawn 4 different ways)",
        "  - All characters must face to the RIGHT",
        "",
        `This batch is the "${batch.name}" tier: ${batch.description}`,
        "",
        "The 4 enemies in this batch (one per column, in this order):",
        "",
        enemyList,
      ].join("\n"),
    });
  }

  // 7. Map decorations (world-map / hex-map terrain icons)
  await writeBundle({
    outDir,
    name: "07-map-decorations",
    spec,
    referenceImage: REFERENCES.mapDecorations,
    prompt: [
      dimensionContext(spec),
      "",
      "Task: Generate a decoration sprite sheet for this new dimension. The attached reference.jpeg shows the equivalent sheet from the starter dimension — match its hand-drawn linework, color saturation, isometric three-quarter perspective, and drop shadows. Ignore the reference's parchment background.",
      "",
      "Important: Use a variety of colors across the decorations — not everything should be the same color as the dimension palette. Natural environments have diverse coloring, so include variety (e.g. different plant greens, browns, grays for rocks, varied flower colors).",
    ].join("\n"),
  });

  // 8. Items. Structured roster required — freeform strings are not parsed.
  if (!Array.isArray(spec.items)) {
    throw new Error("spec.items must be a structured array. Freeform item strings are no longer supported.");
  }
  const itemListText = spec.items.map(formatItem).join("\n");
  await writeBundle({
    outDir,
    name: "08-items",
    spec,
    referenceImage: REFERENCES.items,
    prompt: [
      lightContext(spec),
      "",
      "Task: Generate a 4×4 item sprite sheet for this dimension. The attached reference.png shows the equivalent sheet from the starter dimension — match its style exactly: same parchment background, same hand-drawn linework, same color quality, same isolated-on-page item presentation.",
      "",
      "The image must be a 4×4 grid where each cell contains exactly one item. Items should be drawn in a consistent orientation (most pointing diagonally up-right). No animations — each cell is a still item portrait.",
      "",
      "Items in reading order (left-to-right, top-to-bottom):",
      itemListText,
    ].join("\n"),
  });

  // Copy send-to-chatgpt.sh into the bundle
  const sendScript = join(SCRIPT_DIR, "diffusion-bundles", "send-to-chatgpt.sh");
  if (existsSync(sendScript)) {
    await copyFile(sendScript, join(outDir, "send-to-chatgpt.sh"));
  }

  console.log(`\n✓ Built bundles in ${outDir}`);
  return outDir;
}

async function build(specPath: string): Promise<string> {
  const specRaw = await Bun.file(specPath).text();
  const spec: DimensionSpec = JSON.parse(specRaw);
  return buildFromSpec(spec);
}

export { build as buildDiffusionBundles, buildFromSpec };

// Only run as CLI if this file is the main module
if (import.meta.main) {
  const specArg = process.argv[2];
  if (specArg) {
    await build(resolve(specArg));
  }
}
