import type { CoopPhase, CoopStatusPayload, RoomStatePayload, SeatCombatStatus, SeatId, SeatInfo } from "shared";
import { room } from "../state/room.svelte.js";
import { combat } from "../state/combat.svelte.js";

/**
 * "Who am I in this room" — same read API as the prototype's SeatContext, but a live view over
 * the stores instead of a separately-fed holder. The combat-ui-state accessors and the ported
 * renderer stack read it to answer ownership / whose-phase questions.
 */
export class SeatContext {
  get mySeatId(): SeatId | null {
    return room.state?.yourSeatId ?? null;
  }

  get room(): RoomStatePayload | null {
    return room.state;
  }

  get coop(): CoopStatusPayload | null {
    return combat.coop;
  }

  mySeatInfo(): SeatInfo | null {
    const id = this.mySeatId;
    if (!id) return null;
    return room.state?.seats.find((s) => s.seatId === id) ?? null;
  }

  /** The EntityId of the hero this client controls, or null before a seat is bound. */
  myHeroEntityId(): string | null {
    return this.mySeatInfo()?.heroEntityId ?? null;
  }

  /** My seat's in-combat status, or null when not currently in a co-op combat. */
  mySeat(): SeatCombatStatus | null {
    const id = this.mySeatId;
    if (!id || !combat.coop) return null;
    return combat.coop.seats.find((s) => s.seatId === id) ?? null;
  }

  coopPhase(): CoopPhase | null {
    return combat.coop?.phase ?? null;
  }

  isHost(): boolean {
    return !!this.mySeatId && room.state?.hostSeatId === this.mySeatId;
  }
}

export const seatContext = new SeatContext();
