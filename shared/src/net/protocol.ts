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
import type { ItemDefinition } from "../core/items.js";
import type { HexCoord, HexMapState, HexIconType } from "../map/hex-map.js";
import type { ContractState, ContractOffer, ContractType } from "../overworld/contracts.js";
import type { ArchetypeId } from "../encounter/archetypes.js";

export const PROTOCOL_VERSION = 7;

/** Durable run outcome — the value set of runs.outcome (db.ts re-imports this). */
export type RunOutcome = "victory" | "defeat" | "retreat" | "abandoned";

export type VoteKind = "move" | "retreat" | "travel" | "loot";

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
  /** Codex designs this seat will materialize at start (lobby transparency). [] when none/bot/open. */
  readonly manifestIds: readonly string[];
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
  readonly dimensionName: string;
  /** NULL only for dev-override runs in unplaced dimensions (04-portals flag #10); feature 3
   *  reads the lobby value as the run's starting tier. */
  readonly dimensionTier: number | null;
  /** The run's contract; null only for legacy pre-v7 runs and not-yet-assigned lobbies. */
  readonly contract: ContractState | null;
  /** Set iff phase === "gameover" — drives the outcome-variant end screen on reconnect too. */
  readonly outcome: RunOutcome | null;
  /** Unclaimed party drops, oldest first (03-loot-codex flag #13). Always [] outside a started run. */
  readonly lootPool: readonly LootPoolEntry[];
  /** True while the party carries an unconsumed rest (reconnect-safe truth; flag #2/#8). */
  readonly rested: boolean;
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

// --- Portals / tiered multiverse DTOs (docs/meta-loop/04-portals.md §2.1) ---

/** A community-attuned gateway destination (dimension_gateways row + destination meta). */
export interface GatewayInfo {
  readonly toDimensionId: number;
  readonly toName: string;
  readonly toTier: number;
}

/** One run-start option in the lobby picker (union of tier-0 + party-charted, server-built). */
export interface DimensionOption {
  readonly id: number;
  readonly name: string;
  readonly tier: number;
}

// --- Loot & codex DTOs (docs/meta-loop/03-loot-codex.md §3.1) ---

/**
 * One drop in the shared party pool. Full ItemDefinition (the `inventory` message precedent)
 * so the client renders name/sprite/rarity with zero lookups.
 */
export interface LootPoolEntry {
  readonly lootId: number; // run_loot.id — the claim handle
  readonly item: ItemDefinition;
  readonly sourceIcon: HexIconType | null; // richness provenance for the tooltip
}

/** One banked design, with provenance resolved server-side (dimension + discoverer names). */
export interface CodexEntryPayload {
  readonly item: ItemDefinition;
  readonly dimensionId: number; // the design's native dimension
  readonly dimensionName: string;
  readonly tier: number;
  readonly acquiredAt: string; // ISO — when THIS account banked it
  readonly first: {
    readonly accountId: AccountId;
    readonly displayName: string;
    readonly at: string; // ISO
    readonly mine: boolean; // discoverer === the requesting account
  };
}

// --- Accounts / social DTOs (docs/meta-loop/01-accounts.md §3.1) ---

