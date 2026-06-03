import type {
  CoopPhase,
  CoopStatusPayload,
  RoomStatePayload,
  SeatCombatStatus,
  SeatId,
} from "shared";

/**
 * Client-side holder for "who am I in this room": my seat id, the latest lobby/roster
 * snapshot (`roomState`) and the latest in-combat status (`coopStatus`). The
 * combat-ui-state accessors read it to answer ownership / whose-phase questions.
 *
 * Until multiplayer is fully wired (Phase 7) this stays empty (`mySeatId === null`) and
 * every getter returns null, so the accessors transparently fall back to the legacy
 * single-seat behaviour and the current game is unaffected.
 */
export class SeatContext {
  mySeatId: SeatId | null = null;
  room: RoomStatePayload | null = null;
  coop: CoopStatusPayload | null = null;

  setRoom(room: RoomStatePayload | null): void {
    this.room = room;
    if (room?.yourSeatId) this.mySeatId = room.yourSeatId;
  }

  setCoop(coop: CoopStatusPayload | null): void {
    this.coop = coop;
  }

  /** The EntityId of the hero this client controls, or null in single-seat fallback. */
  myHeroEntityId(): string | null {
    if (!this.mySeatId) return null;
    return this.room?.seats.find((s) => s.seatId === this.mySeatId)?.heroEntityId ?? null;
  }

  /** My seat's in-combat status, or null when not currently in a co-op combat. */
  mySeat(): SeatCombatStatus | null {
    if (!this.mySeatId || !this.coop) return null;
    return this.coop.seats.find((s) => s.seatId === this.mySeatId) ?? null;
  }

  coopPhase(): CoopPhase | null {
    return this.coop?.phase ?? null;
  }

  isHost(): boolean {
    return !!this.mySeatId && this.room?.hostSeatId === this.mySeatId;
  }
}
