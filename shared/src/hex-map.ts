export interface HexCoord {
  readonly q: number;
  readonly r: number;
}

export type HexStatus = "unexplored" | "explored";

export const HEX_ICON_TYPES = [
  "town",
  "city",
  "gateway",
  "gateway-city",
  "ruins",
  "great-ruins",
  "enemy-camp",
  "elite-encounter",
  "boss",
  "calamity",
  "treasure",
  "great-treasure",
] as const;

export type HexIconType = (typeof HEX_ICON_TYPES)[number];

export interface HexMapState {
  readonly playerPos: HexCoord;
  readonly hexes: Record<string, HexStatus>;
  readonly icons: Record<string, HexIconType>;
}

export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function parseHexKey(key: string): HexCoord {
  const parts = key.split(",");
  return { q: Number(parts[0]), r: Number(parts[1]) };
}

const NEIGHBOR_OFFSETS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
];

export function hexNeighbors(coord: HexCoord): HexCoord[] {
  return NEIGHBOR_OFFSETS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

export function isAdjacent(a: HexCoord, b: HexCoord): boolean {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  return NEIGHBOR_OFFSETS.some((d) => d.q === dq && d.r === dr);
}

import { HEX_SPAWN_TABLE, HEX_SPAWN_WEIGHT_TOTAL } from "./hex-config.js";

function pickIconForHex(coord: HexCoord): HexIconType | null {
  const seed = ((coord.q * 7919 + coord.r * 104729 + 5381) & 0xffffffff) >>> 0;
  const roll = (seed % 10000) / 10000 * HEX_SPAWN_WEIGHT_TOTAL;
  let acc = 0;
  for (const entry of HEX_SPAWN_TABLE) {
    acc += entry.weight;
    if (roll < acc) return entry.type;
  }
  return null;
}

export function getHexIcon(coord: HexCoord, icons: Record<string, HexIconType>): HexIconType | null {
  const k = hexKey(coord);
  if (k in icons) return icons[k]!;
  return pickIconForHex(coord);
}

export function createInitialHexMap(): HexMapState {
  const origin: HexCoord = { q: 0, r: 0 };
  const hexes: Record<string, HexStatus> = { [hexKey(origin)]: "explored" };
  const icons: Record<string, HexIconType> = { [hexKey(origin)]: "town" };
  return { playerPos: origin, hexes, icons };
}

export function getVisibleHexes(state: HexMapState): Record<string, HexStatus> {
  const visible: Record<string, HexStatus> = {};
  for (const [key, status] of Object.entries(state.hexes)) {
    visible[key] = status;
    const coord = parseHexKey(key);
    if (status === "explored") {
      for (const neighbor of hexNeighbors(coord)) {
        const nk = hexKey(neighbor);
        if (!(nk in visible) && !(nk in state.hexes)) {
          visible[nk] = "unexplored";
        }
      }
    }
  }
  return visible;
}

const SQRT3 = Math.sqrt(3);

export function hexToPixel(coord: HexCoord, size: number): { x: number; y: number } {
  return {
    x: size * (SQRT3 * coord.q + (SQRT3 / 2) * coord.r),
    y: size * (1.5 * coord.r),
  };
}

export function pixelToHex(x: number, y: number, size: number): HexCoord {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

const DECORATION_DENSITY = 0.18;

function hexSeededUnit(coord: HexCoord, salt: number): number {
  let seed = Math.imul(coord.q, 374761393) ^ Math.imul(coord.r, 668265263) ^ Math.imul(salt, 2246822519);
  seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
  return ((seed ^ (seed >>> 16)) >>> 0) / 0xffffffff;
}

export function isDecorationHex(coord: HexCoord): boolean {
  return hexSeededUnit(coord, 11) <= DECORATION_DENSITY;
}

function hexRound(q: number, r: number): HexCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}
