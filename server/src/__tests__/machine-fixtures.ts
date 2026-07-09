/**
 * Shared fixtures for machine-level Room tests (stub RoomIO, no Bun.serve).
 *
 * IMPORTANT: import this module DYNAMICALLY after setting GAME_DB_PATH/GAME_SKIP_SEED (the db.ts
 * precedent) — it transitively opens the database at module load:
 *
 *   process.env.GAME_DB_PATH = ":memory:";
 *   process.env.GAME_SKIP_SEED = "1";
 *   const fx = await import("./machine-fixtures.js");
 *
 * `roomShell` owns the Room literal so adding a Room field means editing ONE place, not every
 * test file. `buildTestRoom` covers the common overworld-room-with-humans setup; files with
 * bespoke durable state (gateway pools, pre-cleared hexes, unpersisted seats) keep their own DB
 * calls and compose `humanizeSeats` + `roomShell`.
 */
import type { HexCoord, RoomCode, SeatId, ServerMessage, ItemDefinition, ItemRarity } from "shared";
import { hexKey } from "shared";
import type { Room, Seat } from "../room.js";
import type { RoomIO } from "../room-machine.js";
import { createOpenSeats } from "../room.js";
import {
  db,
  getDimensionMeta,
  saveDimension,
  startNewRun,
  setRunPhase,
  markRunCleared,
  upsertRunSeat,
  newTokenSalt,
} from "../db.js";
import { resolveGuestAccount } from "../accounts.js";

export const ORIGIN: HexCoord = { q: 0, r: 0 };
export const ORIGIN_KEY = hexKey(ORIGIN);

// One process-wide counter: clientIds and room codes stay unique across every importing file.
let seq = 0;

export function mkWeapon(id: string, dimensionId: number, rarity: ItemRarity = "common"): ItemDefinition {
  return {
    type: "weapon", id, name: id, description: "", rarity, sprite: `${id}.webp`,
    dimensionId, slotCost: { hand: 1 }, animSet: "sword", abilities: [],
  };
}

export interface SentRecord { seatId: SeatId; msg: ServerMessage; note?: string }
/** One outbound message in emit order — sends and broadcasts merged, wire-log note included. */
export interface OutRecord { kind: "send" | "broadcast"; seatId?: SeatId; msg: ServerMessage; note?: string }

/** A RoomIO that records every send/broadcast for assertions. `all` preserves the emit order. */
export function recordingIO() {
  const sends: SentRecord[] = [];
  const broadcasts: ServerMessage[] = [];
  const all: OutRecord[] = [];
  const io: RoomIO = {
    send(seat, msg, note) {
      sends.push({ seatId: seat.seatId, msg, note });
      all.push({ kind: "send", seatId: seat.seatId, msg, note });
    },
    broadcast(_room, msg, note) {
      broadcasts.push(msg);
      all.push({ kind: "broadcast", msg, note });
    },
  };
  return { io, sends, broadcasts, all };
}

export function noopIO(): RoomIO {
  return { send() {}, broadcast() {} };
}

export function errorCodes(sends: SentRecord[]): string[] {
  return sends.filter((s) => s.msg.type === "error").map((s) => (s.msg as Extract<ServerMessage, { type: "error" }>).code);
}

/**
 * Bind the first `humans` seats to connected guest accounts (the rest become bots) and return the
 * account ids. `persist: false` skips the durable run_seats rows for tests that only exercise
 * in-memory machinery.
 */
