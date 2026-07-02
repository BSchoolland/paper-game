import type { ServerWebSocket } from "bun";
import type {
  SeatId,
  RoomCode,
  SessionToken,
  ClientId,
  RoomPhase,
  SeatState,
  EntityId,
  HexCoord,
  HexMapState,
  AnimSet,
  InventoryState,
  ItemDefinition,
  AttackAbility,
  AimDirection,
  Vec2,
  ChatEntry,
  ContractState,
  RunOutcome,
  GatewayInfo,
  LootPoolEntry,
} from "shared";
import { BAG_SIZE, getAnimSet, getPreset, DEFAULT_PRESET_ID } from "shared";
import type { CombatRuntime } from "./combat-runtime.js";
import type { EncounterSession } from "./encounter-session.js";
import type { HeroController } from "../../hero-arena/src/types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../hero-arena/agents/agent-02/sovereign.js";
import { getItemById, loadCodexEntry } from "./db.js";

type Timer = ReturnType<typeof setTimeout>;

/**
 * Server-side co-op room model (DESIGN.md §2). A Room owns ONE game: its seats, the shared run,
 * and (in combat) the EncounterSession. All seat/ready/phase/vote/defend orchestration lives here
 * and travels in room-scoped protocol messages — never inside the pure GameState (ruling R1).
 *
 * Phase 3 establishes the types + builders; the phase / vote / defend MACHINES land in Phase 5,
 * and the WS routing that drives them in Phase 6. Nothing here is wired into index.ts yet.
 */

/** Slimmed per-connection data (DESIGN §2.3). Identity is set in the `hello` handler — never from
 *  query params (ruling R22). */
export interface SocketData {
  clientId: ClientId;
  sessionToken: SessionToken;
  roomCode: RoomCode | null;
  seatId: SeatId | null;
  seq: number;
  /** Resolved account for this connection (set in hello, swapped by login/logout). */
  accountId: string | null;
  /** Raw account bearer token, memory-only, so later welcomes can embed auth. Never persisted. */
  authToken: string | null;
}

export interface Seat {
  readonly seatId: SeatId; // === the hero's controllerId
  readonly seatIndex: number; // 0..capacity-1; seatId === `s${seatIndex}`
  readonly heroEntityId: EntityId; // stable `${seatId}-hero` for the room's life
  state: SeatState;
  socket: ServerWebSocket<SocketData> | null;
  clientId: ClientId | null;
  tokenSalt: string | null; // per-seat HMAC salt for the session token
  brain: HeroController | null; // present iff AI-driven (bot or disconnected)
  inventory: InventoryState; // per-seat bag
  presetId: string | null; // the starter preset last chosen in the lobby (null once hand-edited/unknown)
  /** Codex designs this seat will materialize at start (lobby picks, validated); [] until chosen. */
  manifestIds: string[];
  animSet: AnimSet;
  displayName: string;
  /** Attribution: the account this seat's outcomes credit (never overwritten once set, §4.6). */
  accountId: string | null;
  /** Cached roster card data — broadcastRoomState fires constantly and must not hit the DB. */
  cardProfile: { level: number; equippedTitleId: string | null } | null;
  /** Accepted chat timestamps for the per-seat rate limit (5 msgs / 10s). */
  chatTimestamps: number[];
  // --- combat orchestration (player phase); driven by the Phase 5 machine ---
  ready: boolean; // passed this player phase
  exhausted: boolean; // dead or no affordable action (recomputed)
  actedThisPhase: boolean; // any action resolved for this hero this phase
  disconnectGraceTimer: Timer | null; // 3s hold before human->bot flip (R28)
  afkTimer: Timer | null; // idle-human auto-pass (R28)
}

/** One target row of an in-flight defend round (DESIGN §5 / ruling R11). */
export interface DefendTarget {
  readonly promptId: string;
  readonly entityId: EntityId;
  readonly seatId: SeatId;
  status: "pending" | "answered";
  power: number;
}

export interface DefendRound {
  readonly generation: number;
  readonly attackerId: EntityId;
  readonly attackerPosition: Vec2;
  readonly aimDirection: AimDirection;
  readonly ability: AttackAbility;
  targets: DefendTarget[];
  resolved: boolean;
  timeout: Timer | null;
}

/** An open overworld vote (DESIGN §6 / ruling R15; retreat: docs/meta-loop/02-contracts.md §4.4). */
interface RoomVoteBase {
  readonly proposalId: string;
  readonly proposerSeatId: SeatId;
  readonly electorate: SeatId[]; // frozen connected-human set at propose time
  ballots: Map<SeatId, "yes" | "no">;
  deadline: number;
  timer: Timer | null;
}

