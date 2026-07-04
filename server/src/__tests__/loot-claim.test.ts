import { describe, it, expect } from "bun:test";
import type { HexCoord, HexIconType, RoomCode, SeatId, ServerMessage, ItemDefinition, ItemRarity, LootPoolEntry } from "shared";
import { hexKey } from "shared";
import type { Room } from "../room.js";
import type { RoomIO } from "../room-machine.js";

process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");
const { createOpenSeats } = await import("../room.js");
const machine = await import("../room-machine.js");
const loot = await import("../loot.js");

interface SentRecord { seatId: SeatId; msg: ServerMessage }
function recordingIO() {
  const sends: SentRecord[] = [];
  const broadcasts: ServerMessage[] = [];
  const io: RoomIO = {
    send(seat, msg) { sends.push({ seatId: seat.seatId, msg }); },
    broadcast(_room, msg) { broadcasts.push(msg); },
  };
  return { io, sends, broadcasts };
}

function mkWeapon(id: string, dimensionId: number, rarity: ItemRarity = "common"): ItemDefinition {
  return {
    type: "weapon", id, name: id, description: "", rarity, sprite: `${id}.webp`,
    dimensionId, slotCost: { hand: 1 }, animSet: "sword", abilities: [],
  };
}

const ORIGIN: HexCoord = { q: 0, r: 0 };
const ORIGIN_KEY = hexKey(ORIGIN);
let seq = 0;

function buildRoom(opts: { dim: number; humans?: number; capacity?: number }) {
  const capacity = opts.capacity ?? 2;
  const humans = opts.humans ?? 1;
  const s = ++seq;
  // A dimensions row must exist: these runs go to overworld, so a later recoverActiveRuns (in another
  // test file sharing the :memory: DB) would reconstruct them and getDimensionMeta must resolve.
  if (!db.getDimensionMeta(opts.dim)) db.saveDimension(opts.dim, `Dim ${opts.dim}`, []);
  const runId = db.startNewRun(opts.dim, `loot-${s}-0`, capacity);
  db.setRunPhase(runId, "overworld");
  db.markRunCleared(runId, opts.dim, ORIGIN);

  const seats = createOpenSeats(capacity);
  const accountIds: string[] = [];
  for (let i = 0; i < humans; i++) {
    const seat = seats[i]!;
    const clientId = `loot-${s}-${i}`;
    const account = accounts.resolveGuestAccount(clientId);
    seat.state = "human-connected";
    seat.clientId = clientId;
    seat.accountId = account.id;
    seat.socket = {} as never;
    accountIds.push(account.id);
    db.upsertRunSeat(runId, i, { clientId, displayName: `P${i}`, controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: account.id });
  }
  for (let i = humans; i < capacity; i++) seats[i]!.state = "bot";

  const meta = db.getDimensionMeta(opts.dim) ?? { id: opts.dim, name: `Dim ${opts.dim}`, tier: 0 };
  const room: Room = {
    code: `LOOT${s}` as RoomCode,
    hostSeatId: seats[0]!.seatId,
    phase: "overworld",
    building: false,
    generation: 0,
    combat: null,
    dimensionId: opts.dim,
    startDimensionId: opts.dim,
    dimensionName: meta.name,
    dimensionTier: meta.tier,
    gateways: {},
    runId,
    hexMap: { playerPos: ORIGIN, hexes: { [ORIGIN_KEY]: "explored" }, icons: { [ORIGIN_KEY]: "town" as HexIconType } },
    visitedThisRun: new Set([ORIGIN_KEY]),
    runClearedCount: 0,
    pendingHex: null,
    rested: false,
    capacity,
    seats,
    listed: false,
    rematchCode: null,
    session: null,
    defendRound: null,
    vote: null,
    lootPool: [],
    contract: null,
    outcome: null,
    chatLog: [],
    reapTimer: null,
    lastActivityMs: Date.now(),
  };
  return { room, runId, accountIds };
}

