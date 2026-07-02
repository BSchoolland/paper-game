import type {
  ChatEntry,
  ContractOffer,
  DimensionOption,
  RoomStatePayload,
  SeatInfo,
  VoteStatePayload,
} from "shared";
import { session } from "./session.svelte.js";

interface RoomStore {
  state: RoomStatePayload | null;
  offers: ContractOffer[];
  options: DimensionOption[];
  chat: ChatEntry[];
  vote: VoteStatePayload | null;
  /** Set by a RATE_LIMITED error while seated; cleared on the next accepted send. */
  chatRateLimited: boolean;
  /**
   * Manifest picks the server pruned out from under us (destination changed to a lower tier).
   * Drives the "returned to your codex" margin note until the player next edits the manifest.
   */
  returnedManifestIds: string[];
}

function initial(): RoomStore {
  return { state: null, offers: [], options: [], chat: [], vote: null, chatRateLimited: false, returnedManifestIds: [] };
}

export const room = $state<RoomStore>(initial());

export function resetRoom(): void {
  Object.assign(room, initial());
}

/** Clear everything room-scoped (leaving / kicked back to home). */
export function clearRoom(): void {
  Object.assign(room, initial());
}

export function mySeat(): SeatInfo | null {
  const s = room.state;
  if (!s || s.yourSeatId === null) return null;
  return s.seats.find((seat) => seat.seatId === s.yourSeatId) ?? null;
}

export function isHost(): boolean {
  const s = room.state;
  return s !== null && s.yourSeatId !== null && s.hostSeatId === s.yourSeatId;
}

export function hostSeat(): SeatInfo | null {
  const s = room.state;
  if (!s || s.hostSeatId === null) return null;
  return s.seats.find((seat) => seat.seatId === s.hostSeatId) ?? null;
}

/** Stable ink color index for a seat (s0..s3 -> 0..3), used by chat and the party rail. */
export function seatInkIndex(seatId: string): number {
  return Number(seatId.slice(1));
}

/** True while we are seated but the transport is down — the slim reconnect banner. */
export function reconnectingSeated(): boolean {
  return room.state !== null && session.status === "reconnecting";
}
