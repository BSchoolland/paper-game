/** Shared canned data for the menu visual harness + design-attempt variants. No server needed. */
import type { RoomStatePayload, SeatInfo, RoomBrowserEntry, SeatId, SeatState } from "shared";

export type MenuScreen = "home" | "home-rooms" | "lobby" | "gameover";

export function seatInfo(id: SeatId, state: SeatState, over: Partial<SeatInfo> = {}): SeatInfo {
  return {
    seatId: id,
    state,
    isHost: false,
    displayName: "Player",
    heroEntityId: null,
    ready: false,
    presetId: null,
    accountId: null,
    level: null,
    equippedTitleId: null,
    ...over,
  };
}

export const mockRooms: readonly RoomBrowserEntry[] = [
  { code: "WYVERN", hostDisplayName: "Aldric", openSeats: 1, totalSeats: 2, dimensionId: 1, phase: "lobby" },
  { code: "EMBERS", hostDisplayName: "Mirelle", openSeats: 2, totalSeats: 4, dimensionId: 1, phase: "lobby" },
  { code: "GRROCK", hostDisplayName: "Thorn", openSeats: 3, totalSeats: 4, dimensionId: 2, phase: "lobby" },
];

export function lobbyRoom(): RoomStatePayload {
  return {
    protocolVersion: 1,
    code: "2GQB8T",
    phase: "lobby",
    hostSeatId: "s0",
    capacity: 4,
    yourSeatId: "s0",
    runId: 1,
    dimensionId: 1,
    seats: [
      seatInfo("s0", "human-connected", { isHost: true, displayName: "Player 1", ready: false, presetId: "vanguard" }),
      seatInfo("s1", "human-connected", { displayName: "Brenna", ready: true, presetId: "ranger" }),
      seatInfo("s2", "bot", { displayName: "Bot", ready: true, presetId: "mystic" }),
      seatInfo("s3", "open"),
    ],
  };
}
