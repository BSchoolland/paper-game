import { describe, it, expect } from "bun:test";
import type { HexCoord, HexIconType, RoomCode, ServerMessage } from "shared";
import { hexKey, REST_BARRIER_HP } from "shared";

// db.ts opens its Database at module load from GAME_DB_PATH, so set env BEFORE importing anything
// that pulls it in (db.test.ts precedent). :memory: keeps the file hermetic; dimension 0 is seeded
// explicitly (not the auto-boot seed) so the combat-build tests have real enemies to roll.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");
const { createOpenSeats } = await import("../room.js");
const machine = await import("../room-machine.js");
const recorders = await import("../run-recorders.js");
const { emitRunEvent } = await import("../run-events.js");
const { seedDimension0 } = await import("../seed.js");
const fx = await import("./machine-fixtures.js");
const { recordingIO } = fx;

seedDimension0(); // dimension 0 with real enemy templates, for the beginCombatEntry build tests

const ORIGIN_KEY = hexKey({ q: 0, r: 0 });
let seq = 0;

/** A tiered dimension row (mirrors travel.test's mkDim) so getDimensionMeta returns a real tier. */
function mkDim(id: number, tier: number | null): void {
  db.saveDimension(id, `Rest Dim ${id}`, [], `bg-${id}.png`, undefined, "approved");
  db.db.prepare("INSERT OR REPLACE INTO enemy_templates (id, dimension_id, template_json) VALUES (?, ?, '{}')").run(`e-${id}`, id);
  if (tier !== null) db.db.prepare("UPDATE dimensions SET tier = ? WHERE id = ?").run(tier, id);
}

/** A Room at the overworld with a real durable run. `withSockets` gives human seats a stub socket so
 *  the per-seat roomState send fires; bot-only rooms let beginCombatEntry build then park (no human). */
function buildRoom(opts?: {
  humans?: number;
  capacity?: number;
  dimensionId?: number;
  dimensionTier?: number | null;
  startDimensionId?: number;
  icons?: Record<string, HexIconType>;
  playerPos?: HexCoord;
  rested?: boolean;
}) {
  const capacity = opts?.capacity ?? 2;
  const humans = opts?.humans ?? 1;
  const dimensionId = opts?.dimensionId ?? 0;
  const startDimensionId = opts?.startDimensionId ?? dimensionId;
  const s = ++seq;
  const runId = db.startNewRun(startDimensionId, `rest-${s}-0`, capacity);
  db.setRunPhase(runId, "overworld");
  db.markRunCleared(runId, dimensionId, { q: 0, r: 0 });

  const seats = createOpenSeats(capacity);
  const accountIds = fx.humanizeSeats(seats, { runId, humans, clientPrefix: `rest-${s}` });

  const room = fx.roomShell({
    code: `REST${s}` as RoomCode,
    runId,
    seats,
    capacity,
    dimensionId,
    startDimensionId,
    dimensionName: db.getDimensionMeta(dimensionId)?.name ?? "Rest Dim",
    dimensionTier: opts?.dimensionTier ?? 0,
    hexMap: {
      playerPos: opts?.playerPos ?? { q: 0, r: 0 },
      hexes: { [ORIGIN_KEY]: "explored" },
      icons: { [ORIGIN_KEY]: "town", ...(opts?.icons ?? {}) },
    },
    rested: opts?.rested ?? false,
  });
  return { room, runId, accountIds };
}

function restUpdates(broadcasts: ServerMessage[]) {
  return broadcasts.filter((m): m is Extract<ServerMessage, { type: "restUpdate" }> => m.type === "restUpdate");
}

