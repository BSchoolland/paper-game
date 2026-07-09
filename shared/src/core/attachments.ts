import type { AttachmentData } from "./inventory.js";

// Bone-relative item attachment math, shared by the web renderer/pack editor and the
// server's default-placement precompute. Anchor coordinates live in per-frame pixel
// space (anchors.json); AttachmentData stores offsets normalized to the reference
// frame's height so placements transfer across animation frames.

export type AnchorName =
  | "head"
  | "chest"
  | "r_shoulder"
  | "l_shoulder"
  | "belt"
  | "r_hip"
  | "l_hip"
  | "r_hand"
  | "l_hand"
  | "r_foot"
  | "l_foot";

export type AnchorSet = Record<AnchorName, [number, number]>;

export interface BoneDef {
  from: AnchorName;
  to: AnchorName;
}

export const BONES: Record<string, BoneDef> = {
  spine: { from: "head", to: "chest" },
  torso: { from: "chest", to: "belt" },
  r_collar: { from: "chest", to: "r_shoulder" },
  l_collar: { from: "chest", to: "l_shoulder" },
  r_arm: { from: "r_shoulder", to: "r_hand" },
  l_arm: { from: "l_shoulder", to: "l_hand" },
  r_pelvis: { from: "belt", to: "r_hip" },
  l_pelvis: { from: "belt", to: "l_hip" },
  r_leg: { from: "r_hip", to: "r_foot" },
  l_leg: { from: "l_hip", to: "l_foot" },
};

export const ANCHOR_NAMES: AnchorName[] = [
  "head",
  "chest",
  "r_shoulder",
  "l_shoulder",
  "belt",
  "r_hip",
  "l_hip",
  "r_hand",
  "l_hand",
  "r_foot",
  "l_foot",
];

export interface CharacterAnchors {
  version: number;
  character: string;
  bones: Record<string, { from: string; to: string }>;
  frames: Record<
    string,
    {
      width: number;
      height: number;
      anchors: Partial<AnchorSet>;
    }
  >;
}

/** The frame every attachment is authored against (the pack editor's paper doll). */
export const ATTACHMENT_REFERENCE_FRAME = "inventory-idle";

/** Item draw size at editor scale 1: sprite max-dimension maps to this many panel px. */
export const ITEM_TARGET_SIZE = 64;

export const TYPE_BASE_SCALE: Record<string, number> = {
  weapon: 2.5,
  shield: 2.5,
  consumable: 0.7,
  accessory: 0.8,
};