export function humanizeSeats(seats: Seat[], opts: {
  runId: number;
  humans: number;
  clientPrefix: string;
  sameAccount?: boolean;
  persist?: boolean;
}): string[] {
  const accountIds: string[] = [];
  let sharedAccountId: string | null = null;
  for (let i = 0; i < opts.humans; i++) {
    const seat = seats[i]!;
    const clientId = `${opts.clientPrefix}-${i}`;
    const account = opts.sameAccount
      ? (sharedAccountId ??= resolveGuestAccount(`${opts.clientPrefix}-shared`).id)
      : resolveGuestAccount(clientId).id;
    seat.state = "human-connected";
    seat.clientId = clientId;
    seat.accountId = account;
    seat.socket = {} as never; // recording io never touches it; non-null so per-seat sends happen
    accountIds.push(account);
    if (opts.persist ?? true) {
      upsertRunSeat(opts.runId, i, {
        clientId, displayName: `P${i}`, controllerKind: "human",
        tokenSalt: newTokenSalt(), accountId: account,
      });
    }
  }
  for (let i = opts.humans; i < seats.length; i++) seats[i]!.state = "bot";
  return accountIds;
}

/**
 * The one Room literal. Every field defaulted for a live overworld room; pass overrides for
 * anything test-specific. `code`, `runId`, and `seats` are required; capacity defaults to
 * seats.length and startDimensionId to dimensionId.
 */
export function roomShell(over: Partial<Room> & Pick<Room, "code" | "runId" | "seats">): Room {
  const dimensionId = over.dimensionId ?? 1;
  const base: Room = {
    code: over.code,
    hostSeatId: over.seats[0]?.seatId ?? null,
    phase: "overworld",
    building: false,
    generation: 0,
    combat: null,
    dimensionId,
    startDimensionId: dimensionId,
    dimensionName: getDimensionMeta(dimensionId)?.name ?? `Dim ${dimensionId}`,
    dimensionTier: 0,
    gateways: {},
    runId: over.runId,
    hexMap: { playerPos: ORIGIN, hexes: { [ORIGIN_KEY]: "explored" }, icons: { [ORIGIN_KEY]: "town" } },
    visitedThisRun: new Set([ORIGIN_KEY]),
    runClearedCount: 0,
    pendingHex: null,
    rested: false,
    capacity: over.seats.length,
    seats: over.seats,
    listed: false,
    rematchCode: null,
    session: null,
    defendRound: null,
    vote: null,
    partyBag: [],
    contract: null,
    outcome: null,
    chatLog: [],
    reapTimer: null,
    lastActivityMs: Date.now(),
  };
  return { ...base, ...over };
}

export interface TestRoomOpts {
  dim: number;
  /** Room.dimensionTier; defaults to the dimensions row's tier (or 0 when absent). */
  tier?: number | null;
  humans?: number;
  capacity?: number;
  sameAccount?: boolean;
  /** clientId/room-code prefix — purely cosmetic; uniqueness comes from the shared counter. */
  prefix?: string;
}

/**
 * The common machine-level room: a durable overworld run in `dim` (a dimensions row is created if
 * missing so crash recovery in other files can reconstruct it), origin cleared, `humans` connected
 * guest seats persisted, bots in the rest.
 */
export function buildTestRoom(opts: TestRoomOpts) {
  const capacity = opts.capacity ?? 2;
  const humans = opts.humans ?? 1;
  const prefix = `${opts.prefix ?? "t"}${++seq}`;
  if (!getDimensionMeta(opts.dim)) saveDimension(opts.dim, `Dim ${opts.dim}`, []);
  const runId = startNewRun(opts.dim, `${prefix}-0`, capacity);
  setRunPhase(runId, "overworld");
  markRunCleared(runId, opts.dim, ORIGIN);

  const seats = createOpenSeats(capacity);
  const accountIds = humanizeSeats(seats, {
    runId, humans, clientPrefix: prefix, sameAccount: opts.sameAccount ?? false,
  });

  const meta = getDimensionMeta(opts.dim)!;
  const room = roomShell({
    code: prefix.toUpperCase() as RoomCode,
    runId,
    seats,
    capacity,
    dimensionId: opts.dim,
    dimensionName: meta.name,
    dimensionTier: opts.tier ?? meta.tier ?? 0,
  });
  return { room, runId, seats, seat: seats[0]!, accountIds };
}

// Re-exported so importing test files don't need a second dynamic import for raw SQL setup.
export { db };
