/**
 * Account progression curve (docs/meta-loop/01-accounts.md §2.1).
 *
 * Account level grants ZERO combat stats by construction: nothing under
 * shared/src/combat/ or the encounter builder may import this module. The only
 * consumers are expedition slots (feature 3), titles, and UI.
 */

import type { RunOutcome } from "../net/protocol.js";

/** Tunable: flat XP per encounter win, v1 (feature 5 scales by difficulty). */
export const XP_ENCOUNTER_WIN = 25;

/** Locked decisions 6/7 (+ 02-contracts flag #3 for abandoned): pending-XP bank multiplier by outcome. */
export const XP_BANK_MULTIPLIER: Readonly<Record<RunOutcome, number>> = {
  victory: 1,
  retreat: 0.5,
  defeat: 0.5,
  abandoned: 0.5,
};

/** The single banked-amount formula — used by db.finalizeRun AND the settlement pushes. */
export function bankedXp(pending: number, outcome: RunOutcome): number {
  return Math.floor(pending * XP_BANK_MULTIPLIER[outcome]);
}

/** Total XP required to have reached `level` (level 1 = 0). Cost of n -> n+1 is 100*n. */
export function xpToReachLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new Error(`xpToReachLevel: bad level ${level}`);
  return 50 * level * (level - 1);
}

/** Inverse of xpToReachLevel. Closed-form guess + integer-exact adjustment (no FP boundary bugs). */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp < 0) throw new Error(`levelForXp: bad xp ${xp}`);
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2));
  while (xpToReachLevel(level + 1) <= xp) level++;
  while (level > 1 && xpToReachLevel(level) > xp) level--;
  return level;
}

/** Locked decision 5: manifest slots. Tunable constant lives here with the curve. */
export function expeditionSlots(level: number): number {
  return 2 + Math.floor(level / 5);
}