describe("rest grant (machine-level, stub RoomIO)", () => {
  it("hex-entered on a rest node arms rest + broadcasts restUpdate; non-rest icons and repeats do not", () => {
    for (const icon of ["town", "city", "gateway-city"] as HexIconType[]) {
      const { room, runId } = buildRoom();
      const { io, broadcasts } = recordingIO();
      emitRunEvent(room, io, { type: "hex-entered", runId, hex: { q: 1, r: 0 }, icon });
      expect(room.rested).toBe(true);
      expect(restUpdates(broadcasts)).toEqual([{ type: "restUpdate", rested: true }]);
    }

    // Plain wilderness (null) and a non-settlement icon never arm rest.
    for (const icon of [null, "ruins" as HexIconType]) {
      const { room, runId } = buildRoom();
      const { io, broadcasts } = recordingIO();
      emitRunEvent(room, io, { type: "hex-entered", runId, hex: { q: 1, r: 0 }, icon });
      expect(room.rested).toBe(false);
      expect(restUpdates(broadcasts).length).toBe(0);
    }

    // Idempotent: a second arrival while already rested does not re-broadcast (no toast spam).
    const { room, runId } = buildRoom({ rested: true });
    const { io, broadcasts } = recordingIO();
    emitRunEvent(room, io, { type: "hex-entered", runId, hex: { q: 2, r: 0 }, icon: "town" });
    expect(room.rested).toBe(true);
    expect(restUpdates(broadcasts).length).toBe(0);
  });

  it("restOnClearRecorder arms rest when the cleared hex is a town, not on a plain hex", () => {
    const won = buildRoom();
    const wonIo = recordingIO();
    recorders.restOnClearRecorder(won.room, wonIo.io, {
      type: "encounter-won", runId: won.runId, hex: { q: 1, r: 0 }, icon: "town", firstEver: true, clearedCount: 1,
    });
    expect(won.room.rested).toBe(true);
    expect(restUpdates(wonIo.broadcasts).length).toBe(1);

    const plain = buildRoom();
    const plainIo = recordingIO();
    recorders.restOnClearRecorder(plain.room, plainIo.io, {
      type: "encounter-won", runId: plain.runId, hex: { q: 1, r: 0 }, icon: null, firstEver: true, clearedCount: 1,
    });
    expect(plain.room.rested).toBe(false);
    expect(restUpdates(plainIo.broadcasts).length).toBe(0);
  });

  it("restOnTravelRecorder arms rest on arrival (the destination origin is an auto-cleared town)", () => {
    const { room, runId } = buildRoom();
    const { io, broadcasts } = recordingIO();
    recorders.restOnTravelRecorder(room, io, { type: "dimension-entered", runId, dimensionId: room.dimensionId, tier: 1 });
    expect(room.rested).toBe(true);
    expect(restUpdates(broadcasts)).toEqual([{ type: "restUpdate", rested: true }]);
  });
});

describe("rest consumption at combat entry (machine-level)", () => {
  it("a rested room's heroes enter combat with REST_BARRIER_HP barrier (enemies 0); rest is consumed and the pre-build roomState carries rested:false", async () => {
    const { room } = buildRoom({ humans: 2, capacity: 2, rested: true });
    const { io, sends, broadcasts } = recordingIO();

    await machine.beginCombatEntry(room, io, { q: 1, r: 0 });

    // Consumed on entry, and the synchronous pre-build broadcast already reflected it.
    expect(room.rested).toBe(false);
    const roomStates = sends.filter((r) => r.msg.type === "roomState");
    expect(roomStates.length).toBeGreaterThan(0);
    expect((roomStates[0]!.msg as Extract<ServerMessage, { type: "roomState" }>).room.rested).toBe(false);

    // combatStart rides the rolled archetype.
    const combatStart = broadcasts.find((m) => m.type === "combatStart") as Extract<ServerMessage, { type: "combatStart" }>;
    expect(typeof combatStart.archetype).toBe("string");

    const entities = room.session!.state.entities;
    expect(entities.get("s0-hero")!.barrier).toBe(REST_BARRIER_HP);
    expect(entities.get("s1-hero")!.barrier).toBe(REST_BARRIER_HP);
    const enemies = [...entities.values()].filter((e) => e.teamId === "blue");
    expect(enemies.length).toBeGreaterThanOrEqual(1);
    for (const e of enemies) expect(e.barrier).toBe(0);

    machine.disposeRoom(room); // clear the player-phase AFK timers this drove
  }, 20000);

  it("an un-rested room's heroes enter combat with 0 barrier", async () => {
    const { room } = buildRoom({ humans: 2, capacity: 2, rested: false });
    const { io } = recordingIO();

    await machine.beginCombatEntry(room, io, { q: 1, r: 0 });

    const entities = room.session!.state.entities;
    expect(entities.get("s0-hero")!.barrier).toBe(0);
    expect(entities.get("s1-hero")!.barrier).toBe(0);

    machine.disposeRoom(room);
  }, 20000);

  it("a failed encounter build restores the unspent rest (the rest was not consumed)", async () => {
    // A bogus current dimension makes createEncounter throw before any barrier is stamped.
    const { room } = buildRoom({ humans: 1, capacity: 2, dimensionId: 424242, rested: true });
    const { io } = recordingIO();

    await machine.beginCombatEntry(room, io, { q: 1, r: 0 });

    expect(room.session).toBeNull();
    expect(room.phase).toBe("overworld");
    expect(room.rested).toBe(true); // build failed -> rest survives
  });
});

