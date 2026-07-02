import { XP_ENCOUNTER_WIN, XP_BANK_MULTIPLIER, bankedXp, levelForXp, scaledXp, hexDistance, isRestNodeIcon } from "shared";
import type { HexIconType } from "shared";
import type { Room, Seat } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import { ORIGIN } from "./room-machine.js";
import type { RunEvent } from "./run-events.js";
import { accruePendingXp, loadPendingXp } from "./db.js";
import {
  bumpStat,
  evaluateTitles,
  loadCardProfile,
  loadProfilePayload,
  recordDimensionSeen,
} from "./accounts.js";

/**
 * XP / stat / title recorders, driven by the run-event bus (docs/meta-loop/02-contracts.md §4.2;
 * ex awards.ts). All writes are synchronous SQLite inside already-synchronous paths — no awaits
 * inside the R7-guarded machine. xpAward/xpBanked/titlesEarned/profile go per-seat via io.send
 * (PRIVATE — one player's XP totals never leak to the room); a disconnected human's seat has
 * socket === null, so the DB writes land and the pushes are simply skipped.
 */

/** Eligible: attributed + still the human's seat. A permanent leaver is already a bot (earns nothing). */
export function eligibleSeats(room: Room): Seat[] {
  return room.seats.filter(
    (s) => s.accountId !== null && (s.state === "human-connected" || s.state === "human-disconnected"),
  );
}

function refreshCardProfile(seat: Seat, accountId: string): void {
  const card = loadCardProfile(accountId);
  seat.cardProfile = { level: card.level, equippedTitleId: card.equippedTitleId };
}

/** Expedition start: chart the dimension per account (first insert bumps dimensions_discovered).
 *  New grants push titlesEarned + a fresh profile (01 §3.4: titlesEarned fires on ANY new grant). */
export function recordRunStarted(room: Room, io: RoomIO, ev: Extract<RunEvent, { type: "run-started" }>): void {
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    const first = recordDimensionSeen(accountId, ev.dimensionId);
    const newTitles = evaluateTitles(accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    if (first || newTitles.length > 0) io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

/** Encounter win: pending-XP accrual + encounters_won + hexes_charted (a win on pendingHex IS the
 *  charting event). XP lands in the per-run ledger, banked by finalizeRun with the outcome multiplier. */
export function recordEncounterWon(room: Room, io: RoomIO, ev: Extract<RunEvent, { type: "encounter-won" }>): void {
  // Scale the win XP by dimension tier + distance from origin (05-difficulty §4.5; 02 §9's reserved
  // seam). Party size never scales XP (it normalizes fight fairness, not reward). Tier 0 / dist ≤2 = 25.
  const amount = scaledXp(XP_ENCOUNTER_WIN, room.dimensionTier, hexDistance(ev.hex, ORIGIN));
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    const pending = accruePendingXp(ev.runId, accountId, amount);
    bumpStat(accountId, "encounters_won", 1);
    bumpStat(accountId, "hexes_charted", 1);
    const newTitles = evaluateTitles(accountId);
    refreshCardProfile(seat, accountId);
    io.send(seat, { type: "xpAward", amount, pending });
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

/** dimension-entered: chart the destination for every attributed seat (this is what makes it appear
 *  in future run-start pickers — locked #9), bump dimensions_traveled, evaluate titles. Travel awards
 *  no XP itself (the descent payoff is loot tier). */
export function recordDimensionEntered(room: Room, io: RoomIO, ev: Extract<RunEvent, { type: "dimension-entered" }>): void {
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    const first = recordDimensionSeen(accountId, ev.dimensionId);
    bumpStat(accountId, "dimensions_traveled", 1);
    const newTitles = evaluateTitles(accountId);
    refreshCardProfile(seat, accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    if (first || newTitles.length > 0) io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

/** Run settled: outcome stats + the xpBanked settlement pushes (banking itself already happened
 *  atomically inside finalizeRun; the surviving ledger rows are what we read back here). */
export function recordRunSettled(room: Room, io: RoomIO, ev: Extract<RunEvent, { type: "run-ended" }>): void {
  const rows = loadPendingXp(ev.runId);
  const byAccount = new Map(rows.map((r) => [r.account_id, r.amount]));
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    if (ev.outcome === "defeat") bumpStat(accountId, "wipes", 1);
    if (ev.outcome === "victory") bumpStat(accountId, "contracts_completed", 1);
    const pending = byAccount.get(accountId) ?? 0;
    const banked = bankedXp(pending, ev.outcome); // same shared formula finalizeRun banked with
    const profile = loadProfilePayload(accountId); // post-banking totals
    const before = profile.xp - banked;
    io.send(seat, {
      type: "xpBanked",
      pending,
      multiplier: XP_BANK_MULTIPLIER[ev.outcome],
      banked,
      xp: profile.xp,
      level: profile.level,
      leveledUp: profile.level > levelForXp(before),
    });
    const newTitles = evaluateTitles(accountId); // banking/contract stat may level/earn
    refreshCardProfile(seat, accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

/** Rest grant (05-difficulty flag #8): arriving on a cleared rest node (town/city/gateway-city)
 *  makes the party Rested — every hero enters the next combat with REST_BARRIER_HP barrier.
 *  Idempotent: no re-broadcast while already rested (no toast spam on repeated arrivals). */
function grantRest(room: Room, io: RoomIO, icon: HexIconType | null): void {
  if (!isRestNodeIcon(icon)) return;
  if (room.rested) return;
  room.rested = true;
  io.broadcast(room, { type: "restUpdate", rested: true });
}

export function restOnArrivalRecorder(room: Room, io: RoomIO, ev: Extract<RunEvent, { type: "hex-entered" }>): void {
  grantRest(room, io, ev.icon);
}

export function restOnClearRecorder(room: Room, io: RoomIO, ev: Extract<RunEvent, { type: "encounter-won" }>): void {
  grantRest(room, io, ev.icon);
}

export function restOnTravelRecorder(room: Room, io: RoomIO, _ev: Extract<RunEvent, { type: "dimension-entered" }>): void {
  grantRest(room, io, "town"); // 04's commitTravel lands the party on the destination's auto-cleared origin town
}
