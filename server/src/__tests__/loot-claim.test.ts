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

/** Insert a real run_loot row + mirror it into the in-memory pool (what lootDropRecorder does). */
function dropInto(room: Room, item: ItemDefinition, icon: HexIconType | null = "treasure"): LootPoolEntry {
  const lootId = db.insertRunLoot(room.runId, item, ORIGIN, icon);
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

describe("proposeLootClaim guards", () => {
  it("rejects wrong-phase, open-vote, spectator, unknown/claimed loot, and full bag", () => {
    const { room } = buildRoom({ dim: 8203, humans: 2 });
    const entry = dropInto(room, mkWeapon("guard-item", 8203));
    const { io, sends } = recordingIO();

    room.phase = "combat";
    machine.proposeLootClaim(room, io, room.seats[0]!, entry.lootId);
    expect(errorCodes(sends)).toEqual(["BAD_PHASE"]);
    room.phase = "overworld";

    // Open vote -> BAD_PHASE.
    room.vote = { kind: "retreat", proposalId: "x", proposerSeatId: room.seats[0]!.seatId, electorate: [], ballots: new Map(), deadline: Date.now() + 1000, timer: null };
    machine.proposeLootClaim(room, io, room.seats[0]!, entry.lootId);
    expect(errorCodes(sends)).toEqual(["BAD_PHASE", "BAD_PHASE"]);
    room.vote = null;

    // Spectator (disconnected human).
    room.seats[1]!.state = "human-disconnected";
    machine.proposeLootClaim(room, io, room.seats[1]!, entry.lootId);
    expect(errorCodes(sends)).toEqual(["BAD_PHASE", "BAD_PHASE", "NOT_YOUR_SEAT"]);
    room.seats[1]!.state = "human-connected";

    // Unknown lootId.
    machine.proposeLootClaim(room, io, room.seats[0]!, 999999);
    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");

    // Full bag.
    room.seats[0]!.inventory = { ...room.seats[0]!.inventory, bag: new Array(16).fill(mkWeapon("filler", 8203)) };
    machine.proposeLootClaim(room, io, room.seats[0]!, entry.lootId);
    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");
  });
});

describe("claim assignment", () => {
  it("single human -> instant assign: bag gains item, pool shrinks, row assigned, inventory + roomState sent", () => {
    const { room, runId } = buildRoom({ dim: 8204, humans: 1 });
    const entry = dropInto(room, mkWeapon("solo-item", 8204));
    const { io, sends, broadcasts } = recordingIO();

    machine.proposeLootClaim(room, io, room.seats[0]!, entry.lootId);

    const seat = room.seats[0]!;
    expect(seat.inventory.bag.some((b) => b?.id === "solo-item")).toBe(true);
    expect(room.lootPool.length).toBe(0);
    expect(db.loadUnassignedLoot(runId).length).toBe(0);
    expect(db.loadRunLoot(runId)[0]!.assigned_seat_index).toBe(0);
    expect(sends.some((s) => s.msg.type === "inventory")).toBe(true);
    expect(sends.some((s) => s.msg.type === "roomState")).toBe(true); // per-seat send, not broadcast
    // No vote should have opened.
    expect(room.vote).toBeNull();
  });

  it("two humans -> loot vote; yes assigns; a no-majority leaves the item claimable", () => {
    const { room, runId } = buildRoom({ dim: 8205, humans: 2, capacity: 2 });
    const entry = dropInto(room, mkWeapon("contested", 8205));
    const { io, broadcasts } = recordingIO();

    machine.proposeLootClaim(room, io, room.seats[0]!, entry.lootId);
    expect(room.vote?.kind).toBe("loot");
    const vs = broadcasts.filter((b) => b.type === "voteState").at(-1) as Extract<ServerMessage, { type: "voteState" }>;
    expect(vs.vote?.kind).toBe("loot");
    expect(vs.vote?.loot?.item.id).toBe("contested");

    machine.castVote(room, io, room.seats[1]!, room.vote!.proposalId, "yes");
    expect(room.vote).toBeNull();
    expect(room.seats[0]!.inventory.bag.some((b) => b?.id === "contested")).toBe(true);
    expect(room.lootPool.length).toBe(0);
    expect(db.loadRunLoot(runId)[0]!.assigned_seat_index).toBe(0);
  });

  it("no-majority: item stays in the pool and is claimable again", () => {
    const { room } = buildRoom({ dim: 8206, humans: 3, capacity: 3 });
    const entry = dropInto(room, mkWeapon("stay", 8206));
    const { io } = recordingIO();

    machine.proposeLootClaim(room, io, room.seats[0]!, entry.lootId);
    machine.castVote(room, io, room.seats[1]!, room.vote!.proposalId, "no");
    machine.castVote(room, io, room.seats[2]!, room.vote!.proposalId, "no");
    expect(room.vote).toBeNull();
    expect(room.lootPool.some((e) => e.lootId === entry.lootId)).toBe(true);
    expect(room.seats[0]!.inventory.bag.some((b) => b?.id === "stay")).toBe(false);
  });

  it("bag fills mid-vote -> resolve-time re-check fails the claim, item stays in pool", () => {
    const { room } = buildRoom({ dim: 8207, humans: 2, capacity: 2 });
    const entry = dropInto(room, mkWeapon("midvote", 8207));
    const { io, sends } = recordingIO();

    machine.proposeLootClaim(room, io, room.seats[0]!, entry.lootId);
    // Claimant's bag fills before the vote resolves.
    room.seats[0]!.inventory = { ...room.seats[0]!.inventory, bag: new Array(16).fill(mkWeapon("filler", 8207)) };
    machine.castVote(room, io, room.seats[1]!, room.vote!.proposalId, "yes");

    expect(errorCodes(sends).at(-1)).toBe("INVALID_INPUT");
    expect(room.lootPool.some((e) => e.lootId === entry.lootId)).toBe(true);
  });

  it("one vote per room: a claim during an open retreat vote is rejected", () => {
    const { room } = buildRoom({ dim: 8208, humans: 2, capacity: 2 });
    const entry = dropInto(room, mkWeapon("coexist", 8208));
    // Stand on a gateway so proposeRetreat is valid; open a retreat vote first.
    room.hexMap = { ...room.hexMap, icons: { [ORIGIN_KEY]: "gateway" as HexIconType } };
    const { io, sends } = recordingIO();
    machine.proposeRetreat(room, io, room.seats[0]!);
    expect(room.vote?.kind).toBe("retreat");

    machine.proposeLootClaim(room, io, room.seats[1]!, entry.lootId);
    expect(errorCodes(sends).at(-1)).toBe("BAD_PHASE");
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
