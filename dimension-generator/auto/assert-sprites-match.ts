#!/usr/bin/env bun
// Content-level gate: verify each enemy's EXTRACTED idle sprite actually depicts its labeled creature,
// using a vision model judged against the spec's visual description. Complements assert-dimension-
// playable, which only checks file existence — that one passed dim 700 while every boss sprite was the
// wrong creature. Judges by KIND of creature (lenient on art/wording) to avoid false positives.
import OpenAI from "openai";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { slugify } from "../slugify.js";
import { SERVER_SPRITES_DIR } from "../../shared/src/paths.js";

const MODEL = process.env.CONTENT_CHECK_MODEL ?? "gpt-4o-mini";
const SPRITES_ROOT = process.env.GAME_SPRITES_ROOT ?? SERVER_SPRITES_DIR;

const [dimIdArg, specPathArg] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !specPathArg) throw new Error("usage: assert-sprites-match.ts <dimId> <specPath>");

const spec = JSON.parse(await Bun.file(specPathArg).text());
if (!Array.isArray(spec.enemyBatches)) throw new Error("spec.enemyBatches missing — structured spec required");

let openai: OpenAI | undefined;
const client = () => (openai ??= new OpenAI());

async function depicts(spritePath: string, name: string, description: string): Promise<{ match: boolean; actual: string }> {
  const b64 = Buffer.from(await Bun.file(spritePath).arrayBuffer()).toString("base64");
  const resp = await client().chat.completions.create({
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text:
          `This is a hand-drawn game enemy sprite. It is meant to depict "${name}"` +
          (description ? `, described as: ${description}` : "") + ".\n" +
          `Does the drawing plausibly show that — the same KIND of creature? Be lenient on art style and exact wording ` +
          `(a "Frost Wyrm" drawn as an ice dragon, or a "Frost Lich" drawn as a robed skeleton, both COUNT as matches). ` +
          `Mark match=false only if it is clearly a different kind of creature (e.g. a wolf where a mammoth is expected).\n` +
          `Respond ONLY as JSON: {"actual":"<what you see, a few words>","match":true|false}` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
    response_format: { type: "json_object" },
  });
  return JSON.parse(resp.choices[0]!.message.content!);
}

const mismatches: string[] = [];
let checked = 0;
for (const batch of spec.enemyBatches) {
  for (const e of batch.enemies) {
    const id = slugify(e.name);
    const sprite = join(SPRITES_ROOT, "enemies", `dimension-${dimId}`, `${id}-idle.png`);
    if (!existsSync(sprite)) { mismatches.push(`${e.name} (${id}): idle sprite missing`); continue; }
    const v = await depicts(sprite, e.name, e.description ?? "");
    checked++;
    if (!v.match) mismatches.push(`${e.name}: drawn as "${v.actual}"`);
    console.error(`  ${v.match ? "ok " : "MISMATCH"}  ${e.name} -> ${v.actual}`);
  }
}

console.log(JSON.stringify({ dimId, name: spec.name, model: MODEL, checked, spritesMatch: mismatches.length === 0, mismatches }, null, 2));
if (mismatches.length > 0) process.exit(1);