/** Insert a real run_loot row + mirror it into the in-memory box (what lootDropRecorder does). */
function dropInto(room: Room, item: ItemDefinition, icon: HexIconType | null = "treasure"): LootPoolEntry {
  const lootId = db.insertRunLoot(room.runId, item, ORIGIN, icon, "drop");
  const entry: LootPoolEntry = { lootId, item, sourceIcon: icon };
  room.lootPool = [...room.lootPool, entry];
  return entry;
}

function errorCodes(sends: SentRecord[]): string[] {
  return sends.filter((s) => s.msg.type === "error").map((s) => (s.msg as Extract<ServerMessage, { type: "error" }>).code);
}

describe("lootDropRecorder (§4.2)", () => {
  it("rolls the pool, persists rows, grows room.lootPool, and broadcasts lootFound", () => {
    // "ruins" -> elite profile (dropChance 1.0, count 1); a one-item pool drops that item deterministically.
    db.saveItems(8200, { "loot-drop": mkWeapon("loot-drop", 8200) });
    const { room, runId } = buildRoom({ dim: 8200 });
    const { io, broadcasts } = recordingIO();

    loot.lootDropRecorder(room, io, { type: "encounter-won", runId, hex: ORIGIN, icon: "ruins", firstEver: true, clearedCount: 1 });

    expect(room.lootPool.length).toBe(1);
    expect(room.lootPool[0]!.item.id).toBe("loot-drop");
    expect(db.loadUnassignedLoot(runId).length).toBe(1);
    const found = broadcasts.filter((b) => b.type === "lootFound");
    expect(found.length).toBe(1);
    expect((found[0] as Extract<ServerMessage, { type: "lootFound" }>).drops.length).toBe(1);
  });

  it("empty pool -> console.error, no rows, no broadcast (FALLBACK flag #10)", () => {
    const { room, runId } = buildRoom({ dim: 8201 }); // no items saved for 8201
    const { io, broadcasts } = recordingIO();
    const errs: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a); };
    try {
      loot.lootDropRecorder(room, io, { type: "encounter-won", runId, hex: ORIGIN, icon: "boss", firstEver: false, clearedCount: 1 });
    } finally { console.error = orig; }

    expect(room.lootPool.length).toBe(0);
    expect(db.loadUnassignedLoot(runId).length).toBe(0);
    expect(broadcasts.some((b) => b.type === "lootFound")).toBe(false);
    expect(errs.length).toBe(1);
  });

  it("excluded ids never drop (abilitytest)", () => {
    // Raw insert (bypass saveItems' global-uniqueness check): "abilitytest" is owned by seeded dim 0
    // in the shared DB, but the (id, dimension_id) PK lets dim 8202 hold its own excluded row.
    db.db.prepare("INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES (?, ?, ?)")
      .run("abilitytest", 8202, JSON.stringify(mkWeapon("abilitytest", 8202)));
    const { room, runId } = buildRoom({ dim: 8202 });
    const { io, broadcasts } = recordingIO();
    // apex (dropChance 1.0, count 2) would drop twice, but the only pool item is excluded -> [].
    loot.lootDropRecorder(room, io, { type: "encounter-won", runId, hex: ORIGIN, icon: "boss", firstEver: false, clearedCount: 1 });
    expect(room.lootPool.length).toBe(0);
    expect(db.loadUnassignedLoot(runId).length).toBe(0);
    expect(broadcasts.some((b) => b.type === "lootFound")).toBe(false);
  });
});

