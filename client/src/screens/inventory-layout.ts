import type { SlotType } from "shared";
import regionsData from "../../public/sprites/ui/inventory-panel-regions.json";

export interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ItemPosition {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export type InfoTarget =
  | { source: "bag"; index: number }
  | { source: "equipped"; id: string }
  | null;

export type InteractionMode =
  | { type: "idle" }
  | { type: "dragging"; offsetX: number; offsetY: number }
  | { type: "rotating"; startAngle: number; startRotation: number }
  | { type: "bag-pending"; bagIndex: number; startX: number; startY: number };

const REGIONS: Region[] = regionsData.regions;

export const PANEL_W = 806;
export const PANEL_H = 895;
export const UI_SCALE = 1.25;
export const TARGET_SIZE = 64;
export const HANDLE_STEM = 28;
export const HANDLE_RADIUS = 11;

export const SLOT_REGIONS = REGIONS.filter((r) => r.name.startsWith("slot-"));
export const CLOSE_REGION = REGIONS.find((r) => r.name === "close-button")!;
export const CHAR_REGION = REGIONS.find((r) => r.name === "character-area")!;

export const RARITY_COLORS: Record<string, string> = {
  common: "#8b8b7a",
  uncommon: "#5a7a3a",
  rare: "#4a6ab0",
  epic: "#8a4ab0",
  legendary: "#c47030",
};

export const TYPE_BASE_SCALE: Record<string, number> = {
  weapon: 2.5,
  shield: 2.5,
  consumable: 0.7,
  accessory: 0.8,
};

export const SLOT_LABELS: { type: SlotType; label: string }[] = [
  { type: "hand", label: "Hand" },
  { type: "hat", label: "Hat" },
  { type: "utility", label: "Util" },
  { type: "accessory", label: "Acc" },
];

export function hitRegion(px: number, py: number, r: Region): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function getItemSize(
  pos: ItemPosition,
  item: { visualScale?: number; type: string; sprite: string },
  loadedSprite: HTMLImageElement | null,
): { w: number; h: number } {
  const baseScale = item.visualScale ?? TYPE_BASE_SCALE[item.type] ?? 1;
  if (loadedSprite) {
    const maxDim = Math.max(loadedSprite.naturalWidth, loadedSprite.naturalHeight);
    const normalize = TARGET_SIZE / maxDim;
    return {
      w: loadedSprite.naturalWidth * normalize * baseScale * pos.scale,
      h: loadedSprite.naturalHeight * normalize * baseScale * pos.scale,
    };
  }
  return { w: TARGET_SIZE * baseScale * pos.scale, h: TARGET_SIZE * baseScale * pos.scale };
}

export function getRotateHandlePos(pos: ItemPosition, itemH: number): { x: number; y: number } {
  const dist = itemH / 2 + 3 + HANDLE_STEM + HANDLE_RADIUS;
  const rad = pos.rotation * (Math.PI / 180);
  return {
    x: pos.x + Math.sin(rad) * dist,
    y: pos.y - Math.cos(rad) * dist,
  };
}
