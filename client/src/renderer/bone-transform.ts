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

export interface AttachmentData {
  boneName: string;
  attachEnd: "from" | "to";
  localOffsetAlong: number; // normalized to reference frame height
  localOffsetPerp: number;  // normalized to reference frame height
  scale: number;
  rotation: number;
  referenceFrame: string;
}

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

function boneAngle(anchors: Partial<AnchorSet>, bone: BoneDef): number {
  const from = anchors[bone.from];
  const to = anchors[bone.to];
  if (!from || !to) return Math.PI / 2;
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

function boneLength(anchors: Partial<AnchorSet>, bone: BoneDef): number {
  const from = anchors[bone.from];
  const to = anchors[bone.to];
  if (!from || !to) return 1;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return Math.sqrt(dx * dx + dy * dy);
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