describe("rest reset across run boundaries (machine-level)", () => {
  it("resetToOrigin clears rest (a fresh run starts un-rested)", () => {
    mkDim(6000, 0);
    const { room } = buildRoom({ humans: 1, capacity: 2, dimensionId: 6000, startDimensionId: 6000, rested: true });
    const { io } = recordingIO();

    machine.resetToOrigin(room, io, "defeat");
    expect(room.rested).toBe(false);
  });

  it("reconstructRoomForRun rebuilds with rest false (ephemeral: lost on crash by design)", () => {
    mkDim(6100, 1);
    const runId = db.startNewRun(6100, "rest-reconstruct-0", 2);
    db.setRunPhase(runId, "overworld");
    db.markRunCleared(runId, 6100, { q: 0, r: 0 });
    db.upsertRunSeat(runId, 0, { clientId: "rest-reconstruct-0", displayName: "P0", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });

    const rebuilt = machine.reconstructRoomForRun(runId, () => {})!;
    expect(rebuilt.rested).toBe(false);
    machine.disposeRoom(rebuilt); // clear the reconstructed room's reap timer
  });
});

describe("scaled reward accrual (machine-level)", () => {
  it("recordEncounterWon scales the win XP by tier + distance (02 regression: tier 0 near origin = 25)", () => {
    // tier 1, distance 5 -> round(25 * 1.4 * 1.21) = 42 (05 §2.1 worked example).
    const scaled = buildRoom({ humans: 1, dimensionId: 0, dimensionTier: 1 });
    const scaledIo = recordingIO();
    recorders.recordEncounterWon(scaled.room, scaledIo.io, {
      type: "encounter-won", runId: scaled.runId, hex: { q: 5, r: 0 }, icon: null, firstEver: false, clearedCount: 1,
    });
    expect(db.loadPendingXp(scaled.runId).map((r) => r.amount)).toEqual([42]);
    const scaledAward = scaledIo.sends.find((r) => r.msg.type === "xpAward")!.msg as Extract<ServerMessage, { type: "xpAward" }>;
    expect(scaledAward.amount).toBe(42);

    // tier 0, within the grace radius -> exactly today's flat 25.
    const flat = buildRoom({ humans: 1, dimensionId: 0, dimensionTier: 0 });
    const flatIo = recordingIO();
    recorders.recordEncounterWon(flat.room, flatIo.io, {
      type: "encounter-won", runId: flat.runId, hex: { q: 2, r: 0 }, icon: null, firstEver: false, clearedCount: 1,
    });
    expect(db.loadPendingXp(flat.runId).map((r) => r.amount)).toEqual([25]);
    const flatAward = flatIo.sends.find((r) => r.msg.type === "xpAward")!.msg as Extract<ServerMessage, { type: "xpAward" }>;
    expect(flatAward.amount).toBe(25);
  });

  it("settleRun(victory) prices the contract reward by the run's START tier; tier 0 = the flat reward", () => {
    // chart-hexes reward is 80. Tier 2 start -> scaledXp(80, 2, 0) = round(80 * 1.8) = 144.
    mkDim(6200, 2);
    const tier2 = buildRoom({ humans: 1, dimensionId: 6200, startDimensionId: 6200, dimensionTier: 2 });
    tier2.room.contract = { type: "chart-hexes", targetHex: null, targetDimensionId: null, progress: 1, required: 1, completed: true };
    db.saveRunContract(tier2.runId, tier2.room.contract);
    const tier2Io = recordingIO();
    machine.settleRun(tier2.room, tier2Io.io, "victory");
    // Sole eligible seat: 144 accrued, banked at the 1.0 victory multiplier.
    expect(accounts.loadProfilePayload(tier2.accountIds[0]!).xp).toBe(144);

    mkDim(6201, 0);
    const tier0 = buildRoom({ humans: 1, dimensionId: 6201, startDimensionId: 6201, dimensionTier: 0 });
    tier0.room.contract = { type: "chart-hexes", targetHex: null, targetDimensionId: null, progress: 1, required: 1, completed: true };
    db.saveRunContract(tier0.runId, tier0.room.contract);
    const tier0Io = recordingIO();
    machine.settleRun(tier0.room, tier0Io.io, "victory");
    expect(accounts.loadProfilePayload(tier0.accountIds[0]!).xp).toBe(80);
  });
});
