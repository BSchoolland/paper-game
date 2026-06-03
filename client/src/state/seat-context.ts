import type {
  CoopPhase,
  CoopStatusPayload,
  RoomStatePayload,
  SeatCombatStatus,
  SeatId,
  SeatInfo,
} from "shared";

type Listener = () => void;

/**
 * The live holder for "who am I in this room": my seat id, the latest lobby/roster snapshot
 * (`roomState`) and the latest in-combat status (`coopStatus`), fed from RoomConnection
 * messages. The combat-ui-state accessors read it to answer ownership / whose-phase questions.
 * There is no single-seat fallback: a missing seat is a bug, not a default.
 */
export class SeatContext {
  mySeatId: SeatId | null = null;
  room: RoomStatePayload | null = null;
  coop: CoopStatusPayload | null = null;
  private listeners: Listener[] = [];

  setRoom(room: RoomStatePayload | null): void {
    this.room = room;
    if (room?.yourSeatId) this.mySeatId = room.yourSeatId;
    else if (!room) this.mySeatId = null;
    this.notify();
  }

  setCoop(coop: CoopStatusPayload | null): void {
    this.coop = coop;
    this.notify();
  }

  /** My seat's lobby/roster entry, or null before a room is joined. */
  mySeatInfo(): SeatInfo | null {
    if (!this.mySeatId) return null;
    return this.room?.seats.find((s) => s.seatId === this.mySeatId) ?? null;
  }

  /** The EntityId of the hero this client controls, or null before a seat is bound. */
  myHeroEntityId(): string | null {
    return this.mySeatInfo()?.heroEntityId ?? null;
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

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
