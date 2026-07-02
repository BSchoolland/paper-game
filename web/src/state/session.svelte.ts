import type { AuthStatePayload, ErrorCode, ProfilePayload, RoomCode, SeatId } from "shared";
import type { SocketStatus } from "../net/socket.js";

/** Why the app is at a permanent full stop (a Connect face that never auto-recovers). */
export type Halted =
  | { kind: "update"; serverVersion: number; clientVersion: number }
  | { kind: "displaced" };

export interface FieldError {
  code: ErrorCode;
  message: string;
}

interface SessionState {
  status: SocketStatus;
  /** True once the first `welcome` landed — before that the connect face covers boot. */
  welcomed: boolean;
  halted: Halted | null;
  auth: AuthStatePayload | null;
  /**
   * The seat-resume probe: "pending" while a boot-time `reclaimSeat` is in flight (its
   * ROOM_NOT_FOUND/NOT_YOUR_SEAT outcomes are consumed silently — a stale seat just lands home).
   * "offered" = the seat is live on another device; the REJOIN face is up.
   */
  reclaim: { code: RoomCode; seatId: SeatId; phase: "pending" | "offered" } | null;
  /** Inline error for the account dialog (USERNAME_TAKEN, INVALID_CREDENTIALS, …). */
  authError: FieldError | null;
  /** Set when the hello authToken was rejected — the account dialog opens in login mode. */
  authRejected: "expired" | "invalid" | null;
  /** This seat's provisional per-run XP total (private xpAward pushes; banks at run end). */
  xpPending: number;
}

function initial(): SessionState {
  return {
    status: "connecting",
    welcomed: false,
    halted: null,
    auth: null,
    reclaim: null,
    authError: null,
    authRejected: null,
    xpPending: 0,
  };
}

export const session = $state<SessionState>(initial());

export function resetSession(): void {
  Object.assign(session, initial());
}

export function profile(): ProfilePayload | null {
  return session.auth?.profile ?? null;
}

export function isGuest(): boolean {
  return session.auth?.isGuest ?? true;
}
