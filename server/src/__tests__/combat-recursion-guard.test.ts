import { describe, it, expect } from "bun:test";
import type { AiStepResult } from "../ai-turn-runner.js";
import type { EncounterSession } from "../encounter-session.js";
import type { Room, Seat } from "../room.js";
import { driveCombat, MAX_COMBAT_DRIVE_DEPTH, type RoomIO } from "../room-machine.js";
import { enterEnemy } from "../combat-runtime.js";

/**
 * Reproduction for the unbounded synchronous recursion in the combat scheduler (bug: RangeError
 * "Maximum call stack size exceeded" in wire-transport.ts emit(), reached via
 *   driveCombat -> openDefendRound -> maybeResolveDefendRound -> continueAfterDefend -> driveCombat.
 *
 * This drives the REAL room-machine functions (driveCombat / openDefendRound /
 * maybeResolveDefendRound / continueAfterDefend) with a session whose step outputs replay the
 * production-observed "no-human-target defend round" cycle:
 *
 *   - a human seat IS connected (so the scheduler doesn't suspend), but
 *   - every enemy defend prompt targets a BOT seat, so openDefendRound sees no human target and
 *     auto-resolves it synchronously (force=true), which resumes the enemy sweep, which produces
 *     the next defend prompt, ... forever.
 *
 * Each cycle re-enters driveCombat synchronously without unwinding, so the JS stack grows one
 * cycle at a time. The stack trace captured in production is exactly this loop.
 */

// A no-op transport; the scheduler only reaches clients through this.
const io: RoomIO = { send() {}, broadcast() {} };

function makeSeat(seatIndex: number, state: Seat["state"]): Seat {
  return {
    seatId: `s${seatIndex}` as Seat["seatId"],
    seatIndex,
    heroEntityId: `s${seatIndex}-hero`,
    state,
    socket: null,
    displayName: `seat-${seatIndex}`,
    ready: false,
    exhausted: false,
    // Fields the scheduler cycle under test never reads — filled minimally to satisfy the type.
    clientId: null,
    tokenSalt: null,
    brain: null,
    inventory: { equipped: [], bag: [], attachments: {} } as unknown as Seat["inventory"],
    presetId: null,
    manifestIds: [],
    animSet: {} as unknown as Seat["animSet"],
    accountId: null,
    cardProfile: null,
    chatTimestamps: [],
    actedThisPhase: false,
    disconnectGraceTimer: null,
    afkTimer: null,
  };
}

/**
 * A session stub that replays the pathological cycle: every AI step is an enemy attack that prompts
 * a defend on the BOT seat's hero, and resolving it yields more enemy events (never a win / end), so
 * the enemy sweep keeps producing defend prompts. This is the sequence the real EncounterSession was
 * observed producing in the no-human-target ping-pong (per the captured stack trace).
 */
function pingPongSession(botHeroId: string): EncounterSession {
  const defendPrompt: AiStepResult = {
    type: "defendPrompt",
    roundId: "round-1",
    attackerId: "enemy-0",
    attackerPosition: { x: 0, y: 0 },
    aimDirection: { x: 1, y: 0 } as unknown as never,
    ability: { id: "enemy-slash" } as unknown as never,
    targetIds: [botHeroId],
  };
  const resolvedEvents: AiStepResult = {
    type: "events",
    serializedState: {},
    events: [],
    won: false,
  };
  return {
    stepAi: () => defendPrompt,
    resolveDefend: () => resolvedEvents,
    pendingDefendRoundId: "round-1",
  } as unknown as EncounterSession;
}

function makePingPongRoom(): Room {
  const human = makeSeat(0, "human-connected"); // keeps hasConnectedHuman() true -> no suspend
  const bot = makeSeat(1, "bot"); // the only defend target -> round always auto-resolves
  const room = {
    code: "TEST",
    generation: 1,
    combat: enterEnemy(), // an enemy sweep is in flight, so defend rounds resume the enemy sweep
    seats: [human, bot],
    session: pingPongSession(bot.heroEntityId),
    defendRound: null,
    hostSeatId: human.seatId,
  } as unknown as Room;
  return room;
}

describe("combat scheduler re-entrancy guard", () => {
  it("no-human-target defend ping-pong terminates via the depth guard instead of overflowing the stack", () => {
    const room = makePingPongRoom();

    // Without the guard this recurses until `RangeError: Maximum call stack size exceeded`.
    // With the guard, driveCombat bails at MAX_COMBAT_DRIVE_DEPTH and unwinds cleanly.
    expect(() => driveCombat(room, io)).not.toThrow();

    // The synchronous re-entrancy unwound completely (back to off-combat depth).
    expect(room.combatDriveDepth ?? 0).toBe(0);
  });

  it("does not perturb the depth counter for a normal (non-recursive) combat step", () => {
    // A session that ends immediately (winner) exercises driveCombat once, no re-entry.
    const room = makePingPongRoom();
    (room.session as unknown as { stepAi: () => AiStepResult }).stepAi = () => ({
      type: "events",
      serializedState: {},
      events: [],
      won: true,
    });
    // endCombat needs more of a real Room than this stub provides; we only assert the guard
    // bookkeeping unwinds even when the body throws for an unrelated reason.
    try {
      driveCombat(room, io);
    } catch {
      /* endCombat on the stub room may throw; the finally must still restore depth */
    }
    expect(room.combatDriveDepth ?? 0).toBe(0);
  });
});
