/** Shared canned data for the menu visual harness + design-attempt variants. No server needed. */
import type { AuthStatePayload, ProfilePayload, RoomStatePayload, SeatInfo, RoomBrowserEntry, SeatId, SeatState } from "shared";

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
    manifestIds: [],
    ...over,
  };
}

export const mockRooms: readonly RoomBrowserEntry[] = [
  { code: "WYVERN", hostDisplayName: "Aldric", openSeats: 1, totalSeats: 2, dimensionId: 1, phase: "lobby" },
  { code: "EMBERS", hostDisplayName: "Mirelle", openSeats: 2, totalSeats: 4, dimensionId: 1, phase: "lobby" },
  { code: "GRROCK", hostDisplayName: "Thorn", openSeats: 3, totalSeats: 4, dimensionId: 2, phase: "lobby" },
];

export function mockProfile(): ProfilePayload {
  return {
    accountId: "mock-account",
    displayName: "Player 1",
    isGuest: true,
    username: null,
    xp: 420, // consistent with the curve: xpToReachLevel(3)=300 ≤ 420 < 600
    level: 3,
    equippedTitleId: null,
    titles: [],
    stats: {
      encountersWon: 12,
      hexesCharted: 34,
      dimensionsDiscovered: 2,
      wipes: 1,
      contractsCompleted: 2,
      dimensionsTraveled: 1,
      designsRecovered: 0,
      firstsRecovered: 0,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export function mockAuth(): AuthStatePayload {
  return {
    accountId: "mock-account",
    isGuest: true,
    username: null,
    authToken: "mock-token",
    profile: mockProfile(),
  };
}

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
    dimensionName: "The Shallows",
    dimensionTier: 0,
    contract: null,
    outcome: null,
    lootPool: [],
    rested: false,
    seats: [
      seatInfo("s0", "human-connected", { isHost: true, displayName: "Player 1", ready: false, presetId: "vanguard" }),
      seatInfo("s1", "human-connected", { displayName: "Brenna", ready: true, presetId: "ranger" }),
      seatInfo("s2", "bot", { displayName: "Bot", ready: true, presetId: "mystic" }),
      seatInfo("s3", "open"),
    ],
  };
}
