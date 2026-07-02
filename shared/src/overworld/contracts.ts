/**
 * Contracts (docs/meta-loop/02-contracts.md §2-§3). Pure data + pure functions: the server
 * evaluates and persists a run's contract; the client resolves display copy from the same
 * catalog with zero fetches (the TITLES precedent). Exactly one contract lives on a run.
 */
import type { HexCoord, HexIconType } from "../map/hex-map.js";
import { getHexIcon } from "../map/hex-map.js";

export type ContractType = "slay-boss" | "recover-relic" | "activate-gateway" | "chart-hexes";

// --- Tunables (single table in §5) ---
export const CHART_HEX_COUNT = 10; // chart-hexes: hexes cleared this run (origin excluded)
export const CONTRACT_SCAN_MIN_RADIUS = 3; // targets closer than this are too trivial
export const CONTRACT_SCAN_MAX_RADIUS = 14; // ~631 hexes; icons are deterministic so this is cheap

export interface ContractDef {
  readonly id: ContractType;
  readonly name: string;
  readonly description: string;
  /** Accrued to pending on completion; banks at 1.0 with victory. */
  readonly xpReward: number;
}

export const CONTRACTS: readonly ContractDef[] = [
  { id: "slay-boss", name: "Slay the Tyrant", description: "Defeat the dweller of a boss lair.", xpReward: 150 },
  { id: "recover-relic", name: "Recover the Relic", description: "Win the marked great ruin or hoard.", xpReward: 120 },
  { id: "activate-gateway", name: "Light the Gateway", description: "Clear a gateway hex and kindle its portal.", xpReward: 100 },
  { id: "chart-hexes", name: "Chart the Wilds", description: `Clear ${CHART_HEX_COUNT} hexes in a single expedition.`, xpReward: 80 },
];

export function contractById(id: ContractType): ContractDef {
  const c = CONTRACTS.find((def) => def.id === id);
  if (!c) throw new Error(`contractById: unknown contract "${id}"`);
  return c;
}

/** The run's live contract state — persisted verbatim (runs.contract_json) and sent on the wire. */
export interface ContractState {
  readonly type: ContractType;
  /** recover-relic: THE required hex. slay-boss/activate-gateway: nearest-match HUD hint. chart-hexes: null. */
  readonly targetHex: HexCoord | null;
  /** The dimension targetHex lives in. recover-relic matches hex AND dimension, so clearing the
   *  same (q,r) after gateway travel (04-portals) cannot false-complete it. Null iff targetHex is. */
  readonly targetDimensionId: number | null;
  /** 0/1 for the three single-goal types; cleared count for chart-hexes. */
  readonly progress: number;
  readonly required: number; // 1, or CHART_HEX_COUNT
  readonly completed: boolean;
}

export function createContractState(
  type: ContractType,
  targetHex: HexCoord | null,
  targetDimensionId: number | null,
): ContractState {
  if (type === "recover-relic" && (targetHex === null || targetDimensionId === null)) {
    throw new Error("recover-relic requires a target hex and dimension");
  }
  return {
    type,
    targetHex,
    targetDimensionId,
    progress: 0,
    required: type === "chart-hexes" ? CHART_HEX_COUNT : 1,
    completed: false,
  };
}

/** One cleared-hex step as the contract engine sees it (fed from the encounter-won run event). */
export interface ContractHexEvent {
  readonly hex: HexCoord;
  /** The dimension the hex was cleared in (room.dimensionId at win time). recover-relic requires
   *  this to equal targetDimensionId — the same coords in another dimension is a miss. */
  readonly dimensionId: number;
  readonly icon: HexIconType | null;
  /** Hexes cleared this run so far, origins excluded — cumulative across dimension travel
   *  (room.runClearedCount; amended by 04-portals §9, was room.visitedThisRun.size - 1). */
  readonly clearedCount: number;
}

const GATEWAY_ICONS: readonly HexIconType[] = ["gateway", "gateway-city"];

