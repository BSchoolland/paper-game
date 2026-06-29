#!/usr/bin/env bun
/**
 * Shared image-generation primitive for the dimension pipeline.
 *
 * One place that turns (prompt, optional style reference) into a PNG on disk, via either backend:
 *   - "codex": the Codex CLI's built-in image_gen — free via the ChatGPT subscription, fixed-high
 *     quality. The reference is attached with -i (it style-conditions the output); the prompt is fed
 *     over stdin because -i is variadic and would otherwise swallow it. codex infers the aspect from
 *     the prompt, so callers pass an aspectHint and resize afterwards when they need exact dimensions.
 *   - "api": OpenAI gpt-image-2 (paid). images.edit when a reference is given, else images.generate.
 *
 * Selected by ART_BACKEND (default "codex"). Both art-agent and map-agent route through generateImage,
 * so swapping backend is one env var in one place. Bun.spawn (not spawnSync) keeps the codex path
 * non-blocking, so callers can run several generations concurrently.
 */
import OpenAI from "openai";
import { extname } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export type ImageBackend = "codex" | "api";
export const ART_BACKEND = (process.env.ART_BACKEND ?? "codex").toLowerCase() as ImageBackend;

// Lazy so modules that only need the resize/extraction helpers import without OPENAI_API_KEY set.
let openai: OpenAI | undefined;
function getOpenAI(): OpenAI {
  return (openai ??= new OpenAI());
}

export interface GenerateImageOpts {
  prompt: string;
  outPath: string;
  referencePath?: string; // style/content reference image
  size?: string;          // API only, e.g. "1024x1024" | "1456x1088"
  quality?: string;       // API only
  aspectHint?: string;    // codex only, e.g. "SQUARE (1:1 aspect ratio)"
  label?: string;         // for error messages
}

async function viaApi(o: GenerateImageOpts): Promise<void> {
  const { prompt, outPath, referencePath, size = "1024x1024", quality = "low", label = outPath } = o;
  let res;
  if (referencePath) {
    const buf = await Bun.file(referencePath).arrayBuffer();
    const ext = extname(referencePath).toLowerCase() === ".png" ? "png" : "jpeg";
    const blob = new File([buf], `reference.${ext}`, { type: `image/${ext}` });
    res = await getOpenAI().images.edit({ model: "gpt-image-2", image: blob, prompt, n: 1, size: size as any, quality: quality as any });
  } else {
    res = await getOpenAI().images.generate({ model: "gpt-image-2", prompt, n: 1, size: size as any, quality: quality as any });
  }
  const img = res.data![0]!;
  if (img.b64_json) await Bun.write(outPath, Buffer.from(img.b64_json, "base64"));
  else if (img.url) await Bun.write(outPath, await (await fetch(img.url)).arrayBuffer());
  else throw new Error(`No image data for ${label}`);
}

async function viaCodex(o: GenerateImageOpts): Promise<void> {
  const { prompt, outPath, referencePath, aspectHint = "SQUARE (1:1 aspect ratio)", label = outPath } = o;
  const codexPrompt = [
    prompt,
    "",
    "Use your built-in image_gen tool (do NOT call a paid image API)." +
      (referencePath ? " Match the ATTACHED reference image's art style EXACTLY." : ""),
    `Render the image as ${aspectHint}.`,
    `Save the final PNG to this exact absolute path: ${outPath}`,
  ].join("\n");
  const args = ["exec", "--dangerously-bypass-approvals-and-sandbox"];
  if (referencePath) args.push("-i", referencePath);
  const proc = Bun.spawn(["codex", ...args], { stdin: Buffer.from(codexPrompt), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`codex exec failed for ${label} (exit ${exitCode}): ${(stderr || stdout).slice(-600)}`);
  if (!existsSync(outPath)) throw new Error(`codex produced no file at ${outPath} for ${label}. Output tail: ${stdout.slice(-600)}`);
}

// Generate an image to outPath via the configured backend. Does NOT resize — the caller owns any
// post-resize (sprite sheets force square; maps already come out at ~reference size).
export async function generateImage(o: GenerateImageOpts): Promise<void> {
  if (ART_BACKEND === "codex") return viaCodex(o);
  if (ART_BACKEND === "api") return viaApi(o);
  throw new Error(`Unknown ART_BACKEND "${ART_BACKEND}" (expected "codex" or "api")`);
}

// Force a PNG to an exact square (the sprite-sheet slicers assume square). Pads to square on white
// first so a non-square source is letterboxed, never distorted, then scales.
export function resizeToSquare(path: string, dim = 1024): void {
  const tmp = `${path}.tmp.png`;
  const vf = `pad=w=max(iw\\,ih):h=max(iw\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=white,scale=${dim}:${dim}:flags=lanczos`;
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path, "-frames:v", "1", "-vf", vf, tmp], { encoding: "utf-8" });
  if (r.status !== 0 || !existsSync(tmp)) throw new Error(`ffmpeg resize failed for ${path}: ${r.stderr || r.error}`);
  spawnSync("mv", [tmp, path]);
}
