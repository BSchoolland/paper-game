import { describe, it, expect } from "bun:test";
import type { HexIconType, RoomCode, SeatId, ServerMessage } from "shared";
import { hexKey } from "shared";
import type { Room } from "../room.js";
import type { RoomIO } from "../room-machine.js";
import type { RunEvent } from "../run-events.js";

// db.ts opens its Database at module load from GAME_DB_PATH, so set the env BEFORE importing
// anything that pulls it in (db.test.ts precedent). :memory: keeps the test hermetic.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");
const { createOpenSeats } = await import("../room.js");
const machine = await import("../room-machine.js");
const { emitRunEvent } = await import("../run-events.js");
const { assignContract } = await import("../contract-engine.js");

/**
 * Machine-level run-outcome coverage (docs/meta-loop/02-contracts.md §8): room-machine is
 * transport-pure (RoomIO-injected), so victory/retreat/settle flows are driven directly on a
 * fabricated Room with a recording RoomIO — no ws harness needed.
 */

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

const ORIGIN_KEY = hexKey({ q: 0, r: 0 });
let roomSeq = 0;

/** A Room at the overworld with a real durable run and `humans` attributed connected seats. */
function buildRoom(opts?: { humans?: number; capacity?: number; icons?: Record<string, HexIconType> }) {
  const capacity = opts?.capacity ?? 2;
  const humans = opts?.humans ?? 1;
  const dimensionId = 1;
  const seq = ++roomSeq;
  const runId = db.startNewRun(dimensionId, `machine-${seq}-0`, capacity);
  db.setRunPhase(runId, "overworld");
  db.markRunCleared(runId, dimensionId, { q: 0, r: 0 });

  const seats = createOpenSeats(capacity);
  const accountIds: string[] = [];
  for (let i = 0; i < humans; i++) {
    const seat = seats[i]!;
    const clientId = `machine-${seq}-${i}`;
    const account = accounts.resolveGuestAccount(clientId);
    seat.state = "human-connected";
    seat.clientId = clientId;
    seat.accountId = account.id;
    seat.socket = {} as never; // recording io never touches it; non-null so per-seat sends happen
    accountIds.push(account.id);
  }
  for (let i = humans; i < capacity; i++) seats[i]!.state = "bot";

  const room: Room = {
    code: `MACH${seq}` as RoomCode,
    hostSeatId: seats[0]!.seatId,
    phase: "overworld",
    building: false,
    generation: 0,
    combat: null,
    dimensionId,
    startDimensionId: dimensionId,
    dimensionName: "Test Dimension",
    dimensionTier: 0,
    gateways: {},
    runId,
    hexMap: {
      playerPos: { q: 0, r: 0 },
      hexes: { [ORIGIN_KEY]: "explored" },
      icons: { [ORIGIN_KEY]: "town", ...(opts?.icons ?? {}) },
    },
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

function xpBankedSends(sends: SentRecord[]) {
  return sends.filter(
    (s): s is SentRecord & { msg: Extract<ServerMessage, { type: "xpBanked" }> } => s.msg.type === "xpBanked",
  );
}

describe("run outcomes (machine-level, stub RoomIO)", () => {
  it("victory settle: reward accrues pre-bank, run-ended fires once, gameover state broadcast, xpBanked at 1.0 per eligible seat", () => {
    const { room, runId, accountIds } = buildRoom({ humans: 2 });
    const { io, sends, broadcasts } = recordingIO();

    // required: 1 exercises the same chart-hexes arm without driving CHART_HEX_COUNT cycles.
    room.contract = { type: "chart-hexes", targetHex: null, targetDimensionId: null, progress: 0, required: 1, completed: false };
    db.saveRunContract(runId, room.contract);

    room.visitedThisRun.add(hexKey({ q: 1, r: 0 }));
    emitRunEvent(room, io, {
      type: "encounter-won",
      runId,
      hex: { q: 1, r: 0 },
      icon: null, // a plain wilderness hex carries no icon
      firstEver: false,
      clearedCount: 1,
    });

    // Registry-order proof (§4.3): when the contract completes, the winning encounter's XP is
    // ALREADY in the ledger — so a victory settle banks it at the 1.0 multiplier.
    expect(room.contract.completed).toBe(true);
    const ledger = db.loadPendingXp(runId);
    expect(ledger.map((r) => r.amount)).toEqual([25, 25]);
    expect(JSON.parse(db.loadRun(runId)!.contract_json!).completed).toBe(true); // persisted snapshot

    machine.settleRun(room, io, "victory");

    expect(room.phase).toBe("gameover");
    expect(room.outcome).toBe("victory");
    const run = db.loadRun(runId)!;
    expect(run.active).toBe(0);
    expect(run.outcome).toBe("victory");

    // Contract reward (chart-hexes: 80) accrued to BOTH eligible seats before finalize -> 105 banked each.
    for (const accountId of accountIds) {
      expect(accounts.loadProfilePayload(accountId).xp).toBe(105);
      expect(accounts.getStats(accountId)["contracts_completed"]).toBe(1);
    }
    const banked = xpBankedSends(sends);
    expect(banked.length).toBe(2); // exactly once per seat — run-ended fired exactly once
    for (const b of banked) {
      expect(b.msg).toMatchObject({ pending: 105, multiplier: 1, banked: 105, xp: 105, level: 2, leveledUp: true });
    }
    // Sealbearer lands with the contracts_completed bump at settle.
    const titleSends = sends.filter((s) => s.msg.type === "titlesEarned");
    expect(
      titleSends.some((s) => (s.msg as Extract<ServerMessage, { type: "titlesEarned" }>).titleIds.includes("sealbearer")),
    ).toBe(true);

    expect(broadcasts.filter((m) => m.type === "gameOver")).toEqual([{ type: "gameOver", outcome: "victory" }]);
    const roomStates = sends.filter((s) => s.msg.type === "roomState");
    const last = roomStates[roomStates.length - 1]!.msg as Extract<ServerMessage, { type: "roomState" }>;
    expect(last.room.phase).toBe("gameover");
    expect(last.room.outcome).toBe("victory");
    expect(last.room.contract?.completed).toBe(true);
  });

  it("settleRun cancels an open vote (it cannot outlive the run)", () => {
    const { room } = buildRoom({ humans: 2 });
    const { io, broadcasts } = recordingIO();

    machine.proposeMove(room, io, room.seats[0]!, { q: 1, r: 0 });
    expect(room.vote).not.toBeNull();

    machine.settleRun(room, io, "defeat");
    expect(room.vote).toBeNull();
    expect(broadcasts.some((m) => m.type === "voteState" && m.vote === null)).toBe(true);
  });

  it("defeat settle banks at 0.5 and bumps the wipes stat via the run-ended recorder", () => {
    const { room, runId, accountIds } = buildRoom();
    const { io, sends } = recordingIO();
    db.accruePendingXp(runId, accountIds[0]!, 25);

    machine.settleRun(room, io, "defeat");

    expect(accounts.loadProfilePayload(accountIds[0]!).xp).toBe(12); // floor(25 * 0.5)
    expect(accounts.getStats(accountIds[0]!)["wipes"]).toBe(1);
    expect(xpBankedSends(sends)[0]!.msg).toMatchObject({ pending: 25, multiplier: 0.5, banked: 12, xp: 12 });
  });

  it("run-ended is gated on the finalize transition: settling an already-final run emits nothing", () => {
    const { room, runId, accountIds } = buildRoom();
    db.accruePendingXp(runId, accountIds[0]!, 25);
    db.finalizeRun(runId, "abandoned"); // another path already settled the run

    const { io, sends } = recordingIO();
    machine.settleRun(room, io, "defeat");

    expect(xpBankedSends(sends).length).toBe(0); // no run-ended -> no settlement pushes
    expect(accounts.getStats(accountIds[0]!)["wipes"] ?? 0).toBe(0); // wipes recorder never ran
    expect(db.loadRun(runId)!.outcome).toBe("abandoned"); // first writer wins
    expect(accounts.loadProfilePayload(accountIds[0]!).xp).toBe(12); // banked once, by the first finalize
  });

  it("proposeRetreat guards: off-gateway, mid-combat, open vote, and spectator seats are rejected", () => {
    const { room } = buildRoom({ humans: 2 });
    const { io, sends } = recordingIO();
    const errorCodes = () =>
      sends.filter((s) => s.msg.type === "error").map((s) => (s.msg as Extract<ServerMessage, { type: "error" }>).code);

    machine.proposeRetreat(room, io, room.seats[0]!); // standing on "town"
    expect(errorCodes()).toEqual(["INVALID_MOVE"]);

    room.hexMap.icons[ORIGIN_KEY] = "gateway";
    room.phase = "combat";
    machine.proposeRetreat(room, io, room.seats[0]!);
    expect(errorCodes()).toEqual(["INVALID_MOVE", "BAD_PHASE"]);
    room.phase = "overworld";

    room.seats[1]!.state = "human-disconnected";
    machine.proposeRetreat(room, io, room.seats[1]!);
    expect(errorCodes()).toEqual(["INVALID_MOVE", "BAD_PHASE", "NOT_YOUR_SEAT"]);
    room.seats[1]!.state = "human-connected";

    machine.proposeMove(room, io, room.seats[0]!, { q: 1, r: 0 }); // opens a move vote
    machine.proposeRetreat(room, io, room.seats[1]!);
    expect(errorCodes()).toEqual(["INVALID_MOVE", "BAD_PHASE", "NOT_YOUR_SEAT", "BAD_PHASE"]);
    expect(db.loadRun(room.runId)!.active).toBe(1); // nothing settled
  });

  it("retreat vote accept: voteState{kind:retreat,target:null}, run finalizes 'retreat', 0.5 bank, no moveResolved", () => {
    const { room, runId, accountIds } = buildRoom({ humans: 2, icons: { [ORIGIN_KEY]: "gateway" } });
    const { io, broadcasts } = recordingIO();
    db.accruePendingXp(runId, accountIds[0]!, 25);

    machine.proposeRetreat(room, io, room.seats[0]!);
    const vs = broadcasts.find((m) => m.type === "voteState" && m.vote !== null) as Extract<
      ServerMessage,
      { type: "voteState" }
    >;
    expect(vs.vote).toMatchObject({ kind: "retreat", target: null, proposerSeatId: "s0" });
    expect(room.vote?.kind).toBe("retreat");

    machine.castVote(room, io, room.seats[1]!, vs.vote!.proposalId, "yes");

    expect(room.phase).toBe("gameover");
    expect(room.outcome).toBe("retreat");
    expect(db.loadRun(runId)!.outcome).toBe("retreat");
    expect(accounts.loadProfilePayload(accountIds[0]!).xp).toBe(12); // floor(25 * 0.5)
    expect(broadcasts.some((m) => m.type === "moveResolved")).toBe(false); // flag #9
    expect(broadcasts.filter((m) => m.type === "gameOver")).toEqual([{ type: "gameOver", outcome: "retreat" }]);
  });

  it("retreat vote rejected by a no majority: vote clears, run stays active at the overworld", () => {
    const { room, runId } = buildRoom({ humans: 3, capacity: 3, icons: { [ORIGIN_KEY]: "gateway" } });
    const { io, broadcasts } = recordingIO();

    machine.proposeRetreat(room, io, room.seats[0]!);
    const proposalId = room.vote!.proposalId;
    machine.castVote(room, io, room.seats[1]!, proposalId, "no");
    machine.castVote(room, io, room.seats[2]!, proposalId, "no");

    expect(room.vote).toBeNull();
    expect(broadcasts[broadcasts.length - 1]).toEqual({ type: "voteState", vote: null });
    expect(room.phase).toBe("overworld");
    expect(db.loadRun(runId)!.active).toBe(1);
    expect(broadcasts.some((m) => m.type === "gameOver" || m.type === "moveResolved")).toBe(false);
  });

  it("single connected human: proposeRetreat settles instantly, no vote opened", () => {
    const { room, runId } = buildRoom({ humans: 1, icons: { [ORIGIN_KEY]: "gateway" } });
    const { io, broadcasts } = recordingIO();

    machine.proposeRetreat(room, io, room.seats[0]!);

    expect(room.vote).toBeNull();
    expect(broadcasts.some((m) => m.type === "voteState" && m.vote !== null)).toBe(false);
    expect(room.phase).toBe("gameover");
    expect(db.loadRun(runId)!.outcome).toBe("retreat");
  });

  it("cancelVote on a retreat vote broadcasts voteState null and NO moveResolved", () => {
    const { room, runId } = buildRoom({ humans: 2, icons: { [ORIGIN_KEY]: "gateway" } });
    const { io, broadcasts } = recordingIO();

    machine.proposeRetreat(room, io, room.seats[0]!);
    expect(room.vote?.kind).toBe("retreat");

    machine.cancelVote(room, io);

    expect(room.vote).toBeNull();
    expect(broadcasts[broadcasts.length - 1]).toEqual({ type: "voteState", vote: null });
    expect(broadcasts.some((m) => m.type === "moveResolved")).toBe(false);
    expect(db.loadRun(runId)!.active).toBe(1); // a cancelled vote never settles the run
  });

  it("resetToOrigin cancels an open vote: a stale retreat vote cannot settle the fresh run", () => {
    const { room, runId } = buildRoom({ humans: 2, icons: { [ORIGIN_KEY]: "gateway" } });
    const { io, broadcasts } = recordingIO();

    machine.proposeRetreat(room, io, room.seats[0]!);
    expect(room.vote?.kind).toBe("retreat");

    machine.resetToOrigin(room, io, "abandoned");

    expect(room.vote).toBeNull(); // cancelled with its timer — it cannot fire into the new run
    expect(broadcasts.some((m) => m.type === "voteState" && m.vote === null)).toBe(true);
    expect(db.loadRun(runId)!.outcome).toBe("abandoned"); // the OLD run, not "retreat"
    expect(room.runId).not.toBe(runId);
    expect(db.loadRun(room.runId)!.active).toBe(1); // the fresh run is live
    expect(room.phase).toBe("overworld");
    expect(room.outcome).toBeNull();
    expect(room.contract?.type).toBe("chart-hexes"); // flag #2: default contract, no lobby on this path
  });

  it("a visited-hex move performs its durable write and broadcasts with hex-entered in the path", () => {
    const { room, runId } = buildRoom();
    const { io, broadcasts } = recordingIO();
    const target = { q: 1, r: 0 };
    room.visitedThisRun.add(hexKey(target));
    room.hexMap = { ...room.hexMap, hexes: { ...room.hexMap.hexes, [hexKey(target)]: "explored" } };

    machine.proposeMove(room, io, room.seats[0]!, target); // single human -> instant finalizeMove

    const run = db.loadRun(runId)!;
    expect([run.party_q, run.party_r]).toEqual([1, 0]); // durable write survived the emit
    expect(broadcasts.find((m) => m.type === "moveResolved")).toMatchObject({ accepted: true, target });
    const maps = broadcasts.filter((m) => m.type === "hexMapState") as Extract<
      ServerMessage,
      { type: "hexMapState" }
    >[];
    expect(maps[maps.length - 1]!.hexMap.playerPos).toEqual(target);

    // Type-level shape lock for the (not-yet-subscribed) hex-entered member — feature 4/5's seam.
    const ev: RunEvent = { type: "hex-entered", runId, hex: target, icon: null };
    expect(ev.type).toBe("hex-entered");
  });

  it("assignContract rejects a type the map does not offer with INVALID_INPUT", () => {
    const { room } = buildRoom();
    expect(() => assignContract(room, "no-such-contract" as never)).toThrow("not available");
    try {
      assignContract(room, "no-such-contract" as never);
    } catch (e) {
      expect((e as { code: string }).code).toBe("INVALID_INPUT");
    }
  });
});