/** Pure progress step. Completed contracts are frozen (idempotent — returns the same object). */
export function applyContractEvent(state: ContractState, ev: ContractHexEvent): ContractState {
  if (state.completed) return state;
  switch (state.type) {
    case "slay-boss": {
      const done = ev.icon === "boss";
      return done ? { ...state, progress: 1, completed: true } : state;
    }
    case "recover-relic": {
      const t = state.targetHex!;
      const done = ev.dimensionId === state.targetDimensionId && ev.hex.q === t.q && ev.hex.r === t.r;
      return done ? { ...state, progress: 1, completed: true } : state;
    }
    case "activate-gateway": {
      const done = ev.icon !== null && GATEWAY_ICONS.includes(ev.icon);
      return done ? { ...state, progress: 1, completed: true } : state;
    }
    case "chart-hexes": {
      const progress = Math.min(ev.clearedCount, state.required);
      return { ...state, progress, completed: progress >= state.required };
    }
  }
}

/** True iff the party may propose a retreat while standing on this hex (locked #6: a cleared
 *  gateway — party position is cleared by construction, so the icon test suffices). */
export function isRetreatHex(icon: HexIconType | null): boolean {
  return icon !== null && GATEWAY_ICONS.includes(icon);
}

// Cyclic ring walk from the corner {q: -radius, r: 0}; determinism (fixed corner + fixed edge
// order) is what lets offer-send and choose-validation agree (flag #12).
const RING_WALK: readonly HexCoord[] = [
  { q: 0, r: 1 },
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
];

function* hexRing(radius: number): Generator<HexCoord> {
  if (radius <= 0) {
    yield { q: 0, r: 0 };
    return;
  }
  let hex: HexCoord = { q: -radius, r: 0 };
  for (const dir of RING_WALK) {
    for (let step = 0; step < radius; step++) {
      yield hex;
      hex = { q: hex.q + dir.q, r: hex.r + dir.r };
    }
  }
}

/** Ring-scan for the nearest hex whose (community-recorded or deterministic) icon matches.
 *  Ties broken by scan order (deterministic: rings outward, fixed corner/edge walk). */
export function nearestHexWithIcon(
  icons: Record<string, HexIconType>,
  match: (icon: HexIconType) => boolean,
  opts: { minRadius?: number; maxRadius?: number } = {},
): HexCoord | null {
  const min = opts.minRadius ?? CONTRACT_SCAN_MIN_RADIUS;
  const max = opts.maxRadius ?? CONTRACT_SCAN_MAX_RADIUS;
  for (let radius = min; radius <= max; radius++) {
    for (const hex of hexRing(radius)) {
      const icon = getHexIcon(hex, icons);
      if (icon !== null && match(icon)) return hex;
    }
  }
  return null;
}

/** What the lobby board offers for a given map. chart-hexes is always available. */
export interface ContractOffer {
  readonly type: ContractType;
  readonly targetHex: HexCoord | null;
  readonly required: number;
}

export function buildContractOffers(icons: Record<string, HexIconType>): ContractOffer[] {
  const offers: ContractOffer[] = [];
  const boss = nearestHexWithIcon(icons, (i) => i === "boss");
  if (boss) offers.push({ type: "slay-boss", targetHex: boss, required: 1 });
  const relic = nearestHexWithIcon(icons, (i) => i === "great-ruins" || i === "great-treasure");
  if (relic) offers.push({ type: "recover-relic", targetHex: relic, required: 1 });
  const gate = nearestHexWithIcon(icons, (i) => GATEWAY_ICONS.includes(i));
  if (gate) offers.push({ type: "activate-gateway", targetHex: gate, required: 1 });
  offers.push({ type: "chart-hexes", targetHex: null, required: CHART_HEX_COUNT });
  return offers;
}

export const DEFAULT_CONTRACT_TYPE: ContractType = "chart-hexes";
