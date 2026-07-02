import { describe, it, expect } from "bun:test";
import type { HexCoord, HexIconType, RoomCode, SeatId, ServerMessage } from "shared";
import { hexKey } from "shared";
import type { Room } from "../room.js";
import type { RoomIO } from "../room-machine.js";

// db.ts opens its Database at module load from GAME_DB_PATH; set env BEFORE importing (db.test.ts
// precedent). :memory: keeps the file hermetic; tests use disjoint dimension-id ranges.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");
const { createOpenSeats } = await import("../room.js");
const machine = await import("../room-machine.js");
const gateways = await import("../gateways.js");
const { emitRunEvent } = await import("../run-events.js");

interface SentRecord {
  seatId: SeatId;
  msg: ServerMessage;
}
function recordingIO() {
  const sends: SentRecord[] = [];
  const broadcasts: ServerMessage[] = [];
  const io: RoomIO = {
    send(seat, msg) {
      sends.push({ seatId: seat.seatId, msg });
    },
    broadcast(_room, msg) {
      broadcasts.push(msg);
    },
  };
  return { io, sends, broadcasts };
}

function mkDim(
  id: number,
  opts: { status?: string; bg?: boolean; enemy?: boolean; item?: boolean; tier?: number | null; name?: string } = {},
): void {
  const status = opts.status ?? "approved";
  const bg = opts.bg ?? true;
  db.saveDimension(id, opts.name ?? `Dim ${id}`, [], bg ? `bg-${id}.png` : undefined, undefined, status);
  if (opts.enemy ?? true) db.db.prepare("INSERT OR REPLACE INTO enemy_templates (id, dimension_id, template_json) VALUES (?, ?, '{}')").run(`e-${id}`, id);
  // A well-formed ItemDefinition (feature 3's lootDropRecorder now rolls this pool on encounter-won).
  if (opts.item ?? true) db.db.prepare("INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES (?, ?, ?)")
    .run(`i-${id}`, id, JSON.stringify({ type: "weapon", id: `i-${id}`, name: `i-${id}`, description: "", rarity: "common", sprite: "x.webp", dimensionId: id, slotCost: { hand: 1 }, animSet: "sword", abilities: [] }));
  if (opts.tier !== undefined && opts.tier !== null) db.db.prepare("UPDATE dimensions SET tier = ? WHERE id = ?").run(opts.tier, id);
}

const ORIGIN_KEY = hexKey({ q: 0, r: 0 });
const GATE: HexCoord = { q: 1, r: 0 };
const GATE_KEY = hexKey(GATE);
let seq = 0;

// The attunement pool is global to this file's in-memory DB; drain lingering untiered candidates
// from prior tests so each test's freshly-created candidate is the deterministic lowest-id pick.
function drainPool(): void {
  db.db.prepare("UPDATE dimensions SET tier = 99 WHERE tier IS NULL").run();
}

