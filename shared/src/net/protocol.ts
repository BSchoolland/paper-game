/**
 * Canonical multiplayer co-op wire protocol — the single source of truth shared by
 * client and server (DESIGN.md §3, ruling R4). Nothing else defines message shapes.
 *
 * Transport is WebSocket/JSON. Every message is a discriminated union member keyed on `type`.
 * Seat/ready/phase/vote/defend orchestration is server-authoritative and travels in these
 * room-scoped messages — it is NEVER embedded in the serialized `GameState` (ruling R1).
 */
import type { EntityId, Vec2, AimDirection, AttackAbility, PlayerAction, GameEvent } from "../core/types.js";
import type { SerializedGameState } from "../core/serialization.js";
import type { InventoryState, AttachmentData } from "../core/inventory.js";
import type { HexCoord, HexMapState } from "../map/hex-map.js";

export const PROTOCOL_VERSION = 3;

// --- Identity / seats ---
export type SeatId = "s0" | "s1" | "s2" | "s3"; // "s{index}", index-stable for the room's life
export type RoomCode = string; // 6 chars from A-Z2-9 (no I/O/0/1), ruling R20
export type SessionToken = string; // server-minted secret bound to a clientId+seat (ruling R5)
export type ClientId = string; // client-persisted UUID (localStorage)
export type AccountId = string; // accounts.id UUID; orthogonal to the HMAC seat token (never conflate)

export type CoopPhase = "player" | "enemy";
export type RoomPhase = "lobby" | "overworld" | "combat" | "gameover";
export type SeatState = "open" | "human-connected" | "human-disconnected" | "bot";

export type RoomCapacity = 2 | 3 | 4;

// --- DTOs ---
export interface LoadoutSummary {
  readonly equippedIds: readonly string[];
}

export interface SeatInfo {
  readonly seatId: SeatId;
  readonly state: SeatState;
  readonly isHost: boolean;
  readonly displayName: string;
  readonly heroEntityId: EntityId | null;
  /** Lobby: ready-to-start. Combat: this seat has passed the player phase. */
  readonly ready: boolean;
  readonly loadoutSummary?: LoadoutSummary;
  /** Lobby: the starter preset this seat last chose (drives the picker highlight); null if unknown. */
  readonly presetId?: string | null;
  /** All three null for open/bot seats; built from the in-memory seat cache, never a DB read. */
  readonly accountId: AccountId | null;
  readonly level: number | null;
  readonly equippedTitleId: string | null;
}

export interface RoomStatePayload {
  readonly protocolVersion: number;
  readonly code: RoomCode;
  readonly phase: RoomPhase;
  readonly hostSeatId: SeatId | null;
  readonly capacity: number;
  readonly seats: readonly SeatInfo[];
  readonly yourSeatId: SeatId | null;
  readonly runId: number;
  readonly dimensionId: number;
}

export interface SeatCombatStatus {
  readonly seatId: SeatId;
  readonly heroEntityId: EntityId;
  readonly controller: "human" | "ai";
  readonly connected: boolean;
  readonly ready: boolean;
  readonly exhausted: boolean;
  readonly displayName: string;
}

export interface PendingDefendInfo {
  readonly promptId: string;
  readonly seatId: SeatId;
  readonly targetEntityId: EntityId;
  readonly answered: boolean;
}

/** In-combat per-seat status. Sent on every transition. NOT part of GameState (ruling R1). */
export interface CoopStatusPayload {
  readonly phase: CoopPhase;
  readonly seats: readonly SeatCombatStatus[];
  readonly pendingDefends: readonly PendingDefendInfo[];
  /** True while combat is frozen because no human is connected (the bot cascade is suppressed). */
  readonly paused?: boolean;
}

/**
 * A single joinable room as seen from the HOME room browser. Deliberately a strict subset of
 * RoomStatePayload — no runId, seat identities, clientIds, tokens, or loadouts ever reach an
 * unseated socket.
 */
export interface RoomBrowserEntry {
  readonly code: RoomCode;
  readonly hostDisplayName: string;
  readonly openSeats: number;
  readonly totalSeats: number;
  readonly dimensionId: number;
  readonly phase: RoomPhase;
}

// --- Accounts / social DTOs (docs/meta-loop/01-accounts.md §3.1) ---

export interface AccountStatsPayload {
  readonly encountersWon: number;
  readonly hexesCharted: number;
  readonly dimensionsDiscovered: number;
  readonly wipes: number;
}

