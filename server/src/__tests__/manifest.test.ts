import { describe, it, expect } from "bun:test";
import type { HexCoord, HexIconType, RoomCode, SeatId, ServerMessage, ItemDefinition, ItemRarity } from "shared";
import { hexKey } from "shared";
import type { Room } from "../room.js";
import type { RoomIO } from "../room-machine.js";

// Machine/db-level: the index.ts WS handlers (chooseManifest/chooseDimension guard ladder) are
// exercised end-to-end in coop-integration.test.ts; this file covers the importable machine pieces
// (buildSeatLoadout / manifestItemsFor / resetToOrigin re-apply / reconstruct) without booting Bun.serve.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");
const room = await import("../room.js");
const { createOpenSeats, buildPresetInventory, buildSeatLoadout, manifestItemsFor } = room;
const machine = await import("../room-machine.js");

function mkWeapon(id: string, dimensionId: number, rarity: ItemRarity = "common"): ItemDefinition {
  return {
    type: "weapon", id, name: id, description: "", rarity, sprite: `${id}.webp`,
    dimensionId, slotCost: { hand: 1 }, animSet: "sword", abilities: [],
  };
}

function mkReadyDim(id: number, tier: number | null): void {
  db.saveDimension(id, `Dim ${id}`, [], `bg-${id}.png`);
  db.db.prepare("INSERT OR REPLACE INTO enemy_templates (id, dimension_id, template_json) VALUES (?, ?, '{}')").run(`e-${id}`, id);
  db.db.prepare("INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES (?, ?, ?)")
    .run(`pool-${id}`, id, JSON.stringify(mkWeapon(`pool-${id}`, id)));
  if (tier !== null) db.db.prepare("UPDATE dimensions SET tier = ? WHERE id = ?").run(tier, id);
}

const ORIGIN: HexCoord = { q: 0, r: 0 };
const ORIGIN_KEY = hexKey(ORIGIN);
let seq = 0;

function noopIO(): RoomIO { return { send() {}, broadcast() {} }; }

function buildRoom(opts: { dim: number; tier: number | null }) {
  const s = ++seq;
  const clientId = `mf-${s}-0`;
  const account = accounts.resolveGuestAccount(clientId);
  const runId = db.startNewRun(opts.dim, clientId, 2);
  db.setRunPhase(runId, "overworld");
  db.markRunCleared(runId, opts.dim, ORIGIN);

  const seats = createOpenSeats(2);
  const seat = seats[0]!;
  seat.state = "human-connected";
  seat.clientId = clientId;
  seat.accountId = account.id;
  seat.presetId = "default";
  seats[1]!.state = "bot";
  db.upsertRunSeat(runId, 0, { clientId, displayName: "P0", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: account.id });

  const meta = db.getDimensionMeta(opts.dim)!;
  const r: Room = {
    code: `MF${s}` as RoomCode,
    hostSeatId: seat.seatId,
    phase: "overworld", building: false, generation: 0, combat: null,
    dimensionId: opts.dim, startDimensionId: opts.dim, dimensionName: meta.name, dimensionTier: opts.tier,
    gateways: {}, runId,
    hexMap: { playerPos: ORIGIN, hexes: { [ORIGIN_KEY]: "explored" }, icons: { [ORIGIN_KEY]: "town" as HexIconType } },
    visitedThisRun: new Set([ORIGIN_KEY]), runClearedCount: 0, pendingHex: null, rested: false,
    capacity: 2, seats, listed: false, rematchCode: null,
    session: null, defendRound: null, vote: null, lootPool: [],
    contract: null, outcome: null, chatLog: [], reapTimer: null, lastActivityMs: Date.now(),
  };
  return { room: r, seat, runId, accountId: account.id };
}