export function boneAngle(anchors: Partial<AnchorSet>, bone: BoneDef): number {
  const from = anchors[bone.from];
  const to = anchors[bone.to];
  if (!from || !to) return 0;
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

export function transformAttachment(
  attachment: AttachmentData,
  refAnchors: Partial<AnchorSet>,
  targetAnchors: Partial<AnchorSet>,
  targetHeight: number,
): { x: number; y: number; rotation: number } {
  const bone = BONES[attachment.boneName];
  if (!bone) return { x: 0, y: 0, rotation: 0 };

  const endName = attachment.attachEnd === "to" ? bone.to : bone.from;
  const refAnchor = refAnchors[endName];
  const targetAnchor = targetAnchors[endName];
  if (!refAnchor || !targetAnchor) return { x: 0, y: 0, rotation: 0 };

  const refAngle = boneAngle(refAnchors, bone);
  const targetAngle = boneAngle(targetAnchors, bone);
  const sign = attachment.attachEnd === "from" ? 1 : -1;

  const along = attachment.localOffsetAlong * targetHeight * sign;
  const perp = attachment.localOffsetPerp * targetHeight * sign;

  const offX = Math.cos(targetAngle) * along - Math.sin(targetAngle) * perp;
  const offY = Math.sin(targetAngle) * along + Math.cos(targetAngle) * perp;

  const angleDelta = targetAngle - refAngle;

  return {
    x: targetAnchor[0] + offX,
    y: targetAnchor[1] + offY,
    rotation: attachment.rotation + angleDelta * (180 / Math.PI),
  };
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const d = Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    return { dist: d, t: 0 };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  return { dist, t };
}

/** Author an attachment from a drop point on the reference frame: snap to the nearest bone. */
export function computeAttachment(
  dropX: number,
  dropY: number,
  anchors: Partial<AnchorSet>,
  referenceFrame: string,
  refHeight: number,
  scale = 1,
  rotation = 0,
): AttachmentData {
  let bestBone = "spine";
  let bestDist = Infinity;
  let bestAlong = 0;
  let bestPerp = 0;
  let bestEnd: "from" | "to" = "from";

  for (const [boneName, bone] of Object.entries(BONES)) {
    const from = anchors[bone.from];
    const to = anchors[bone.to];
    if (!from || !to) continue;

    const { dist } = distToSegment(
      dropX,
      dropY,
      from[0],
      from[1],
      to[0],
      to[1],
    );

    if (dist < bestDist) {
      bestDist = dist;
      bestBone = boneName;

      const angle = boneAngle(anchors, bone);
      const dFrom = Math.hypot(dropX - from[0], dropY - from[1]);
      const dTo = Math.hypot(dropX - to[0], dropY - to[1]);
      const anchor = dFrom <= dTo ? from : to;
      bestEnd = dFrom <= dTo ? "from" : "to";
      const offX = dropX - anchor[0];
      const offY = dropY - anchor[1];
      const sign = bestEnd === "from" ? 1 : -1;
      bestAlong = (offX * Math.cos(angle) + offY * Math.sin(angle)) * sign / Math.max(refHeight, 1);
      bestPerp = (-offX * Math.sin(angle) + offY * Math.cos(angle)) * sign / Math.max(refHeight, 1);
    }
  }

  return {
    boneName: bestBone,
    attachEnd: bestEnd,
    localOffsetAlong: bestAlong,
    localOffsetPerp: bestPerp,
    scale,
    rotation,
    referenceFrame,
  };
}

/** Where a bone-anchored sprite's grip should sit, and how it hangs there. */
export interface EquipTarget {
  boneName: string;
  attachEnd: "from" | "to";
  rotation: number;
  grip: GripKind;
  /** Slide the anchor point this fraction down the bone (0 = at the attach end). */
  alongFraction?: number;
}

/** How to find the hold point inside an item sprite's pixels. */
export type GripKind = "bow-center" | "handle-end" | "sprite-center";

interface EquipTargetItem {
  readonly id: string;
  readonly type: string;
  readonly slotCost: Partial<Record<string, number>>;
  readonly animSet?: string;
}

export function gripKindFor(item: { type: string; animSet?: string }): GripKind {
  if (item.type !== "weapon") return "sprite-center";
  return item.animSet === "bow" ? "bow-center" : "handle-end";
}

/**
 * Route each equipped item to a body location. Hand items go to the hands (weapons claim the
 * screen-right hand first, offhand kit the left); hats to the head, utility to the belt,
 * accessories to the chest. Bows are authored arc-up-left/string-down-right, so they flip 180°
 * to read as held; everything else keeps its authored diagonal.
 */
export function equipTargets(equipped: readonly EquipTargetItem[]): Map<string, EquipTarget> {
  const targets = new Map<string, EquipTarget>();
  const takenHands = new Set<string>();

  for (const item of equipped) {
    if ((item.slotCost.hand ?? 0) <= 0) continue;
    const preferred = item.type === "weapon" ? "r_arm" : "l_arm";
    const other = preferred === "r_arm" ? "l_arm" : "r_arm";
    const bone = !takenHands.has(preferred) ? preferred : !takenHands.has(other) ? other : preferred;
    takenHands.add(bone);
    const grip = gripKindFor(item);
    targets.set(item.id, {
      boneName: bone,
      attachEnd: "to",
      rotation: grip === "bow-center" ? 180 : 0,
      grip,
    });
  }

  for (const item of equipped) {
    if (targets.has(item.id)) continue;
    if ((item.slotCost.hat ?? 0) > 0) {
      targets.set(item.id, { boneName: "spine", attachEnd: "from", rotation: 0, grip: "sprite-center" });
    } else if ((item.slotCost.utility ?? 0) > 0) {
      targets.set(item.id, { boneName: "torso", attachEnd: "to", rotation: 0, grip: "sprite-center" });
    } else {
      // Chest anchor sits at scarf height; slide accessories down to mid-torso.
      targets.set(item.id, {
        boneName: "torso",
        attachEnd: "from",
        rotation: 0,
        grip: "sprite-center",
        alongFraction: 0.45,
      });
    }
  }

  return targets;
}
