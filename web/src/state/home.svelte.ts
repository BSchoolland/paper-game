import type { RoomBrowserEntry } from "shared";
import type { FieldError } from "./session.svelte.js";

interface HomeStore {
  /** Null until the first roomList of this visit lands (the pane shows nothing stale). */
  rooms: RoomBrowserEntry[] | null;
  /** Inline on the start plate, under the code cells (ROOM_NOT_FOUND, ROOM_FULL, ALREADY_STARTED). */
  joinError: FieldError | null;
  /** Inline on the start plate, under PLAY (ROOM_CREATE_FAILED). */
  createError: FieldError | null;
}

function initial(): HomeStore {
  return { rooms: null, joinError: null, createError: null };
}

export const home = $state<HomeStore>(initial());

export function resetHome(): void {
  Object.assign(home, initial());
}
