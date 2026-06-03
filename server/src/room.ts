import type { ServerWebSocket } from "bun";
import type {
  SeatId,
  RoomCode,
  SessionToken,
  ClientId,
  CoopPhase,
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
} from "shared";
import { createInventory, getAnimSet } from "shared";
import type { EncounterSession } from "./encounter-session.js";
import type { HeroController } from "../../hero-arena/src/types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../hero-arena/agents/agent-02/sovereign.js";
import { loadItems } from "./db.js";

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
  animSet: AnimSet;
  displayName: string;
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

/** An open overworld movement vote (DESIGN §6 / ruling R15). */
export interface MovementVote {
  readonly proposalId: string;
  readonly proposerSeatId: SeatId;
  readonly target: HexCoord;
  readonly electorate: SeatId[]; // frozen connected-human set at propose time
  ballots: Map<SeatId, "yes" | "no">;
  deadline: number;
  timer: Timer | null;
}

export interface Room {
  readonly code: RoomCode;
  hostSeatId: SeatId | null; // mutable (ruling R14)
  phase: RoomPhase;
  building: boolean; // true across the async encounter build (ruling R7)
  phaseTransitioning: boolean; // player->enemy flip latch (ruling R8)
  generation: number; // bumped on every session teardown/build (ruling R17)
  coopPhase: CoopPhase; // mirrors activeTeam, server-side only
  aiPlayerBusy: boolean; // player-bot burst window (ruling R16)

  dimensionId: number;
  runId: number;
  hexMap: HexMapState; // shared; playerPos === party position
  visitedThisRun: Set<string>;
  pendingHex: HexCoord | null;

  capacity: number; // 2..4, fixed at create
  seats: Seat[]; // length === capacity, index-stable

  session: EncounterSession | null; // null off-combat
  defendRound: DefendRound | null;
  vote: MovementVote | null;

  reapTimer: Timer | null;
  lastActivityMs: number;
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

// --- Default loadout (the starter bag). Single source of truth for the co-op path. ---
export const STARTER_ITEM_IDS = [
  "abilitytest", "short-sword", "bow", "staff", "round-shield",
  "barbed-harpoon", "urchin-flail", "crab-claw-gauntlet",
  "stalactite-spear", "fungal-mace", "geode-knuckles",
  "sandhorn-bow", "raiders-twinblade", "mirage-staff",
];

export function buildDefaultInventory(dimensionId: number): InventoryState {
  const merged = { ...loadItems(0), ...loadItems(1), ...loadItems(2), ...loadItems(3), ...loadItems(dimensionId) };
  const picked: ItemDefinition[] = [];
  for (const id of STARTER_ITEM_IDS) {
    const item = merged[id];
    if (item) picked.push(item);
  }
  return createInventory(picked);
}

/** AI brain for a bot or disconnected seat — fixed `crafty` preset (the v1 difficulty). */
export function sovereignFor(_seat: Seat): HeroController {
  // TODO(Phase 5): derive Sovereign weights from the seat's equipped loadout. Fighter weights
  // are a reasonable default for any kit until then.
  return makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
}

/** Build a room's seats as `open` (lobby) with default loadouts. */
export function createOpenSeats(capacity: number, dimensionId: number): Seat[] {
  const seats: Seat[] = [];
  for (let i = 0; i < capacity; i++) {
    const seatId = seatIdForIndex(i);
    const inventory = buildDefaultInventory(dimensionId);
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
      animSet: getAnimSet(inventory.equipped),
      displayName: `Player ${i + 1}`,
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
  if (room.reapTimer) clearTimeout(room.reapTimer);
  if (room.vote?.timer) clearTimeout(room.vote.timer);
  if (room.defendRound?.timeout) clearTimeout(room.defendRound.timeout);
  for (const seat of room.seats) {
    if (seat.disconnectGraceTimer) clearTimeout(seat.disconnectGraceTimer);
    if (seat.afkTimer) clearTimeout(seat.afkTimer);
  }
}
