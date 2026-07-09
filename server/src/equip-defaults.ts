// Precomputed default item placements. At boot we decode every item sprite (sharp, downsampled
// alpha mask) and derive its hold pose: where the grip is inside the sprite and how it hangs.
// The equip/preset/rehydrate write points then bake a default AttachmentData for any equipped
// item the player hasn't placed, so items always render on the doll. Player-authored
// attachments are never overwritten.
//
// Grip conventions (from the sprite-sheet prompt: items point diagonally up-right):
//   bow-center   — bows are gripped mid-limb: the thick opaque pixel nearest the sprite center
//                  (the string is thin and gets eroded away), flipped 180° to read as held.
//   handle-end   — swords/spears/staves: 20% in from the bottom-left end of the principal axis.
//   sprite-center — shields, hats, accessories, consumables.

import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTACHMENT_REFERENCE_FRAME,
  BONES,
  ITEM_TARGET_SIZE,
  TYPE_BASE_SCALE,
  boneAngle,
  equipTargets,
  gripKindFor,
  type AnchorSet,
  type AttachmentData,
  type CharacterAnchors,
  type EquipTarget,
  type GripKind,
  type InventoryState,
  type ItemDefinition,
} from "shared";
import { ASSETS_DIR } from "../../shared/src/paths.js";
import { listDimensions, loadItems } from "./db.js";

const anchors: CharacterAnchors = JSON.parse(
  readFileSync(join(ASSETS_DIR, "sprites/char1/anchors.json"), "utf8"),
);
const refFrameOrNull = anchors.frames[ATTACHMENT_REFERENCE_FRAME];
if (!refFrameOrNull) throw new Error(`anchors.json has no "${ATTACHMENT_REFERENCE_FRAME}" frame`);
const refFrame = refFrameOrNull;

const panelRegions: { regions: { name: string; w: number; h: number }[] } = JSON.parse(
  readFileSync(join(ASSETS_DIR, "sprites/ui/inventory-panel-regions.json"), "utf8"),
);
const charRegion = panelRegions.regions.find((r) => r.name === "character-area");
if (!charRegion) throw new Error("inventory-panel-regions.json has no character-area region");

/** How the pack editor fits the doll into its panel region — default scale matches "editor scale 1". */
const PANEL_CHAR_SCALE = Math.min(charRegion.w / refFrame.width, charRegion.h / refFrame.height);

/** Grip point and dimensions of an item sprite, normalized: dims by max dimension (so hN is the
 *  draw-height factor), grip by sprite width/height. */
interface HoldPose {
  wN: number;
  hN: number;
  gripX: number;
  gripY: number;
}

/** null = decode failed or still pending: buildDefaultAttachment falls back to a centered square. */
const poses = new Map<string, HoldPose | null>();

function poseKey(item: ItemDefinition): string {
  return `${item.dimensionId}/${item.sprite}:${gripKindFor(item)}`;
}

function spritePath(item: ItemDefinition): string | null {
  const prefix = item.dimensionId === 0 ? "" : `dimension-${item.dimensionId}/`;
  const rel = `sprites/items/${prefix}${item.sprite}`;
  for (const ext of ["png", "webp"]) {
    const abs = join(ASSETS_DIR, `${rel}.${ext}`);
    if (existsSync(abs)) return abs;
  }
  return null;
}

const MASK_MAX = 96;
const ALPHA_THRESHOLD = 32;

