import type { Entity } from "../core/types.js";
import { entityHasAffordableAction } from "./ability-cost.js";

/**
 * Pure decision logic for the shared free player phase (DESIGN.md §4, ruling R8). The server
 * Room owns the per-seat ready/exhausted flags and calls these to decide when to flip phases;
 * keeping the rules here makes them unit-testable without a running server.
 */

export interface SeatPhaseState {
  readonly ready: boolean; // the seat has passed this player phase
  readonly exhausted: boolean; // hero dead or out of affordable actions
}

/** The player phase ends once every seat has either passed or is exhausted. */
export function isPlayerPhaseOver(seats: readonly SeatPhaseState[]): boolean {
  return seats.length > 0 && seats.every((s) => s.ready || s.exhausted);
}

/** A seat is exhausted when its hero is missing/dead or can no longer afford any action. */
export function heroExhausted(hero: Entity | undefined): boolean {
  return !hero || !!hero.dead || !entityHasAffordableAction(hero);
}