/** A Room at the overworld standing on a cleared gateway hex, with a real durable run + humans. */
function buildRoom(opts: { sourceDim: number; sourceTier: number | null; humans?: number; capacity?: number }) {
  const capacity = opts.capacity ?? 2;
  const humans = opts.humans ?? 1;
  const s = ++seq;
  const runId = db.startNewRun(opts.sourceDim, `travel-${s}-0`, capacity);
  db.setRunPhase(runId, "overworld");
  db.markRunCleared(runId, opts.sourceDim, { q: 0, r: 0 });
  db.markRunCleared(runId, opts.sourceDim, GATE);

  const seats = createOpenSeats(capacity);
  const accountIds: string[] = [];
  for (let i = 0; i < humans; i++) {
    const seat = seats[i]!;
    const clientId = `travel-${s}-${i}`;
    const account = accounts.resolveGuestAccount(clientId);
    seat.state = "human-connected";
    seat.clientId = clientId;
    seat.accountId = account.id;
    seat.socket = {} as never;
    accountIds.push(account.id);
    db.upsertRunSeat(runId, i, { clientId, displayName: `P${i}`, controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: account.id });
  }
  for (let i = humans; i < capacity; i++) seats[i]!.state = "bot";

  const meta = db.getDimensionMeta(opts.sourceDim)!;
  const room: Room = {
    code: `TRV${s}` as RoomCode,
    hostSeatId: seats[0]!.seatId,
    phase: "overworld",
    building: false,
    generation: 0,
    combat: null,
    dimensionId: opts.sourceDim,
    startDimensionId: opts.sourceDim,
    dimensionName: meta.name,
    dimensionTier: opts.sourceTier,
    gateways: gateways.loadGatewaysForDimension(opts.sourceDim),
    runId,
    hexMap: {
      playerPos: GATE, // standing ON the gateway hex
      hexes: { [ORIGIN_KEY]: "explored", [GATE_KEY]: "explored" },
      icons: { [ORIGIN_KEY]: "town", [GATE_KEY]: "gateway" as HexIconType },
    },
    visitedThisRun: new Set([ORIGIN_KEY, GATE_KEY]),
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

function errorCodes(sends: SentRecord[]): string[] {
  return sends.filter((s) => s.msg.type === "error").map((s) => (s.msg as Extract<ServerMessage, { type: "error" }>).code);
}

describe("proposeTravel guards", () => {
  it("rejects off-gateway, wrong phase, open vote, and spectator seats", () => {
    drainPool();
    mkDim(1000, { tier: 0 });
    mkDim(1020); // a pool candidate exists so attunement is not the blocker
    const { room } = buildRoom({ sourceDim: 1000, sourceTier: 0, humans: 2 });
    const { io, sends } = recordingIO();

    // Off-gateway: move the party off the gateway hex (playerPos is readonly — replace the map).
    room.hexMap = { ...room.hexMap, playerPos: { q: 0, r: 0 } };
    machine.proposeTravel(room, io, room.seats[0]!);
    expect(errorCodes(sends)).toEqual(["INVALID_MOVE"]);
    room.hexMap = { ...room.hexMap, playerPos: GATE };

    // Wrong phase.
    room.phase = "combat";
    machine.proposeTravel(room, io, room.seats[0]!);
    expect(errorCodes(sends)).toEqual(["INVALID_MOVE", "BAD_PHASE"]);
    room.phase = "overworld";

    // Spectator (disconnected) seat.
    room.seats[1]!.state = "human-disconnected";
    machine.proposeTravel(room, io, room.seats[1]!);
    expect(errorCodes(sends)).toEqual(["INVALID_MOVE", "BAD_PHASE", "NOT_YOUR_SEAT"]);
    room.seats[1]!.state = "human-connected";

    // Open vote already present.
    machine.proposeMove(room, io, room.seats[0]!, { q: 0, r: 0 }); // opens a move vote (2 humans)
    machine.proposeTravel(room, io, room.seats[1]!);
    expect(errorCodes(sends)).toEqual(["INVALID_MOVE", "BAD_PHASE", "NOT_YOUR_SEAT", "BAD_PHASE"]);
  });
});

describe("proposeTravel attunement retry (flag #4)", () => {
  it("unattuned + empty pool -> GATEWAY_UNATTUNED, no vote, no row; adding a candidate lets the SAME call attune", () => {
    drainPool();
    mkDim(1100, { tier: 0 }); // source, no pool candidate yet
    const { room, runId } = buildRoom({ sourceDim: 1100, sourceTier: 0, humans: 2 });
    const { io, sends, broadcasts } = recordingIO();

    machine.proposeTravel(room, io, room.seats[0]!);
    expect(errorCodes(sends)).toEqual(["GATEWAY_UNATTUNED"]);
    expect(room.vote).toBeNull();
    expect(broadcasts.some((m) => m.type === "voteState" && m.vote !== null)).toBe(false);
    expect((db.db.prepare("SELECT COUNT(*) AS n FROM dimension_gateways WHERE from_dimension_id = 1100").get() as { n: number }).n).toBe(0);

    // Replenish the pool: a later proposeTravel attunes on retry (no migration needed).
    mkDim(1120);
    machine.proposeTravel(room, io, room.seats[0]!);
    // gatewayUpdate broadcast with the fresh destination, then a travel vote opens (2 humans).
    const gu = broadcasts.find((m) => m.type === "gatewayUpdate") as Extract<ServerMessage, { type: "gatewayUpdate" }> | undefined;
    expect(gu?.gateway).toMatchObject({ toDimensionId: 1120, toTier: 1 });
    expect(room.gateways[GATE_KEY]).toMatchObject({ toDimensionId: 1120 });
    expect(room.vote?.kind).toBe("travel");
    expect(db.loadRun(runId)!.dimension_id).toBe(1100); // not yet traveled (vote pending)
  });
});

describe("travelToDimension (single human -> instant)", () => {
  it("swaps the current dimension, resets to origin, preserves run/contract/count, emits dimension-entered once", () => {
    drainPool();
    mkDim(1200, { tier: 0 });
    mkDim(1220); // pool candidate
    const { room, runId, accountIds } = buildRoom({ sourceDim: 1200, sourceTier: 0, humans: 1 });
    gateways.ensureGatewayAttuned(1200, 0, GATE, null); // pre-attune the standing gateway
    room.gateways = gateways.loadGatewaysForDimension(1200);
    const toDim = room.gateways[GATE_KEY]!.toDimensionId;
    expect(toDim).toBe(1220);

    // A live contract + prior progress must survive travel unchanged.
    room.contract = { type: "chart-hexes", targetHex: null, targetDimensionId: null, progress: 3, required: 10, completed: false };
    db.saveRunContract(runId, room.contract);
    room.runClearedCount = 5;

    const { io, sends, broadcasts } = recordingIO();
    machine.proposeTravel(room, io, room.seats[0]!); // single human -> instant travel

    // In-memory room re-pointed to the destination at its origin.
    expect(room.dimensionId).toBe(1220);
    expect(room.dimensionName).toBe("Dim 1220");
    expect(room.dimensionTier).toBe(1);
    expect(room.hexMap.playerPos).toEqual({ q: 0, r: 0 });
    expect([...room.visitedThisRun]).toEqual([ORIGIN_KEY]);
    expect(room.pendingHex).toBeNull();
    // Run CONTINUES: same runId, contract + progress + cumulative count preserved.
    expect(room.runId).toBe(runId);
    expect(room.contract).toMatchObject({ type: "chart-hexes", progress: 3 });
    expect(room.runClearedCount).toBe(5);

    // Durable: current dimension swapped, start dimension unchanged, destination origin cleared.
    const run = db.loadRun(runId)!;
    expect(run.dimension_id).toBe(1220);
    expect(run.start_dimension_id).toBe(1200);
    expect([...db.loadRunCleared(runId, 1220)]).toEqual(["0,0"]);

    // dimension-entered charted the destination for the seat + bumped dimensions_traveled.
    expect(accounts.getStats(accountIds[0]!)["dimensions_traveled"]).toBe(1);
    expect(db.db.prepare("SELECT COUNT(*) AS n FROM account_dimensions WHERE account_id = ? AND dimension_id = 1220").get(accountIds[0]!) as { n: number }).toEqual({ n: 1 });

    // No open vote; a per-seat roomState carries the destination (broadcastRoomState uses io.send);
    // the hexMapState broadcast lands the party at the destination origin.
    expect(broadcasts.some((m) => m.type === "voteState" && m.vote !== null)).toBe(false);
    const lastRoom = [...sends].reverse().find((s) => s.msg.type === "roomState")!.msg as Extract<ServerMessage, { type: "roomState" }>;
    expect(lastRoom.room.dimensionId).toBe(1220);
    expect(lastRoom.room.dimensionTier).toBe(1);
    const lastMap = [...broadcasts].reverse().find((m) => m.type === "hexMapState") as Extract<ServerMessage, { type: "hexMapState" }>;
    expect(lastMap.hexMap.playerPos).toEqual({ q: 0, r: 0 });
  });
});

describe("travel vote (two humans)", () => {
  it("opens voteState{kind:travel,travel:info,target:null}; a yes travels, a no majority stays put", () => {
    drainPool();
    mkDim(1300, { tier: 0 });
    mkDim(1320);
    // Accept path.
    {
      const { room, runId } = buildRoom({ sourceDim: 1300, sourceTier: 0, humans: 2 });
      gateways.ensureGatewayAttuned(1300, 0, GATE, null);
      room.gateways = gateways.loadGatewaysForDimension(1300);
      const { io, broadcasts } = recordingIO();
      machine.proposeTravel(room, io, room.seats[0]!);
      const vs = broadcasts.find((m) => m.type === "voteState" && m.vote !== null) as Extract<ServerMessage, { type: "voteState" }>;
      expect(vs.vote).toMatchObject({ kind: "travel", target: null });
      expect(vs.vote!.travel).toMatchObject({ toDimensionId: 1320, toTier: 1 });
      machine.castVote(room, io, room.seats[1]!, vs.vote!.proposalId, "yes");
      expect(room.dimensionId).toBe(1320);
      expect(db.loadRun(runId)!.dimension_id).toBe(1320);
    }
    // Reject path: no majority -> vote clears, still in the source dimension.
    {
      const { room, runId } = buildRoom({ sourceDim: 1300, sourceTier: 0, humans: 3, capacity: 3 });
      room.gateways = gateways.loadGatewaysForDimension(1300); // already attuned above
      const { io, broadcasts } = recordingIO();
      machine.proposeTravel(room, io, room.seats[0]!);
      const proposalId = room.vote!.proposalId;
      machine.castVote(room, io, room.seats[1]!, proposalId, "no");
      machine.castVote(room, io, room.seats[2]!, proposalId, "no");
      expect(room.vote).toBeNull();
      expect(broadcasts[broadcasts.length - 1]).toEqual({ type: "voteState", vote: null });
      expect(room.dimensionId).toBe(1300); // stayed
      expect(db.loadRun(runId)!.dimension_id).toBe(1300);
    }
  });
});

describe("retreat / travel coexistence", () => {
  it("one vote per room; and proposeRetreat still works at a destination gateway after travel", () => {
    drainPool();
    mkDim(1400, { tier: 0 });
    mkDim(1420); // sole pool candidate -> attunement links 1420 and assigns it tier 1
    const { room } = buildRoom({ sourceDim: 1400, sourceTier: 0, humans: 2 });
    gateways.ensureGatewayAttuned(1400, 0, GATE, null); // links 1420
    room.gateways = gateways.loadGatewaysForDimension(1400);
    const { io } = recordingIO();

    // A retreat vote is open -> proposeTravel is rejected (BAD_PHASE: one vote per room).
    machine.proposeRetreat(room, io, room.seats[0]!);
    expect(room.vote?.kind).toBe("retreat");
    const io2 = recordingIO();
    machine.proposeTravel(room, io2.io, room.seats[1]!);
    expect(errorCodes(io2.sends)).toEqual(["BAD_PHASE"]);
    machine.cancelVote(room, io);

    // Travel, then retreat at the destination's gateway hex works (02 regression across travel).
    machine.castVote; // no-op ref
    const single = buildRoom({ sourceDim: 1400, sourceTier: 0, humans: 1 });
    single.room.gateways = gateways.loadGatewaysForDimension(1400);
    const io3 = recordingIO();
    machine.proposeTravel(single.room, io3.io, single.room.seats[0]!); // instant travel to 1420
    expect(single.room.dimensionId).toBe(1420);
    // Stand on a cleared gateway in the destination and retreat (playerPos is readonly).
    single.room.hexMap = {
      ...single.room.hexMap,
      playerPos: GATE,
      icons: { ...single.room.hexMap.icons, [GATE_KEY]: "gateway" as HexIconType },
    };
    single.room.visitedThisRun.add(GATE_KEY);
    const io4 = recordingIO();
    machine.proposeRetreat(single.room, io4.io, single.room.seats[0]!); // single human -> instant settle
    expect(single.room.phase).toBe("gameover");
    expect(db.loadRun(single.runId)!.outcome).toBe("retreat");
  });
});

describe("gatewayAttunementRecorder (encounter-won)", () => {
  it("attunes + broadcasts on a gateway hex, no-ops on non-gateway / already-attuned, broadcasts null on empty pool", () => {
    drainPool();
    mkDim(1500, { tier: 0 });
    mkDim(1520); // one candidate
    const { room, runId } = buildRoom({ sourceDim: 1500, sourceTier: 0, humans: 1 });
    const { io, broadcasts } = recordingIO();

    // Non-gateway hex -> recorder does nothing.
    emitRunEvent(room, io, { type: "encounter-won", runId, hex: { q: 2, r: 0 }, icon: "ruins", firstEver: false, clearedCount: 1 });
    expect(broadcasts.some((m) => m.type === "gatewayUpdate")).toBe(false);

    // Gateway hex -> attunes + broadcasts a gatewayUpdate with the destination.
    emitRunEvent(room, io, { type: "encounter-won", runId, hex: GATE, icon: "gateway", firstEver: false, clearedCount: 2 });
    const gu = broadcasts.filter((m) => m.type === "gatewayUpdate") as Extract<ServerMessage, { type: "gatewayUpdate" }>[];
    expect(gu.length).toBe(1);
    expect(gu[0]!.gateway).toMatchObject({ toDimensionId: 1520 });
    expect(room.gateways[GATE_KEY]).toMatchObject({ toDimensionId: 1520 });

    // Already-attuned gateway -> no further broadcast.
    emitRunEvent(room, io, { type: "encounter-won", runId, hex: GATE, icon: "gateway", firstEver: false, clearedCount: 3 });
    expect(broadcasts.filter((m) => m.type === "gatewayUpdate").length).toBe(1);

    // Empty pool at a different gateway hex -> broadcasts gateway: null (loud, no row).
    const other: HexCoord = { q: 0, r: 2 };
    emitRunEvent(room, io, { type: "encounter-won", runId, hex: other, icon: "gateway-city", firstEver: false, clearedCount: 4 });
    const last = broadcasts.filter((m) => m.type === "gatewayUpdate") as Extract<ServerMessage, { type: "gatewayUpdate" }>[];
    expect(last[last.length - 1]!.gateway).toBeNull();
  });
});

describe("resetToOrigin + reconstruct after travel", () => {
  it("resetToOrigin restarts at startDimensionId, zeroes runClearedCount, reloads start-dim gateways", () => {
    drainPool();
    mkDim(1600, { tier: 0 });
    mkDim(1620);
    const { room, runId } = buildRoom({ sourceDim: 1600, sourceTier: 0, humans: 1 });
    gateways.ensureGatewayAttuned(1600, 0, GATE, null);
    room.gateways = gateways.loadGatewaysForDimension(1600);
    const { io } = recordingIO();
    machine.proposeTravel(room, io, room.seats[0]!); // travel to 1620
    expect(room.dimensionId).toBe(1620);
    room.runClearedCount = 7;

    machine.resetToOrigin(room, io, "defeat");
    expect(room.dimensionId).toBe(1600); // back to the START dimension, not the depth (flag #6)
    expect(room.startDimensionId).toBe(1600);
    expect(room.runClearedCount).toBe(0);
    expect(room.runId).not.toBe(runId); // a fresh run
    expect(db.loadRun(room.runId)!.dimension_id).toBe(1600);
    expect(db.loadRun(room.runId)!.start_dimension_id).toBe(1600);
    expect(db.loadRun(runId)!.outcome).toBe("defeat"); // the old run settled
  });

  it("reconstructRoomForRun after travel rehydrates the CURRENT dimension, scoped cleared, recomputed count", () => {
    drainPool();
    mkDim(1700, { tier: 0 });
    mkDim(1720);
    const { room, runId } = buildRoom({ sourceDim: 1700, sourceTier: 0, humans: 1 });
    gateways.ensureGatewayAttuned(1700, 0, GATE, null);
    room.gateways = gateways.loadGatewaysForDimension(1700);
    const { io } = recordingIO();
    machine.proposeTravel(room, io, room.seats[0]!); // travel to 1720
    // Simulate two combat wins in the destination (durable cleared rows).
    db.markRunCleared(runId, 1720, { q: 1, r: 0 });
    db.markRunCleared(runId, 1720, { q: 2, r: 0 });

    const rebuilt = machine.reconstructRoomForRun(runId, () => {})!;
    expect(rebuilt.dimensionId).toBe(1720); // resumes at the CURRENT (destination) dimension
    expect(rebuilt.startDimensionId).toBe(1700);
    expect(rebuilt.dimensionTier).toBe(1);
    // cleared set is scoped to the current dimension (origin + the two wins), not the source's.
    expect([...rebuilt.visitedThisRun].sort()).toEqual(["0,0", "1,0", "2,0"]);
    // both origins excluded, combat wins summed across dims: source GATE(1,0) + dest (1,0),(2,0).
    expect(rebuilt.runClearedCount).toBe(3);
  });
});