export interface AccountStatsPayload {
  readonly encountersWon: number;
  readonly hexesCharted: number;
  readonly dimensionsDiscovered: number;
  readonly wipes: number;
  readonly contractsCompleted: number;
  readonly dimensionsTraveled: number;
  readonly designsRecovered: number;
  readonly firstsRecovered: number;
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
  readonly kind: VoteKind;
  /** For kind "loot" the proposer IS the claimant. */
  readonly proposerSeatId: SeatId;
  /** Was required; null for retreat, travel, and loot votes. */
  readonly target: HexCoord | null;
  /** Travel destination; null unless kind === "travel" — drives the VotePanel destination line. */
  readonly travel: GatewayInfo | null;
  /** Claimed drop; null unless kind === "loot" — drives the VotePanel claim line. */
  readonly loot: LootPoolEntry | null;
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
  | "GATEWAY_UNATTUNED"
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
  // Host-gated, lobby-only: pick the run's contract from the offer board.
  | { type: "chooseContract"; contractType: ContractType }
  // Host-gated, lobby-only: re-point the expedition's start dimension (from dimensionOptions).
  | { type: "chooseDimension"; dimensionId: number }
  // Seat-scoped, overworld-only, party standing on a gateway hex: open a retreat vote.
  | { type: "proposeRetreat" }
  // Seat-scoped, overworld-only, party on a cleared gateway hex: open a travel-deeper vote.
  | { type: "proposeTravel" }
  // Seat-scoped, overworld-only: propose claiming a pool item for YOUR seat (opens a loot vote).
  | { type: "claimLoot"; lootId: number }
  // Seat-scoped, lobby-only: set this seat's manifest picks (full replacement, may be []).
  | { type: "chooseManifest"; itemIds: readonly string[] }
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
  // Connection-scoped (no seat required): fetch your codex for the shelf / manifest picker.
  | { type: "getCodex" }
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
  | { type: "hexMapState"; hexMap: HexMapState; gateways: Record<string, GatewayInfo> }
  // Broadcast on a gateway attunement ATTEMPT (first-clear or travel-retry): gateway = the fixed
  // destination, or null when the pool was empty (04-portals flag #4 — server already logged).
  | { type: "gatewayUpdate"; hex: HexCoord; gateway: GatewayInfo | null }
  | { type: "hexDiscovered"; coord: HexCoord }
  | { type: "voteState"; vote: VoteStatePayload | null }
  | { type: "moveResolved"; proposalId: string; accepted: boolean; target: HexCoord }
  | { type: "combatStart"; encounterHex: HexCoord; archetype: ArchetypeId }
  | { type: "restUpdate"; rested: boolean }
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
  | { type: "gameOver"; outcome: "victory" | "defeat" | "retreat" }
  | { type: "inventory"; inventory: InventoryState }
  | { type: "authState"; auth: AuthStatePayload } // pushed after post-connect auth mutations only
  | { type: "profile"; profile: ProfilePayload } // getProfile response + own-profile pushes
  | { type: "friendsList"; friends: FriendsListPayload } // full snapshot: response + push on mutation/presence
  | { type: "roomInvite"; from: { accountId: AccountId; displayName: string }; code: RoomCode; dimensionId: number }
  | { type: "chat"; entry: ChatEntry }
  | { type: "chatHistory"; entries: readonly ChatEntry[] } // replayed in sendSeatSnapshots
  // Lobby offer board: sent to each seat landing in a lobby-phase room; re-sent only when the
  // lobby's dimension changes (04-portals chooseDimension) — offers are static per dimension map.
  | { type: "contractOffers"; offers: readonly ContractOffer[] }
  // Lobby run-start picker: union of tier-0 + party-charted dims. Sent on lobby land AND
  // re-broadcast to the whole lobby whenever the seated-account union changes (join/leave).
  | { type: "dimensionOptions"; options: readonly DimensionOption[] }
  /** PRIVATE per-seat sends — never broadcast; one player's XP totals never leak to the room. */
  // Provisional accrual push: `pending` is this seat's running per-run pending total (no level yet).
  | { type: "xpAward"; amount: number; pending: number }
  // Run-end settlement push: what banked, with the new profile totals.
  | {
      type: "xpBanked";
      pending: number;
      multiplier: number;
      banked: number;
      xp: number;
      level: number;
      leveledUp: boolean;
    }
  | { type: "titlesEarned"; titleIds: readonly string[] }
  // Broadcast at drop time — toast/celebration only; pool truth rides roomState (flag #13).
  | { type: "lootFound"; drops: readonly LootPoolEntry[] }
  // getCodex response (PRIVATE): the requesting account's full codex, acquired_at DESC.
  | { type: "codex"; entries: readonly CodexEntryPayload[] }
  // Run-end settlement push (PRIVATE per-seat, next to xpBanked): what JUST entered your codex.
  // entries = newly-banked only (dedup applied); firstItemIds ⊆ entries' ids = designs whose
  // global first-recovery credit went to YOU; skippedUntiered surfaces flag #5's loud skip.
  | { type: "codexBanked"; entries: readonly CodexEntryPayload[]; firstItemIds: readonly string[]; skippedUntiered: number }
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
