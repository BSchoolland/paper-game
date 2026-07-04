import { describe, it, expect } from "bun:test";
import type { HexCoord, HexIconType, RoomCode, SeatId, ServerMessage, ItemDefinition, ItemRarity } from "shared";
import { hexKey } from "shared";
import type { Room } from "../room.js";
import type { RoomIO } from "../room-machine.js";

// Machine/db-level: the index.ts WS handlers (chooseManifest/chooseDimension guard ladder) are
// exercised end-to-end in coop-integration.test.ts; this file covers the importable machine pieces
// (seatContribution / manifestItemsFor / resetToOrigin re-apply / reconstruct) without booting Bun.serve.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");
const room = await import("../room.js");
const { createOpenSeats, seatContribution, manifestItemsFor } = room;
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
    session: null, defendRound: null, vote: null, partyBag: [],
    contract: null, outcome: null, chatLog: [], reapTimer: null, lastActivityMs: Date.now(),
  };
  return { room: r, seat, runId, accountId: account.id };
}

describe("seatContribution + manifestItemsFor (§4.6)", () => {
  it("a seat's run-start contribution carries its manifested codex designs", () => {
    mkReadyDim(8430, 0);
    const { seat, accountId } = buildRoom({ dim: 8430, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-a", 8430), 0);
    db.bankCodexEntry(accountId, mkWeapon("mf-b", 8430), 0);
    seat.manifestIds = ["mf-a", "mf-b"];

    const items = manifestItemsFor(seat);
    expect(items.map((i) => i.id)).toEqual(["mf-a", "mf-b"]);

    // Skip-seed leaves the preset's bag extras unresolvable, so the contribution is exactly
    // the manifests here; with a seeded pool it would also carry the preset extras.
    const contribution = seatContribution(seat).map((i) => i.id);
    expect(contribution).toContain("mf-a");
    expect(contribution).toContain("mf-b");
  });

  it("manifestItemsFor throws if a manifested id is missing from the codex (invariant break)", () => {
    mkReadyDim(8431, 0);
    const { seat } = buildRoom({ dim: 8431, tier: 0 });
    seat.manifestIds = ["mf-never-banked"];
    expect(() => manifestItemsFor(seat)).toThrow();
  });
});

describe("resetToOrigin re-applies manifests (flag #12)", () => {
  it("keeps still-eligible picks, drops tier-ineligible ones, and restages the fresh party bag", () => {
    mkReadyDim(8433, 0); // start dim tier 0
    const { room, seat, accountId } = buildRoom({ dim: 8433, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-keep", 8433, "common"), 0);
    db.bankCodexEntry(accountId, mkWeapon("mf-drop", 8433, "rare"), 2); // tier 2 > start tier 0
    seat.manifestIds = ["mf-keep", "mf-drop"];
    room.partyBag = [{ bagId: 1, item: mkWeapon("stale", 8433), sourceIcon: "treasure" }];

    machine.resetToOrigin(room, noopIO(), "defeat");

    expect(seat.manifestIds).toEqual(["mf-keep"]); // tier-2 pick dropped
    const bagIds = room.partyBag.map((e) => e.item.id);
    expect(bagIds).toContain("mf-keep"); // restaged into the fresh bag
    expect(bagIds).not.toContain("mf-drop");
    expect(bagIds).not.toContain("stale"); // the old run's bag is gone
    // The restaged bag is durable on the fresh run.
    expect(db.loadPartyBag(room.runId).some((r) => r.item_id === "mf-keep")).toBe(true);
  });
});

describe("reconstructRoomForRun rehydrates manifests empty (flag #12)", () => {
  it("a crash-recovered room has manifestIds = [] and rehydrates the staged bag", () => {
    mkReadyDim(8434, 0);
    const { room, seat, runId, accountId } = buildRoom({ dim: 8434, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-recover", 8434), 0);
    seat.manifestIds = ["mf-recover"];
    machine.stagePartyBagContributions(room); // what startGame does

    const rebuilt = machine.reconstructRoomForRun(runId, () => {})!;
    expect(rebuilt.seats[0]!.manifestIds).toEqual([]);
    // The materialized design is still in the shared bag (snapshot-resolved, flag #8).
    expect(rebuilt.partyBag.some((e) => e.item.id === "mf-recover")).toBe(true);
  });
});

describe("codex-snapshot resolution across runs (flag #8)", () => {
  it("an equipped manifested design resolves even though it was never in any items table", () => {
    mkReadyDim(8435, 0);
    const { seat, runId, accountId } = buildRoom({ dim: 8435, tier: 0 });
    db.bankCodexEntry(accountId, mkWeapon("mf-orphan", 8435, "rare"), 0);
    seat.manifestIds = ["mf-orphan"];
    seat.inventory = { equipped: [...manifestItemsFor(seat)], attachments: {} };
    db.saveSeatInventory(runId, 0, seat.inventory);

    expect(db.getItemById("mf-orphan")).toBeNull(); // never in the items table
    const rehydrated = db.loadSeatInventory(runId, 0);
    expect(rehydrated.equipped.some((i) => i.id === "mf-orphan")).toBe(true); // codex snapshot resolved it
  });
});