/** Exported for tests. */
export async function computeHoldPose(absPath: string, grip: GripKind): Promise<HoldPose> {
  const { data, info } = await sharp(absPath)
    .ensureAlpha()
    .resize(MASK_MAX, MASK_MAX, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const dw = info.width;
  const dh = info.height;
  const ch = info.channels;
  const mask = new Uint8Array(dw * dh);
  let minX = dw, minY = dh, maxX = -1, maxY = -1;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (data[(y * dw + x) * ch + 3]! >= ALPHA_THRESHOLD) {
        mask[y * dw + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const maxDim = Math.max(dw, dh);
  const base = { wN: dw / maxDim, hN: dh / maxDim };
  if (maxX < 0) return { ...base, gripX: 0.5, gripY: 0.5 };

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  if (grip === "bow-center") {
    const limb = bowLimbPoint(data, dw, dh, ch, cx, cy);
    if (limb) return { ...base, gripX: (limb.x + 0.5) / dw, gripY: (limb.y + 0.5) / dh };
    // No dark run up-left of center (unconventional art): fall back to thick-nearest-center.
  }

  const target = grip === "handle-end" ? handleEndPoint(mask, dw, dh, cx, cy) : { x: cx, y: cy };
  const candidates = grip === "bow-center" ? thickPixels(mask, dw, dh) : mask;

  // Snap the target to the nearest qualifying opaque pixel.
  let best = -1;
  let bestD = Infinity;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (!candidates[y * dw + x]) continue;
      const d = (x - target.x) ** 2 + (y - target.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = y * dw + x;
      }
    }
  }
  if (best < 0) return { ...base, gripX: 0.5, gripY: 0.5 };
  return { ...base, gripX: (best % dw + 0.5) / dw, gripY: (Math.floor(best / dw) + 0.5) / dh };
}

/**
 * Mid-limb grip of a bow. Bows are authored with the wooden arc bulging up-left of the string
 * diagonal, but extraction styles differ: some sprites have a transparent interior, others keep
 * it as opaque near-white page fill. Alpha alone can't separate wood from fill, so walk a ray
 * from the shape center toward up-left and take the LAST run of dark opaque pixels — the limb
 * (or at minimum its inked outline). Gaps ≤3px are bridged so pale wood between outline strokes
 * doesn't split the run.
 */
function bowLimbPoint(
  data: Buffer,
  dw: number,
  dh: number,
  ch: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const DARK_LUMA = 200;
  const step = Math.SQRT1_2; // one pixel per step along the (-1,-1) diagonal
  const maxT = Math.hypot(dw, dh);
  let runStart = -1;
  let lastDark = -1;
  let bestRun: { start: number; end: number } | null = null;
  for (let t = 0; t * step < maxT; t++) {
    const x = Math.round(cx - t * step);
    const y = Math.round(cy - t * step);
    if (x < 0 || y < 0) break;
    const i = (y * dw + x) * ch;
    const dark =
      data[i + 3]! >= ALPHA_THRESHOLD &&
      0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! < DARK_LUMA;
    if (dark) {
      if (runStart < 0 || t - lastDark > 3) runStart = t;
      lastDark = t;
      bestRun = { start: runStart, end: t };
    }
  }
  if (!bestRun) return null;
  const mid = (bestRun.start + bestRun.end) / 2;
  return { x: cx - mid * step, y: cy - mid * step };
}

/** Erosion depth via two-pass city-block distance to transparency; keep pixels at least half as
 *  deep as the thickest point (min 2px), which drops the bowstring but keeps the limbs. */
function thickPixels(mask: Uint8Array, dw: number, dh: number): Uint8Array {
  const depth = new Int32Array(dw * dh);
  const big = dw + dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = y * dw + x;
      if (!mask[i]) continue;
      const left = x > 0 ? depth[i - 1]! : 0;
      const up = y > 0 ? depth[i - dw]! : 0;
      depth[i] = Math.min(big, left + 1, up + 1);
    }
  }
  let maxDepth = 0;
  for (let y = dh - 1; y >= 0; y--) {
    for (let x = dw - 1; x >= 0; x--) {
      const i = y * dw + x;
      if (!mask[i]) continue;
      const right = x < dw - 1 ? depth[i + 1]! : 0;
      const down = y < dh - 1 ? depth[i + dw]! : 0;
      depth[i] = Math.min(depth[i]!, right + 1, down + 1);
      if (depth[i]! > maxDepth) maxDepth = depth[i]!;
    }
  }
  const cutoff = Math.max(2, Math.ceil(maxDepth / 2));
  const out = new Uint8Array(dw * dh);
  for (let i = 0; i < out.length; i++) out[i] = depth[i]! >= cutoff ? 1 : 0;
  return out;
}

/** Grip of a straight weapon: principal axis of the opaque pixels, oriented tip-up-right per the
 *  authoring convention, grip 20% in from the handle (bottom-left) end. */
function handleEndPoint(
  mask: Uint8Array,
  dw: number,
  dh: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  let n = 0, mx = 0, my = 0;
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++)
      if (mask[y * dw + x]) { n++; mx += x; my += y; }
  if (n === 0) return { x: cx, y: cy };
  mx /= n;
  my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (!mask[y * dw + x]) continue;
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
  }
  let vx: number, vy: number;
  if (Math.abs(sxy) < 1e-6) {
    [vx, vy] = sxx >= syy ? [1, 0] : [0, 1];
  } else {
    const lambda = (sxx + syy) / 2 + Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
    vx = sxy;
    vy = lambda - sxx;
    const len = Math.hypot(vx, vy);
    vx /= len;
    vy /= len;
  }
  // Image y grows downward: "tip points up-right" means vx - vy > 0.
  if (vx - vy < 0) {
    vx = -vx;
    vy = -vy;
  }
  let tMin = Infinity, tMax = -Infinity;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (!mask[y * dw + x]) continue;
      const t = (x - mx) * vx + (y - my) * vy;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
  }
  const gripT = tMin + 0.2 * (tMax - tMin);
  return { x: mx + vx * gripT, y: my + vy * gripT };
}

