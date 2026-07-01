import { XP_ENCOUNTER_WIN } from "shared";
import type { Room, Seat } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import {
  awardXp,
  bumpStat,
  evaluateTitles,
  loadCardProfile,
  loadProfilePayload,
  recordDimensionSeen,
} from "./accounts.js";

/**
 * XP / stat / title recorders at the sites where the events already happen
 * (docs/meta-loop/01-accounts.md §6). All writes are synchronous SQLite inside already-synchronous
 * paths — no awaits inside the R7-guarded machine. xpAward/titlesEarned/profile go per-seat via
 * io.send (PRIVATE — one player's XP totals never leak to the room); a disconnected human's seat
 * has socket === null, so the DB writes land and the pushes are simply skipped.
 */

/** Eligible: attributed + still the human's seat. A permanent leaver is already a bot (earns nothing). */
function eligibleSeats(room: Room): Seat[] {
  return room.seats.filter(
    (s) => s.accountId !== null && (s.state === "human-connected" || s.state === "human-disconnected"),
  );
}

function refreshCardProfile(seat: Seat, accountId: string): void {
  const card = loadCardProfile(accountId);
  seat.cardProfile = { level: card.level, equippedTitleId: card.equippedTitleId };
}

/** Encounter win: XP + encounters_won + hexes_charted (a win on pendingHex IS the charting event). */
export function awardEncounterWin(room: Room, io: RoomIO): void {
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    const award = awardXp(accountId, XP_ENCOUNTER_WIN);
    bumpStat(accountId, "encounters_won", 1);
    bumpStat(accountId, "hexes_charted", 1);
    const newTitles = evaluateTitles(accountId);
    refreshCardProfile(seat, accountId);
    io.send(seat, {
      type: "xpAward",
      amount: XP_ENCOUNTER_WIN,
      xp: award.xp,
      level: award.level,
      leveledUp: award.leveledUp,
    });
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

/** Party wipe: wipes stat only (the 50% pending-XP banking is feature 2's seam). */
export function recordWipe(room: Room, io: RoomIO): void {
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    bumpStat(accountId, "wipes", 1);
    const newTitles = evaluateTitles(accountId);
    refreshCardProfile(seat, accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

/** Expedition start: chart the dimension per account (first insert bumps dimensions_discovered).
 *  New grants push titlesEarned + a fresh profile (§3.4: titlesEarned fires on ANY new grant). */
export function recordDimensionsSeen(room: Room, io: RoomIO): void {
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    const first = recordDimensionSeen(accountId, room.dimensionId);
    const newTitles = evaluateTitles(accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    if (first || newTitles.length > 0) io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}
