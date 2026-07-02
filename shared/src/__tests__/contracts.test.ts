import { describe, it, expect } from "bun:test";
import {
  CONTRACTS,
  CHART_HEX_COUNT,
  DEFAULT_CONTRACT_TYPE,
  contractById,
  createContractState,
  applyContractEvent,
  isRetreatHex,
  nearestHexWithIcon,
  buildContractOffers,
  type ContractHexEvent,
} from "../overworld/contracts.js";
import { hexKey, hexDistance, getHexIcon, hexNeighbors, type HexCoord, type HexIconType } from "../map/hex-map.js";
import { bankedXp, XP_BANK_MULTIPLIER } from "../core/progression.js";
import type { RunOutcome } from "../net/protocol.js";

const ORIGIN: HexCoord = { q: 0, r: 0 };
const DIM = 1; // the dimension a target lives in / a hex is cleared in, for these unit cases
function ev(hex: HexCoord, icon: HexIconType | null, clearedCount = 1, dimensionId = DIM): ContractHexEvent {
  return { hex, dimensionId, icon, clearedCount };
}

describe("createContractState", () => {
  it("throws on recover-relic without a target hex or dimension", () => {
    expect(() => createContractState("recover-relic", null, DIM)).toThrow();
    expect(() => createContractState("recover-relic", { q: 3, r: 0 }, null)).toThrow();
  });

  it("sets required per type (1 for single-goal, CHART_HEX_COUNT for chart-hexes)", () => {
    expect(createContractState("slay-boss", { q: 3, r: 0 }, DIM).required).toBe(1);
    expect(createContractState("recover-relic", { q: 3, r: 0 }, DIM).required).toBe(1);
    expect(createContractState("activate-gateway", { q: 3, r: 0 }, DIM).required).toBe(1);
    expect(createContractState("chart-hexes", null, null).required).toBe(CHART_HEX_COUNT);
  });

  it("starts uncompleted at zero progress", () => {
    const s = createContractState("chart-hexes", null, null);
    expect(s.progress).toBe(0);
    expect(s.completed).toBe(false);
  });
});

describe("applyContractEvent", () => {
  it("slay-boss completes only on a boss icon", () => {
    const s = createContractState("slay-boss", { q: 5, r: 0 }, DIM);
    expect(applyContractEvent(s, ev({ q: 1, r: 1 }, "enemy-camp")).completed).toBe(false);
    const done = applyContractEvent(s, ev({ q: 9, r: 9 }, "boss"));
    expect(done.completed).toBe(true);
    expect(done.progress).toBe(1);
  });

  it("recover-relic completes only on the exact target hex, not an adjacent near-miss", () => {
    const target: HexCoord = { q: 5, r: 5 };
    const s = createContractState("recover-relic", target, DIM);
    expect(applyContractEvent(s, ev({ q: 6, r: 5 }, "great-treasure")).completed).toBe(false);
    expect(applyContractEvent(s, ev(target, "great-ruins")).completed).toBe(true);
  });

  it("recover-relic does NOT complete at the target coords in another dimension (gateway-travel false victory)", () => {
    const target: HexCoord = { q: 3, r: -2 };
    const s = createContractState("recover-relic", target, 1); // relic marked in dimension 1
    // Travel through a gateway to dim 707, win the SAME coords -> must stay incomplete.
    expect(applyContractEvent(s, ev(target, "great-ruins", 1, 707)).completed).toBe(false);
    // Only clearing the relic in its own dimension completes it.
    expect(applyContractEvent(s, ev(target, "great-ruins", 1, 1)).completed).toBe(true);
  });

  it("activate-gateway completes on gateway AND gateway-city", () => {
    const s = createContractState("activate-gateway", { q: 5, r: 0 }, DIM);
    expect(applyContractEvent(s, ev({ q: 3, r: 0 }, "gateway")).completed).toBe(true);
    expect(applyContractEvent(s, ev({ q: 3, r: 0 }, "gateway-city")).completed).toBe(true);
    expect(applyContractEvent(s, ev({ q: 3, r: 0 }, "boss")).completed).toBe(false);
  });

  it("chart-hexes tracks clearedCount, clamps at required, completes at CHART_HEX_COUNT", () => {
    const s = createContractState("chart-hexes", null, null);
    const mid = applyContractEvent(s, ev({ q: 1, r: 0 }, null, 4));
    expect(mid.progress).toBe(4);
    expect(mid.completed).toBe(false);
    const done = applyContractEvent(mid, ev({ q: 2, r: 0 }, null, CHART_HEX_COUNT));
    expect(done.progress).toBe(CHART_HEX_COUNT);
    expect(done.completed).toBe(true);
    const over = applyContractEvent(s, ev({ q: 2, r: 0 }, null, CHART_HEX_COUNT + 5));
    expect(over.progress).toBe(CHART_HEX_COUNT); // clamped, never exceeds required
    expect(over.completed).toBe(true);
  });

  it("freezes a completed contract (returns the same object)", () => {
    const s = createContractState("slay-boss", { q: 5, r: 0 }, DIM);
    const done = applyContractEvent(s, ev({ q: 9, r: 9 }, "boss"));
    expect(applyContractEvent(done, ev({ q: 1, r: 1 }, "boss"))).toBe(done);
    expect(applyContractEvent(done, ev({ q: 1, r: 1 }, null))).toBe(done);
  });

  it("returns the same object when a single-goal event does not match (no needless copy)", () => {
    const s = createContractState("slay-boss", { q: 5, r: 0 }, DIM);
    expect(applyContractEvent(s, ev({ q: 1, r: 1 }, "town"))).toBe(s);
  });
});

