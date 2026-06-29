#!/usr/bin/env bun
/**
 * Push a dimension's encounter map art to the CDN bucket (CloudFront/S3). Only
 * the large PNGs go up — collision masks and manifest.json stay local because
 * the server reads masks directly off disk for collision. Idempotent: re-runs
 * re-sync only changed files.
 *
 *   bun dimension-generator/auto/upload-maps-s3.ts <dimId>
 */
import { join } from "node:path";
import { $ } from "bun";

const BUCKET = "schoolland-tbg-maps";
const ROOT = join(import.meta.dir, "..", "..");

export async function uploadMaps(dimId: number): Promise<void> {
  const local = join(ROOT, "client/public/sprites/maps", `dimension-${dimId}`);
  const dest = `s3://${BUCKET}/sprites/maps/dimension-${dimId}/`;
  await $`aws s3 sync ${local} ${dest} --exclude ${"*.mask.png"} --exclude ${"manifest.json"} --no-progress`;
  console.log(`Uploaded dimension-${dimId} map art to ${dest}`);
}

if (import.meta.main) {
  const dimId = Number(process.argv[2]);
  if (!Number.isFinite(dimId)) {
    console.error("Usage: bun upload-maps-s3.ts <dimId>");
    process.exit(1);
  }
  await uploadMaps(dimId);
}