export interface ProfilePayload {
  readonly accountId: AccountId;
  readonly displayName: string;
  readonly isGuest: boolean;
  readonly username: string | null; // public handle; email NEVER leaves the server
  readonly xp: number;
  readonly level: number; // levelForXp(xp), server-derived
  readonly equippedTitleId: string | null; // client resolves names via shared TITLES
  readonly titles: readonly string[]; // owned title ids
  readonly stats: AccountStatsPayload;
  readonly createdAt: string; // ISO
}

export interface AuthStatePayload {
  readonly accountId: AccountId;
  readonly isGuest: boolean;
  readonly username: string | null;
  readonly authToken: string; // bearer; client persists (localStorage "coop.authToken")
  readonly profile: ProfilePayload;
  /** Set iff a presented hello authToken failed — client opens the auth modal in login mode. */
  readonly authRejected?: "expired" | "invalid";
}

export interface FriendEntry {
  readonly accountId: AccountId;
  readonly displayName: string;
  readonly level: number;
  readonly equippedTitleId: string | null;
  readonly online: boolean;
  readonly roomCode: RoomCode | null; // set iff friend is in a joinable lobby-phase room
}

export interface FriendRequestEntry {
  readonly accountId: AccountId;
  readonly displayName: string;
  readonly level: number;
  readonly sentAt: string;
}

export interface FriendsListPayload {
  readonly friends: readonly FriendEntry[];
  readonly incoming: readonly FriendRequestEntry[];
  readonly outgoing: readonly FriendRequestEntry[];
}

export interface ChatEntry {
  readonly seatId: SeatId;
  readonly displayName: string;
  readonly text: string;
  readonly t: number; // server Date.now() at accept
}

export type VoteChoice = "yes" | "no";

export interface VoteStatePayload {
  readonly proposalId: string;
  readonly proposerSeatId: SeatId;
  readonly target: HexCoord;
  /** Cast human ballots only. */
  readonly votes: Partial<Record<SeatId, VoteChoice>>;
  /** Frozen connected-human seat set at propose time; resolution math is over this (ruling R15). */
  readonly electorate: readonly SeatId[];
  readonly deadlineMs: number;
}

export type ErrorCode =
  | "PROTOCOL_MISMATCH"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ALREADY_STARTED"
  | "NOT_HOST"
  | "NOT_YOUR_SEAT"
  | "SEAT_IN_USE"
  | "BAD_PHASE"
  | "INVALID_MOVE"
  | "NO_OPEN_PROPOSAL"
  | "ROOM_CREATE_FAILED"
  | "MALFORMED"
  | "USERNAME_TAKEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_INPUT"
  | "NOT_A_GUEST"
  | "CLAIM_REQUIRED"
  | "NO_SUCH_USER"
  | "AUTH_IN_ROOM"
  | "RATE_LIMITED";

/**
 * The only gameplay action a client may submit over the wire. `endTurn` is reserved for the
 * server/AI as the internal phase-flip primitive (ruling R3); clients send `pass`/`unpass`.
 */
export type WireAction = Exclude<PlayerAction, { type: "endTurn" }>;

// --- Client -> Server ---
export type ClientMessage =
  | { type: "hello"; protocolVersion: number; clientId: ClientId; authToken?: string }
  | { type: "createRoom"; capacity: RoomCapacity; dimensionId?: number }
  | { type: "joinRoom"; code: RoomCode }
  | { type: "reclaimSeat"; code: RoomCode; seatId: SeatId; force?: boolean }
  | { type: "listRooms" }
  | { type: "quickMatch"; dimensionId?: number }
  | { type: "leaveRoom" }
  | { type: "playAgain" }
  | { type: "choosePreset"; presetId: string }
  | { type: "setReady"; ready: boolean }
  | { type: "startGame" }
  | { type: "proposeMove"; target: HexCoord }
  | { type: "castVote"; proposalId: string; vote: VoteChoice }
  | { type: "action"; seatId: SeatId; action: WireAction }
  | { type: "pass" }
  | { type: "unpass" }
  | { type: "defendResult"; seatId: SeatId; promptId: string; power: number }
  | { type: "equip"; bagIndex: number }
  | { type: "unequip"; equippedIndex: number }
  | { type: "updateAttachment"; itemId: string; attachment: AttachmentData }
  | { type: "reset" }
  | { type: "debugWin" }
  | { type: "debugLose" }
  // Connection-scoped account/social messages (no seat required):
  | { type: "claimAccount"; username: string; password: string; email?: string }
  | { type: "register"; username: string; password: string; email?: string }
  | { type: "login"; username: string; password: string }
  | { type: "logout" }
  | { type: "getProfile"; accountId?: AccountId } // omitted = own
  | { type: "setDisplayName"; name: string }
  | { type: "equipTitle"; titleId: string | null }
  | { type: "getFriends" }
  | { type: "friendRequest"; username: string }
  | { type: "friendAccept"; accountId: AccountId }
  | { type: "friendDecline"; accountId: AccountId } // decline incoming OR cancel own outgoing
  | { type: "friendRemove"; accountId: AccountId }
  // Seat-scoped:
  | { type: "friendInvite"; accountId: AccountId } // invite friend to my room
  | { type: "chatSend"; text: string };

