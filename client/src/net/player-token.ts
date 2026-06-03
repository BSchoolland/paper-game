import type { ClientId, RoomCode, SeatId } from "shared";

const CLIENT_ID_KEY = "coop.clientId";
const LAST_SEAT_KEY = "coop.lastSeat";

/**
 * A stable per-browser identity. Minted once and persisted so a reconnect (and the
 * server's seat reclaim) recognises this client across reloads.
 */
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

/** The room+seat this client last held, used to offer an explicit force-reclaim after a reload. */
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