export type RoomVote =
  | (RoomVoteBase & { readonly kind: "move"; readonly target: HexCoord })
  | (RoomVoteBase & { readonly kind: "retreat" })
  | (RoomVoteBase & { readonly kind: "travel"; readonly gateway: GatewayInfo })
  | (RoomVoteBase & { readonly kind: "loot"; readonly entry: LootPoolEntry });

export interface Room {
  readonly code: RoomCode;
  hostSeatId: SeatId | null; // mutable (ruling R14)
  phase: RoomPhase;
  building: boolean; // true across the async encounter build (ruling R7)
  generation: number; // bumped on every session teardown/build (ruling R17)
  /** The single in-combat state value (player/enemy sub-phase, busy/transition, suspend) — null
   *  off-combat. Replaces the old coopPhase/phaseTransitioning/aiPlayerBusy/paused flag scatter. */
  combat: CombatRuntime | null;

  dimensionId: number;                   // the CURRENT dimension (mutated by travel)
  startDimensionId: number;              // the lobby-picked start (resetToOrigin/rematch target)
  dimensionName: string;                 // cached meta (roomStatePayload fires constantly)
  dimensionTier: number | null;          // NULL only for dev-override runs in unplaced dims (flag #10)
  gateways: Record<string, GatewayInfo>; // community gateway map for the CURRENT dimension, by hexKey
  runId: number;
  hexMap: HexMapState; // shared; playerPos === party position
  visitedThisRun: Set<string>;
  runClearedCount: number; // combat-cleared this run, origins excluded, cumulative across travel (flag #8)
  pendingHex: HexCoord | null;
  /** Unconsumed rest buff: heroes enter the next combat with REST_BARRIER_HP barrier. Ephemeral —
   *  lost on crash/reap by design (05-difficulty flag #3); one walk-back to a rest node re-arms. */
  rested: boolean;

  capacity: number; // 2..4, fixed at create
  seats: Seat[]; // length === capacity, index-stable

  /** Listed in the public room browser + eligible for quickMatch. Private rematch rooms set false. */
  listed: boolean;
  /** Set on a finished room when its first Play-Again click spawns the shared rematch lobby; later
   *  clickers from the same room funnel into this code. Null until then. */
  rematchCode: RoomCode | null;

  session: EncounterSession | null; // null off-combat
  defendRound: DefendRound | null;
  vote: RoomVote | null;

  /** Unclaimed party drops this run (mirrors run_loot WHERE assigned_seat_index IS NULL). */
  lootPool: LootPoolEntry[];

  /** The run's contract; null only for legacy pre-v7 runs and not-yet-assigned lobbies. */
  contract: ContractState | null;
  /** The settled run outcome; set at settleRun, null while the run is live. */
  outcome: RunOutcome | null;

  /** In-memory room chat (lobby + overworld), cap 100 — lost on crash/reap by design (flag #8). */
  chatLog: ChatEntry[];

  reapTimer: Timer | null;
  lastActivityMs: number;
  /** Set once the room is reaped/disposed so an in-flight async encounter build discards itself
   *  instead of assigning a session to a zombie room no longer in the registry (ruling R7/R19). */
  disposed?: boolean;
}

/** Immutable snapshot of a seat's loadout, taken synchronously before the async encounter build
 *  so an equip arriving during the build can't mutate it (ruling R7). */
export interface SeatBuildSpec {
  readonly seatId: SeatId;
  readonly heroEntityId: EntityId;
  readonly controllerId: SeatId;
  readonly animSet: AnimSet;
  readonly equipped: readonly ItemDefinition[];
  readonly attachments: InventoryState["attachments"];
}

export function seatBuildSpec(seat: Seat): SeatBuildSpec {
  return {
    seatId: seat.seatId,
    heroEntityId: seat.heroEntityId,
    controllerId: seat.seatId,
    animSet: seat.animSet,
    equipped: seat.inventory.equipped,
    attachments: seat.inventory.attachments,
  };
}

export function seatIdForIndex(i: number): SeatId {
  return `s${i}` as SeatId;
}

export function heroEntityIdFor(seatId: SeatId): EntityId {
  return `${seatId}-hero`;
}

// --- Room codes (ruling R20): 6 chars from an unambiguous alphabet (no I/O/0/1). ---
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function freshRoomCode(taken: (code: RoomCode) => boolean, maxTries = 50): RoomCode | null {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!taken(code)) return code;
  }
  return null; // exhausted -> ROOM_CREATE_FAILED
}