export type ClientMessageType = ClientMessage["type"];

// --- Server -> Client ---
export type ServerMessage =
  | {
      type: "welcome";
      protocolVersion: number;
      sessionToken: SessionToken;
      auth: AuthStatePayload;
      reconnected?: { code: RoomCode; seatId: SeatId };
    }
  | { type: "protocolMismatch"; serverVersion: number; clientVersion: number }
  | { type: "displaced" }
  | { type: "leftRoom" }
  | { type: "roomList"; rooms: readonly RoomBrowserEntry[] }
  | { type: "roomState"; room: RoomStatePayload }
  | { type: "hexMapState"; hexMap: HexMapState }
  | { type: "hexDiscovered"; coord: HexCoord }
  | { type: "voteState"; vote: VoteStatePayload | null }
  | { type: "moveResolved"; proposalId: string; accepted: boolean; target: HexCoord }
  | { type: "combatStart"; encounterHex: HexCoord }
  | { type: "state"; state: SerializedGameState; events: readonly GameEvent[] }
  | { type: "coopStatus"; coop: CoopStatusPayload }
  | {
      type: "defendPrompt";
      promptId: string;
      seatId: SeatId;
      targetEntityId: EntityId;
      attackerId: EntityId;
      attackerPosition: Vec2;
      aimDirection: AimDirection;
      ability: AttackAbility;
    }
  | { type: "actionRejected"; seatId: SeatId }
  | { type: "combatEnd"; won: boolean }
  | { type: "gameOver"; outcome: "victory" | "defeat" }
  | { type: "inventory"; inventory: InventoryState }
  | { type: "authState"; auth: AuthStatePayload } // pushed after post-connect auth mutations only
  | { type: "profile"; profile: ProfilePayload } // getProfile response + own-profile pushes
  | { type: "friendsList"; friends: FriendsListPayload } // full snapshot: response + push on mutation/presence
  | { type: "roomInvite"; from: { accountId: AccountId; displayName: string }; code: RoomCode; dimensionId: number }
  | { type: "chat"; entry: ChatEntry }
  | { type: "chatHistory"; entries: readonly ChatEntry[] } // replayed in sendSeatSnapshots
  /** PRIVATE per-seat sends — never broadcast; one player's XP totals never leak to the room. */
  | { type: "xpAward"; amount: number; xp: number; level: number; leveledUp: boolean }
  | { type: "titlesEarned"; titleIds: readonly string[] }
  | { type: "error"; code: ErrorCode; message: string; recoverable: boolean };

export type ServerMessageType = ServerMessage["type"];

/** Transport envelope for every server -> client message. ServerMessage shapes stay unchanged. */
export interface ServerEnvelope {
  readonly seq: number;
  /** Per-process/server monotonic emit ordinal, not wall-clock time. */
  readonly t: number;
  readonly msg: ServerMessage;
}

export interface EventSummary {
  readonly kind: GameEvent["type"];
  readonly actor?: EntityId;
  readonly target?: EntityId;
  readonly amount?: number;
}

export interface WireLogRecord {
  readonly dir: "send" | "recv";
  readonly seq: number;
  readonly t: number;
  readonly room?: RoomCode;
  readonly runId?: number;
  readonly seatId?: SeatId;
  readonly type: ServerMessageType;
  readonly actionCount?: number;
  readonly events?: readonly EventSummary[];
  readonly combatPhase?: string;
  readonly queueDepth?: number;
  readonly note?: string;
}

export function summarizeEvent(ev: GameEvent): EventSummary {
  switch (ev.type) {
    case "attack": {
      const firstHit = ev.hits[0];
      return {
        kind: ev.type,
        actor: ev.attackerId,
        target: firstHit?.targetId,
        amount: firstHit?.damage,
      };
    }
    case "move":
    case "barrier":
    case "knockback":
    case "pull":
    case "statusApplied":
    case "collision":
    case "zoneTick":
      return {
        kind: ev.type,
        actor: ev.entityId,
        amount: ev.type === "collision" ? ev.damage : ev.type === "zoneTick" ? ev.magnitude : undefined,
      };
    case "spawn":
      return { kind: ev.type, actor: ev.entityId };
    case "endTurn":
    case "turnStart":
      return { kind: ev.type };
    case "zoneCreated":
      return { kind: ev.type };
    case "zoneExpired":
      return { kind: ev.type };
  }
}