describe("isRetreatHex", () => {
  it("is true only for gateway icons", () => {
    expect(isRetreatHex("gateway")).toBe(true);
    expect(isRetreatHex("gateway-city")).toBe(true);
    expect(isRetreatHex("boss")).toBe(false);
    expect(isRetreatHex("town")).toBe(false);
    expect(isRetreatHex(null)).toBe(false);
  });
});

describe("contractById", () => {
  it("returns the def and throws on unknown ids", () => {
    expect(contractById("chart-hexes").xpReward).toBe(80);
    // deliberately bad id to prove the fail-loud guard.
    expect(() => contractById("nope" as never)).toThrow();
  });

  it("catalog rewards match the locked tunable table", () => {
    const byId = Object.fromEntries(CONTRACTS.map((c) => [c.id, c.xpReward]));
    expect(byId).toEqual({
      "slay-boss": 150,
      "recover-relic": 120,
      "activate-gateway": 100,
      "chart-hexes": 80,
    });
    expect(DEFAULT_CONTRACT_TYPE).toBe("chart-hexes");
  });
});

describe("nearestHexWithIcon", () => {
  it("is deterministic — same inputs yield the same hex twice", () => {
    const a = nearestHexWithIcon({}, (i) => i === "boss");
    const b = nearestHexWithIcon({}, (i) => i === "boss");
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it("returns null when nothing matches within maxRadius", () => {
    expect(nearestHexWithIcon({}, () => false)).toBeNull();
  });

  it("respects the min radius — a match closer than min is not chosen", () => {
    const near: HexCoord = { q: 2, r: 0 }; // radius 2, below the default min of 3
    const icons: Record<string, HexIconType> = { [hexKey(near)]: "boss" };
    // Default minRadius (3) means radius 2 is never scanned; capping max at 2 yields nothing.
    expect(nearestHexWithIcon(icons, (i) => i === "boss", { maxRadius: 2 })).toBeNull();
    // Explicitly lowering the floor to 2 finds the planted hex (radius-2 ring has no deterministic boss).
    expect(nearestHexWithIcon(icons, (i) => i === "boss", { minRadius: 2, maxRadius: 2 })).toEqual(near);
  });

  it("community icon overrides beat the deterministic fallback", () => {
    // Radius-3 ring has no deterministic boss, so a planted boss is the unique match there.
    const planted: HexCoord = { q: 3, r: 0 };
    expect(getHexIcon(planted, {})).not.toBe("boss");
    const icons: Record<string, HexIconType> = { [hexKey(planted)]: "boss" };
    expect(nearestHexWithIcon(icons, (i) => i === "boss", { minRadius: 3, maxRadius: 3 })).toEqual(planted);
  });
});

describe("buildContractOffers", () => {
  it("always offers chart-hexes, and the others only when a target exists", () => {
    const offers = buildContractOffers({});
    const types = offers.map((o) => o.type);
    expect(types).toContain("chart-hexes");
    const chart = offers.find((o) => o.type === "chart-hexes")!;
    expect(chart.targetHex).toBeNull();
    expect(chart.required).toBe(CHART_HEX_COUNT);
    // The deterministic dim-0 map has boss/relic/gateway targets within scan range.
    for (const t of ["slay-boss", "recover-relic", "activate-gateway"] as const) {
      const offer = offers.find((o) => o.type === t);
      expect(offer).toBeDefined();
      expect(offer!.targetHex).not.toBeNull();
    }
  });

  it("offers unique types, each carrying nearestHexWithIcon's target", () => {
    const offers = buildContractOffers({});
    expect(new Set(offers.map((o) => o.type)).size).toBe(offers.length);
    const boss = offers.find((o) => o.type === "slay-boss")!;
    expect(boss.targetHex).toEqual(nearestHexWithIcon({}, (i) => i === "boss"));
  });
});

describe("hexDistance", () => {
  it("known values", () => {
    expect(hexDistance(ORIGIN, ORIGIN)).toBe(0);
    expect(hexDistance(ORIGIN, { q: 3, r: 0 })).toBe(3);
    expect(hexDistance(ORIGIN, { q: 0, r: 2 })).toBe(2);
    expect(hexDistance(ORIGIN, { q: 2, r: -1 })).toBe(2);
    expect(hexDistance({ q: 1, r: 1 }, { q: -2, r: 3 })).toBe(3);
  });

  it("every neighbor is distance 1", () => {
    for (const n of hexNeighbors(ORIGIN)) expect(hexDistance(ORIGIN, n)).toBe(1);
  });

  it("is symmetric", () => {
    const a: HexCoord = { q: 4, r: -2 };
    const b: HexCoord = { q: -1, r: 5 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });
});

describe("bankedXp", () => {
  it("floors 0.5-multiplier outcomes (25 -> 12)", () => {
    expect(bankedXp(25, "defeat")).toBe(12);
    expect(bankedXp(25, "retreat")).toBe(12);
    expect(bankedXp(25, "abandoned")).toBe(12);
  });

  it("victory is identity", () => {
    expect(bankedXp(25, "victory")).toBe(25);
    expect(bankedXp(305, "victory")).toBe(305);
  });

  it("covers all four run outcomes with the expected multipliers", () => {
    const outcomes: RunOutcome[] = ["victory", "defeat", "retreat", "abandoned"];
    for (const o of outcomes) {
      expect(XP_BANK_MULTIPLIER[o]).toBeDefined();
      expect(bankedXp(100, o)).toBe(Math.floor(100 * XP_BANK_MULTIPLIER[o]));
    }
    expect(XP_BANK_MULTIPLIER).toEqual({ victory: 1, retreat: 0.5, defeat: 0.5, abandoned: 0.5 });
  });
});