describe("takeLoot guards", () => {
  it("rejects wrong-phase, spectator, unknown/taken loot, and full bag", () => {
    const { room } = buildRoom({ dim: 8203, humans: 2 });
    const entry = dropInto(room, mkWeapon("guard-item", 8203));
    const { io, sends } = recordingIO();

    room.phase = "combat";
    machine.takeLoot(room, io, room.seats[0]!, entry.lootId);
    expect(errorCodes(sends)).toEqual(["BAD_PHASE"]);
    room.phase = "overworld";

    // Spectator (disconnected human).
    room.seats[1]!.state = "human-disconnected";
    machine.takeLoot(room, io, room.seats[1]!, entry.lootId);
    expect(errorCodes(sends)).toEqual(["BAD_PHASE", "NOT_YOUR_SEAT"]);
    room.seats[1]!.state = "human-connected";

    // Unknown lootId.
    machine.takeLoot(room, io, room.seats[0]!, 999999);
    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");

    // Full bag.
    room.seats[0]!.inventory = { ...room.seats[0]!.inventory, bag: new Array(16).fill(mkWeapon("filler", 8203)) };
    machine.takeLoot(room, io, room.seats[0]!, entry.lootId);
    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");
    expect(room.lootPool.some((e) => e.lootId === entry.lootId)).toBe(true); // stays in the box
  });
});

describe("take assignment", () => {
  it("take is instant: bag gains item, box shrinks, row assigned, inventory + roomState sent, no vote", () => {
    const { room, runId } = buildRoom({ dim: 8204, humans: 1 });
    const entry = dropInto(room, mkWeapon("solo-item", 8204));
    const { io, sends } = recordingIO();

    machine.takeLoot(room, io, room.seats[0]!, entry.lootId);

    const seat = room.seats[0]!;
    expect(seat.inventory.bag.some((b) => b?.id === "solo-item")).toBe(true);
    expect(room.lootPool.length).toBe(0);
    expect(db.loadUnassignedLoot(runId).length).toBe(0);
    expect(db.loadRunLoot(runId)[0]!.assigned_seat_index).toBe(0);
    expect(sends.some((s) => s.msg.type === "inventory")).toBe(true);
    expect(sends.some((s) => s.msg.type === "roomState")).toBe(true); // per-seat send, not broadcast
    expect(room.vote).toBeNull();
  });

  it("multi-human take is instant too — no vote opens, first taker wins", () => {
    const { room, runId } = buildRoom({ dim: 8205, humans: 2, capacity: 2 });
    const entry = dropInto(room, mkWeapon("contested", 8205));
    const { io, sends } = recordingIO();

    machine.takeLoot(room, io, room.seats[1]!, entry.lootId);
    expect(room.vote).toBeNull();
    expect(room.seats[1]!.inventory.bag.some((b) => b?.id === "contested")).toBe(true);
    expect(db.loadRunLoot(runId)[0]!.assigned_seat_index).toBe(1);

    // A second take of the same lootId fails: the box no longer holds it.
    machine.takeLoot(room, io, room.seats[0]!, entry.lootId);
    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");
    expect(room.seats[0]!.inventory.bag.some((b) => b?.id === "contested")).toBe(false);
  });

  it("taking during an open retreat vote works (takes don't touch the vote machinery)", () => {
    const { room } = buildRoom({ dim: 8208, humans: 2, capacity: 2 });
    const entry = dropInto(room, mkWeapon("coexist", 8208));
    // Stand on a gateway so proposeRetreat is valid; open a retreat vote first.
    room.hexMap = { ...room.hexMap, icons: { [ORIGIN_KEY]: "gateway" as HexIconType } };
    const { io } = recordingIO();
    machine.proposeRetreat(room, io, room.seats[0]!);
    expect(room.vote?.kind).toBe("retreat");

    machine.takeLoot(room, io, room.seats[1]!, entry.lootId);
    expect(room.seats[1]!.inventory.bag.some((b) => b?.id === "coexist")).toBe(true);
    expect(room.vote?.kind).toBe("retreat"); // vote untouched
  });
});

