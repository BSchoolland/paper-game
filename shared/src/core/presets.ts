import type { AttachmentData } from "./inventory.js";

/**
 * A lobby starter preset: a small, auto-equipped kit a player picks before a run. `equippedIds` /
 * `bagIds` are item IDs (resolved server-side against the loaded item registry); `attachments` is
 * optional hand-authored render data per equipped item (loadout editor "Export preset JSON" tool).
 * Items without an entry get a server-computed default hold pose (equip-defaults.ts) at equip time.
 */
export interface StarterPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly equippedIds: readonly string[];
  readonly bagIds: readonly string[];
  readonly attachments: Record<string, AttachmentData>;
}

export const STARTER_PRESETS: readonly StarterPreset[] = [
  {
    id: "vanguard",
    name: "Vanguard",
    description: "Sword and board — a durable frontliner that holds the line.",
    equippedIds: ["short-sword", "round-shield"],
    bagIds: ["potion"],
    attachments: {},
  },
  {
    id: "ranger",
    name: "Ranger",
    description: "Bow and quiver — strike from range and kite the danger.",
    equippedIds: ["bow", "quiver"],
    bagIds: ["potion"],
    attachments: {},
  },
  {
    id: "mystic",
    name: "Mystic",
    description: "Staff and spellbook — zones, bolts, and battlefield control.",
    equippedIds: ["staff", "spellbook"],
    bagIds: ["potion", "bomb"],
    attachments: {},
  },
];

export const DEFAULT_PRESET_ID = STARTER_PRESETS[0]!.id;

export function getPreset(presetId: string): StarterPreset | null {
  return STARTER_PRESETS.find((p) => p.id === presetId) ?? null;
}