describe("buildSeatLoadout + manifestItemsFor (§4.6)", () => {
  it("materializes codex designs into the first free bag slots after the preset kit", () => {
    mkReadyDim(8430, 0);
    const { seat, accountId } = buildRoom({ dim: 8430, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-a", 8430), 0);
    db.bankCodexEntry(accountId, mkWeapon("mf-b", 8430), 0);
    seat.manifestIds = ["mf-a", "mf-b"];

    const items = manifestItemsFor(seat);
    expect(items.map((i) => i.id)).toEqual(["mf-a", "mf-b"]);

    const presetBagCount = buildPresetInventory("default").bag.filter((b) => b !== null).length;
    const inv = buildSeatLoadout("default", items);
    const bagIds = inv.bag.filter((b) => b !== null).map((b) => b!.id);
    expect(bagIds).toContain("mf-a");
    expect(bagIds).toContain("mf-b");
    expect(bagIds.length).toBe(presetBagCount + 2);
  });

  it("manifestItemsFor throws if a manifested id is missing from the codex (invariant break)", () => {
    mkReadyDim(8431, 0);
    const { seat } = buildRoom({ dim: 8431, tier: 0 });
    seat.manifestIds = ["mf-never-banked"];
    expect(() => manifestItemsFor(seat)).toThrow();
  });

  it("buildSeatLoadout throws on bag overflow (capacity invariant)", () => {
    const overflow = Array.from({ length: 17 }, (_, i) => mkWeapon(`mf-of-${i}`, 8432));
    expect(() => buildSeatLoadout("default", overflow)).toThrow(/overflow/);
  });
});

describe("resetToOrigin re-applies manifests (flag #12)", () => {
  it("keeps still-eligible picks, drops tier-ineligible ones, rebuilds the fresh bag, and clears the pool", () => {
    mkReadyDim(8433, 0); // start dim tier 0
    const { room, seat, accountId } = buildRoom({ dim: 8433, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-keep", 8433, "common"), 0);
    db.bankCodexEntry(accountId, mkWeapon("mf-drop", 8433, "rare"), 2); // tier 2 > start tier 0
    seat.manifestIds = ["mf-keep", "mf-drop"];
    seat.inventory = buildSeatLoadout("default", manifestItemsFor(seat));
    room.lootPool = [{ lootId: 1, item: mkWeapon("stale", 8433), sourceIcon: "treasure" }];

    machine.resetToOrigin(room, noopIO(), "defeat");

    expect(seat.manifestIds).toEqual(["mf-keep"]); // tier-2 pick dropped
    expect(seat.inventory.bag.some((b) => b?.id === "mf-keep")).toBe(true);
    expect(seat.inventory.bag.some((b) => b?.id === "mf-drop")).toBe(false);
    expect(room.lootPool).toEqual([]);
    // Rebuilt inventory persisted to the fresh run.
    expect(db.loadSeatInventory(room.runId, 0).bag.some((b) => b?.id === "mf-keep")).toBe(true);
  });
});

describe("reconstructRoomForRun rehydrates manifests empty (flag #12)", () => {
  it("a crash-recovered room has manifestIds = [] (manifests are lobby state)", () => {
    mkReadyDim(8434, 0);
    const { room, seat, runId, accountId } = buildRoom({ dim: 8434, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-recover", 8434), 0);
    seat.manifestIds = ["mf-recover"];
    seat.inventory = buildSeatLoadout("default", manifestItemsFor(seat));
    db.saveSeatInventory(runId, 0, seat.inventory);

    const rebuilt = machine.reconstructRoomForRun(runId, () => {})!;
    expect(rebuilt.seats[0]!.manifestIds).toEqual([]);
    // The materialized design is still in the bag (resolved via codex snapshot, flag #8).
    expect(rebuilt.seats[0]!.inventory.bag.some((b) => b?.id === "mf-recover")).toBe(true);
  });
});

describe("codex-snapshot resolution across runs (flag #8)", () => {
  it("a manifested design resolves in a fresh run even though it was never in any items table", () => {
    mkReadyDim(8435, 0);
    const { seat, runId, accountId } = buildRoom({ dim: 8435, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-orphan", 8435, "rare"), 0);
    seat.manifestIds = ["mf-orphan"];
    seat.inventory = buildSeatLoadout("default", manifestItemsFor(seat));
    db.saveSeatInventory(runId, 0, seat.inventory);

    expect(db.getItemById("mf-orphan")).toBeNull(); // never in the items table
    const rehydrated = db.loadSeatInventory(runId, 0);
    expect(rehydrated.bag.some((b) => b?.id === "mf-orphan")).toBe(true); // codex snapshot resolved it
  });
});
