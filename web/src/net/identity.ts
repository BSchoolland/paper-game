import type { ClientId, RoomCode, SeatId } from "shared";

// Shared with the prototype client on purpose: same browser, same identity, same account.
const CLIENT_ID_KEY = "coop.clientId";
const LAST_SEAT_KEY = "coop.lastSeat";
const AUTH_TOKEN_KEY = "coop.authToken";

/** Stable per-browser identity; the server's seat reclaim recognises it across reloads. */
export function getClientId(): ClientId {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export interface StoredSeat {
  code: RoomCode;
  seatId: SeatId;
}

/** The room+seat this client last held — drives the "Rejoin your room?" offer after a reload. */
export function getStoredSeat(): StoredSeat | null {
  const raw = localStorage.getItem(LAST_SEAT_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as StoredSeat;
  if (!parsed.code || !parsed.seatId) return null;
  return parsed;
}

export function setStoredSeat(seat: StoredSeat): void {
  localStorage.setItem(LAST_SEAT_KEY, JSON.stringify(seat));
}

export function clearStoredSeat(): void {
  localStorage.removeItem(LAST_SEAT_KEY);
}

/** Account bearer token (365d sliding); restores the account passwordless on `hello`. */
export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