async function computePoseForItem(item: ItemDefinition): Promise<HoldPose | null> {
  const abs = spritePath(item);
  if (!abs) {
    console.warn(`[equip-defaults] no sprite on disk for ${item.id} (${item.dimensionId}/${item.sprite})`);
    return null;
  }
  try {
    return await computeHoldPose(abs, gripKindFor(item));
  } catch (err) {
    console.warn(`[equip-defaults] failed to decode ${abs}:`, err);
    return null;
  }
}

/** Decode every known item sprite once at boot so the (sync) equip write points can bake defaults. */
export async function precomputeHoldPoses(): Promise<void> {
  const t0 = performance.now();
  let ok = 0, failed = 0;
  for (const dim of listDimensions()) {
    const items = Object.values(loadItems(dim.id));
    await Promise.all(
      items.map(async (item) => {
        const key = poseKey(item);
        if (poses.has(key)) return;
        poses.set(key, null); // claim before the await so concurrent entries don't double-decode
        const pose = await computePoseForItem(item);
        poses.set(key, pose);
        pose ? ok++ : failed++;
      }),
    );
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`[equip-defaults] precomputed ${ok} hold poses in ${ms}ms${failed > 0 ? ` (${failed} failed)` : ""}`);
}

function buildDefaultAttachment(
  item: ItemDefinition,
  target: EquipTarget,
  pose: HoldPose | null,
): AttachmentData {
  const bone = BONES[target.boneName]!;
  const frameAnchors = refFrame.anchors as Partial<AnchorSet>;
  const refH = refFrame.height;
  const ang = boneAngle(frameAnchors, bone);
  const from = frameAnchors[bone.from];
  const to = frameAnchors[bone.to];
  const boneLen = from && to ? Math.hypot(to[0] - from[0], to[1] - from[1]) : 0;

  const baseScale = item.visualScale ?? TYPE_BASE_SCALE[item.type] ?? 1;
  const wN = pose?.wN ?? 1;
  const hN = pose?.hN ?? 1;
  const scale = (hN * ITEM_TARGET_SIZE * baseScale) / (refH * PANEL_CHAR_SCALE);

  // Offset the sprite center from the anchor so the grip pixel lands exactly on the anchor.
  const itemH = scale * refH;
  const itemW = itemH * (wN / hN);
  const ox = (0.5 - (pose?.gripX ?? 0.5)) * itemW;
  const oy = (0.5 - (pose?.gripY ?? 0.5)) * itemH;
  const rad = (target.rotation * Math.PI) / 180;
  const dx = ox * Math.cos(rad) - oy * Math.sin(rad);
  const dy = ox * Math.sin(rad) + oy * Math.cos(rad);
  const sign = target.attachEnd === "from" ? 1 : -1;

  return {
    boneName: target.boneName,
    attachEnd: target.attachEnd,
    localOffsetAlong:
      ((dx * Math.cos(ang) + dy * Math.sin(ang)) * sign + (target.alongFraction ?? 0) * boneLen) / refH,
    localOffsetPerp: ((-dx * Math.sin(ang) + dy * Math.cos(ang)) * sign) / refH,
    scale,
    rotation: target.rotation,
    referenceFrame: ATTACHMENT_REFERENCE_FRAME,
  };
}

/** Bake default attachments for equipped items the player hasn't placed. Authored entries win. */
export function withDefaultAttachments(inv: InventoryState): InventoryState {
  const missing = inv.equipped.filter((item) => !inv.attachments[item.id]);
  if (missing.length === 0) return inv;

  const targets = equipTargets(inv.equipped);
  const attachments = { ...inv.attachments };
  for (const item of missing) {
    const key = poseKey(item);
    let pose = poses.get(key);
    if (pose === undefined) {
      // Not seen at boot (e.g. a codex snapshot from a since-removed dimension): place centered
      // now, and decode in the background so the next equip of this item is exact.
      console.warn(`[equip-defaults] no precomputed pose for ${item.id}; using centered default`);
      poses.set(key, null);
      void computePoseForItem(item).then((p) => poses.set(key, p));
      pose = null;
    }
    attachments[item.id] = buildDefaultAttachment(item, targets.get(item.id)!, pose);
  }
  return { equipped: inv.equipped, attachments };
}