/** Build a seat's inventory from a starter preset: bag + auto-equipped kit + baked attachments. The
 *  single source of truth for a fresh seat's loadout (co-op path). Item ids resolve globally (flag #9:
 *  ids are unique across dimensions). An unknown preset id falls back to the default so a seat is
 *  never left unarmed. */
export function buildPresetInventory(presetId: string): InventoryState {
  const preset = getPreset(presetId) ?? getPreset(DEFAULT_PRESET_ID)!;

  const bag: (ItemDefinition | null)[] = new Array(BAG_SIZE).fill(null);
  preset.bagIds.forEach((id, i) => {
    const item = getItemById(id);
    if (item && i < BAG_SIZE) bag[i] = item;
  });

  const equipped: ItemDefinition[] = [];
  for (const id of preset.equippedIds) {
    const item = getItemById(id);
    if (item) equipped.push(item);
  }

  // Keep only attachments for items the seat actually owns (mirrors loadSeatInventory's guard).
  const attachments: InventoryState["attachments"] = {};
  for (const [itemId, att] of Object.entries(preset.attachments)) {
    if (equipped.some((e) => e.id === itemId)) attachments[itemId] = att;
  }

  return { bag, equipped, attachments };
}

export function buildDefaultInventory(): InventoryState {
  return buildPresetInventory(DEFAULT_PRESET_ID);
}

/** Re-parse a seat's manifest picks into ItemDefinitions from the account's codex snapshots. Ids were
 *  validated at choose time, so a missing row here is an invariant break (throw, not a silent skip). */
export function manifestItemsFor(seat: Seat): ItemDefinition[] {
  if (seat.manifestIds.length === 0) return [];
  if (!seat.accountId) throw new Error(`manifestItemsFor: seat ${seat.seatId} has manifests but no account`);
  return seat.manifestIds.map((id) => {
    const entry = loadCodexEntry(seat.accountId!, id);
    if (!entry) throw new Error(`manifestItemsFor: design "${id}" missing from codex for ${seat.accountId}`);
    return JSON.parse(entry.item_json) as ItemDefinition;
  });
}

/** Starter preset + materialized codex designs into the first free bag slots (flag #11). Capacity is
 *  safe by construction (preset bag ≤ 2 + K ≤ 10 < BAG_SIZE); the throw is an invariant, not a check. */
export function buildSeatLoadout(presetId: string, manifest: readonly ItemDefinition[]): InventoryState {
  const inv = buildPresetInventory(presetId);
  const bag = [...inv.bag];
  for (const item of manifest) {
    const free = bag.indexOf(null);
    if (free === -1) throw new Error("buildSeatLoadout: bag overflow");
    bag[free] = item;
  }
  return { ...inv, bag };
}

/** AI brain for a bot or disconnected seat — fixed `crafty` preset (the v1 difficulty). */
export function sovereignFor(_seat: Seat): HeroController {
  // TODO(Phase 5): derive Sovereign weights from the seat's equipped loadout. Fighter weights
  // are a reasonable default for any kit until then.
  return makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
}

/** Build a room's seats as `open` (lobby) with default loadouts. */
export function createOpenSeats(capacity: number): Seat[] {
  const seats: Seat[] = [];
  for (let i = 0; i < capacity; i++) {
    const seatId = seatIdForIndex(i);
    const inventory = buildPresetInventory(DEFAULT_PRESET_ID);
    seats.push({
      seatId,
      seatIndex: i,
      heroEntityId: heroEntityIdFor(seatId),
      state: "open",
      socket: null,
      clientId: null,
      tokenSalt: null,
      brain: null,
      inventory,
      presetId: DEFAULT_PRESET_ID,
      manifestIds: [],
      animSet: getAnimSet(inventory.equipped),
      displayName: `Player ${i + 1}`,
      accountId: null,
      cardProfile: null,
      chatTimestamps: [],
      ready: false,
      exhausted: false,
      actedThisPhase: false,
      disconnectGraceTimer: null,
      afkTimer: null,
    });
  }
  return seats;
}

/** Tear down all in-memory timers for a room (ruling R19). Durable rows are NOT deleted (R13.1). */
export function disposeRoom(room: Room): void {
  room.disposed = true;
  if (room.reapTimer) clearTimeout(room.reapTimer);
  if (room.vote?.timer) clearTimeout(room.vote.timer);
  if (room.defendRound?.timeout) clearTimeout(room.defendRound.timeout);
  for (const seat of room.seats) {
    if (seat.disconnectGraceTimer) clearTimeout(seat.disconnectGraceTimer);
    if (seat.afkTimer) clearTimeout(seat.afkTimer);
  }
}