describe("stashLoot", () => {
  it("moves a bag item into the box: unassigned row inserted, bag slot cleared, roomState broadcast", () => {
    const { room, runId } = buildRoom({ dim: 8206, humans: 1 });
    const seat = room.seats[0]!;
    const bag = [...seat.inventory.bag];
    bag[3] = mkWeapon("stashed", 8206);
    seat.inventory = { ...seat.inventory, bag };
    const { io, sends } = recordingIO();

    machine.stashLoot(room, io, seat, 3);

    expect(seat.inventory.bag[3]).toBeNull();
    expect(room.lootPool.length).toBe(1);
    expect(room.lootPool[0]!.item.id).toBe("stashed");
    expect(room.lootPool[0]!.sourceIcon).toBeNull();
    const rows = db.loadUnassignedLoot(runId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(room.lootPool[0]!.lootId);
    expect(rows[0]!.origin).toBe("stash"); // codex banking must skip this row
    expect(sends.some((s) => s.msg.type === "inventory")).toBe(true);
    expect(sends.some((s) => s.msg.type === "roomState")).toBe(true);
  });

  it("rejects wrong-phase, spectator, and empty bag slot", () => {
    const { room } = buildRoom({ dim: 8207, humans: 2 });
    const { io, sends } = recordingIO();

    room.phase = "combat";
    machine.stashLoot(room, io, room.seats[0]!, 0);
    expect(errorCodes(sends)).toEqual(["BAD_PHASE"]);
    room.phase = "overworld";

    room.seats[1]!.state = "human-disconnected";
    machine.stashLoot(room, io, room.seats[1]!, 0);
    expect(errorCodes(sends).at(-1)).toBe("NOT_YOUR_SEAT");
    room.seats[1]!.state = "human-connected";

    // Seats spawn with the default preset, so pick a genuinely empty slot.
    const emptySlot = room.seats[0]!.inventory.bag.indexOf(null);
    machine.stashLoot(room, io, room.seats[0]!, emptySlot);
    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");
    machine.stashLoot(room, io, room.seats[0]!, 99); // out of range
    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");
    expect(room.lootPool.length).toBe(0);
  });

  it("round-trip: one seat stashes, another takes the same item", () => {
    const { room, runId } = buildRoom({ dim: 8210, humans: 2, capacity: 2 });
    const giver = room.seats[0]!;
    const bag = [...giver.inventory.bag];
    bag[0] = mkWeapon("handoff", 8210);
    giver.inventory = { ...giver.inventory, bag };
    const { io } = recordingIO();

    machine.stashLoot(room, io, giver, 0);
    const entry = room.lootPool[0]!;
    machine.takeLoot(room, io, room.seats[1]!, entry.lootId);

    expect(giver.inventory.bag.some((b) => b?.id === "handoff")).toBe(false);
    expect(room.seats[1]!.inventory.bag.some((b) => b?.id === "handoff")).toBe(true);
    expect(room.lootPool.length).toBe(0);
    expect(db.loadRunLoot(runId).find((r) => r.item_id === "handoff")!.assigned_seat_index).toBe(1);
  });
});

describe("pool rehydration (crash recovery, flag #8/#13)", () => {
  it("reconstructRoomForRun rebuilds room.lootPool from unassigned run_loot snapshots", () => {
    const { room, runId } = buildRoom({ dim: 8209, humans: 1 });
    dropInto(room, mkWeapon("survivor-a", 8209));
    const assigned = dropInto(room, mkWeapon("survivor-b", 8209));
    // Assign one drop so only the unclaimed one rehydrates into the pool.
    const inv = { bag: new Array(16).fill(null), equipped: [], attachments: {} };
    inv.bag[0] = assigned.item;
    db.commitLootAssignment(runId, assigned.lootId, 0, room.seats[0]!.accountId, inv);

    const rebuilt = machine.reconstructRoomForRun(runId, () => {})!;
    expect(rebuilt.lootPool.map((e) => e.item.id)).toEqual(["survivor-a"]);
    expect(rebuilt.lootPool[0]!.sourceIcon).toBe("treasure"); // snapshot provenance preserved
  });
});
