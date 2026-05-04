export interface HexCoord {
  readonly q: number;
  readonly r: number;
}

export type HexStatus = "unexplored" | "explored";

export interface HexMapState {
  readonly playerPos: HexCoord;
  readonly hexes: Record<string, HexStatus>;
}

export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function parseHexKey(key: string): HexCoord {
  const [q, r] = key.split(",").map(Number);
  return { q, r };
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

export function createInitialHexMap(): HexMapState {
  const origin: HexCoord = { q: 0, r: 0 };
  const hexes: Record<string, HexStatus> = { [hexKey(origin)]: "explored" };
  return { playerPos: origin, hexes };
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
