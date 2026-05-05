import type { HexIconType } from "./hex-map.js";

export interface HexSpawnEntry {
  type: HexIconType | null;
  weight: number;
}

export const HEX_SPAWN_TABLE: readonly HexSpawnEntry[] = [
  { type: null,               weight: 70 },
  { type: "enemy-camp",       weight: 8 },
  { type: "ruins",            weight: 5 },
  { type: "treasure",         weight: 4 },
  { type: "town",             weight: 3 },
  { type: "elite-encounter",  weight: 2 },
  { type: "gateway",          weight: 2 },
  { type: "great-ruins",      weight: 1.5 },
  { type: "city",             weight: 1 },
  { type: "gateway-city",     weight: 1 },
  { type: "great-treasure",   weight: 0.7 },
  { type: "boss",             weight: 0.5 },
  { type: "calamity",         weight: 0.3 },
];

export const HEX_SPAWN_WEIGHT_TOTAL = HEX_SPAWN_TABLE.reduce((s, e) => s + e.weight, 0);
