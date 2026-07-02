import type { ServerWebSocket } from "bun";
import type {
  ClientMessage,
  ServerMessage,
  ClientId,
  SessionToken,
  RoomCode,
  SeatId,
  RoomCapacity,
  RoomBrowserEntry,
  HexIconType,
} from "shared";
import { PROTOCOL_VERSION, getAnimSet, hexKey, getHexIcon, isDecorationHex, buildContractOffers, DEFAULT_CONTRACT_TYPE } from "shared";
import { DEFAULT_PRESET_ID, expeditionSlots, isManifestable, effectiveStartingTier } from "shared";
import type { ContractType, ItemDefinition } from "shared";
import { loadDimension, loadEnemyTemplateRegistry, loadItems, loadCodexEntry } from "./db.js";
import { ASSETS_DIR, SERVER_SPRITES_DIR, WEB_DIST_DIR } from "../../shared/src/paths.js";
import {
  startNewRun,
  seedDiscovery,
  discoverHex,
  saveDiscoveredHexIcon,
  loadDiscoveredHexes,
  loadDiscoveredHexIcons,
  markRunCleared,
  saveSeatInventory,
  upsertRunSeat,
  loadRunSeats,
  findActiveSeatForClient,
  abandonPriorSeatForClient,
  leaveRunSeat,
  finalizeRun,
  deactivateStaleRuns,
  setRunPhase,
  setRunStartDimension,
  clearRunContract,
  getDimensionMeta,
  applyCanonicalDimensionTiers,
  newTokenSalt,
  mintSessionToken,
  verifySessionToken,
} from "./db.js";
import { startableDimensions, isStartableDimension, loadGatewaysForDimension } from "./gateways.js";
import { rooms } from "./room-registry.js";
import {
  createOpenSeats,
  buildPresetInventory,
  buildSeatLoadout,
  manifestItemsFor,
  freshRoomCode,
  seatIdForIndex,
} from "./room.js";
import type { Room, Seat, SocketData } from "./room.js";
import {
  disposeRoom,
  broadcastRoomState,
  broadcastCoopStatus,
  broadcastHexMapState,
  hexMapStatePayload,
  broadcastState,
  roomStatePayload,
  coopStatusPayload,
  sendInventory,
  startPlayerPhase,
  applyHumanAction,
  setReady,
  submitDefend,
  proposeMove,
  proposeRetreat,
  proposeLootClaim,
  voteStatePayload,
  castVote,
  beginCombatEntry,
  endCombat,
  resetToOrigin,
  recoverActiveRuns,
  connectSeat,
  onSeatDisconnected,
  leaveSeatPermanently,
  proposeTravel,
  abortDefendRound,
  resendPendingDefendPrompts,
  armReap,
  clearReap,
  DISCOVERY_RADIUS,
  ORIGIN,
} from "./room-machine.js";
import { seedDimension0 } from "./seed.js";
import { seedDimension1 } from "./seed-dimension-1.js";
import { seedDimension2 } from "./seed-dimension-2.js";
import { seedDimension3 } from "./seed-dimension-3.js";
import { seedDimension501 } from "./seed-dimension-501.js";
import { equipFromBag, unequipItem, getPreset } from "shared";
import { join } from "path";
import { existsSync } from "fs";
import { eventLog } from "./event-log.js";
import { io, sendTo } from "./wire-transport.js";
import { AccountError, seedTitles, purgeExpiredSessions, loadCardProfile } from "./accounts.js";
import * as presence from "./presence.js";
import {
  resolveConnectionAccount,
  buildAuthState,
  handleClaimAccount,
  handleRegister,
  handleLogin,
  handleLogout,
  type AccountResolution,
} from "./auth-handlers.js";
import {
  handleGetProfile,
  handleSetDisplayName,
  handleEquipTitle,
  handleGetFriends,
  handleFriendRequest,
  handleFriendAccept,
  handleFriendDecline,
  handleFriendRemove,
  handleFriendInvite,
  handleChatSend,
  pushFriendsListTo,
  pushPresenceDelta,
  pushRoomPresenceDelta,
} from "./social-handlers.js";
import { emitRunEvent } from "./run-events.js";
import { assignContract } from "./contract-engine.js";
import { handleGetCodex } from "./codex.js";

export function initSeeds(): void {
  seedDimension0();
  seedDimension1();
  seedDimension2();
  seedDimension3();
  seedDimension501();
  // On a fresh DB the v8 tier backfill ran against an empty table — stamp the canonical dims'
  // fixed tiers (04-portals §0.2) after the seeds land. Idempotent on existing DBs.
  applyCanonicalDimensionTiers();
  seedTitles();
}

// Auto-seed on normal boot. Tests/harnesses set GAME_SKIP_SEED=1 (with an in-memory
// GAME_DB_PATH) to import the server without touching disk seeds. There is no global game
// session anymore (ruling R27): rooms — and their runs — are created on demand via createRoom.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // R33: deactivate runs idle longer than 7 days.
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000; // hourly sweep.
if (process.env.GAME_SKIP_SEED !== "1") {
  if (process.env.GAME_ALLOW_UNCHARTED_DIMENSIONS === "1") {
    // 04-portals flag #5: an explicit dev knob, surfaced loudly at boot — never a silent bypass.
    console.warn(
      "[dimensions] GAME_ALLOW_UNCHARTED_DIMENSIONS=1 — run-start eligibility (charted/tier gate) is DISABLED; any player can start runs in untiered/in-review dimensions",
    );
  }
  initSeeds();
  recoverActiveRuns(reapEmptyRoom);
  // R33 retention housekeeping: periodically inactivate runs untouched past the retention window,
  // catching abandoned lobby/overworld runs that no run-end event ever closed. Gated off under
  // GAME_SKIP_SEED (tests) so the in-memory test DB isn't churned by a timer.
  const sweep = setInterval(() => {
    try {
      const n = deactivateStaleRuns(RETENTION_MS, (runId) => rooms.getByRun(runId) !== null);
      if (n > 0) console.log(`[housekeeping] deactivated ${n} stale run(s)`);
      const purged = purgeExpiredSessions();
      if (purged > 0) console.log(`[housekeeping] purged ${purged} expired account session(s)`);
    } catch (e) {
      console.error("[housekeeping] sweep failed:", e);
    }
  }, HOUSEKEEPING_INTERVAL_MS);
  sweep.unref?.(); // don't keep the process alive solely for the sweep.
}

const ORIGIN_KEY = hexKey(ORIGIN);
const DEFAULT_DIMENSION = 1;
const QUICKMATCH_CAPACITY: RoomCapacity = 4; // quick-match creates a 4-seat room when none are open

/** Reap callback: tear down a room's timers + registry entry (R19/R31). Durable rows untouched.
 *  Used for prior-seat / zombie / race-loser disposal where the run must STAY active. */
function reapRoom(room: Room): void {
  disposeRoom(room);
  rooms.remove(room);
}

/**
 * Graceful empty-reap callback (5-min no-humans / abandon): finalize the run as abandoned BEFORE
 * disposing the in-memory room, so a later hello finds no active seat and lands the client on HOME
 * instead of resurrecting the room. Only a true process crash leaves a run active=1 — recovered at
 * boot by the crash-recovery pass. This is the mortal-game spine (graceful => inactive, crash => active).
 */
function reapEmptyRoom(room: Room): void {
  finalizeRun(room.runId, "abandoned");
  reapRoom(room);
}

// =====================================================================================
// Helpers: seat / room lookup from a bound socket
// =====================================================================================

function roomFor(ws: ServerWebSocket<SocketData>): Room | null {
  return ws.data.roomCode ? rooms.get(ws.data.roomCode) : null;
}

function seatFor(ws: ServerWebSocket<SocketData>): { room: Room; seat: Seat } | null {
  const room = roomFor(ws);
  if (!room || !ws.data.seatId) return null;
  const seat = room.seats.find((s) => s.seatId === ws.data.seatId) ?? null;
  if (!seat) return null;
  return { room, seat };
}

function sendError(
  ws: ServerWebSocket<SocketData>,
  code: import("shared").ErrorCode,
  message: string,
  recoverable = true,
): void {
  sendTo(ws, { type: "error", code, message, recoverable });
}

// =====================================================================================
// Connection-scoped handlers (hello / createRoom / joinRoom / reclaimSeat)
// =====================================================================================

/** Mint + bind a fresh session token for a seat (HMAC over clientId+salt, R29). */
function mintTokenFor(clientId: ClientId, salt: string): SessionToken {
  return mintSessionToken(clientId, salt);
}

/**
 * R32 prior-run cleanup. Before a client takes a NEW seat (createRoom/joinRoom), durably left_at-
 * stamp any prior live human seat it holds (and inactivate the prior run if it is thereby empty of
 * humans), then tear down any in-memory Room for that prior run (cross-Room identity teardown) so
 * the DB abandonment and the in-memory state stay consistent. Without this, the second upsertRunSeat
 * for the same clientId hits the UNIQUE-live index and crashes the handler ("abandon/win then play
 * again"). `keepRoom` lets a reclaim of the SAME room skip tearing down its own room.
 */
function cleanupPriorSeat(
  ws: ServerWebSocket<SocketData>,
  clientId: ClientId,
  keepRoom: Room | null = null,
): void {
  const prior = abandonPriorSeatForClient(clientId);
  if (!prior) return;
  const priorRoom = rooms.getByRun(prior.runId);
  if (!priorRoom || priorRoom === keepRoom) return;

  const priorSeat = priorRoom.seats.find((s) => s.seatIndex === prior.seatIndex);
  if (priorSeat?.socket) {
    const old = priorSeat.socket;
    priorSeat.socket = null;
    if (old === ws) {
      // The client is switching rooms on the SAME socket (still bound to the prior room): unbind it
      // in-memory but do NOT close it — closing would kill the very request building the new room.
      old.data.roomCode = null;
      old.data.seatId = null;
    } else {
      // A DIFFERENT stale live socket: displace it so R6's single-live-socket invariant holds.
      old.data.roomCode = null;
      old.data.seatId = null;
      sendTo(old, { type: "displaced" });
      old.close();
    }
  }
  if (prior.runInactivated) {
    // The prior run is now inactive: dispose its in-memory Room so it can't be resumed/reaped.
    reapRoom(priorRoom);
  }
}

/** The seated-account union for a room (eligibleSeats filter: attributed + still a human's seat). */
function seatedAccountIds(room: Room): string[] {
  return room.seats
    .filter((s) => s.accountId !== null && (s.state === "human-connected" || s.state === "human-disconnected"))
    .map((s) => s.accountId!);
}

/** Run-start options for a room's current seated party (tier-0 + party-charted). */
function startableForRoom(room: Room): import("shared").DimensionOption[] {
  return startableDimensions(seatedAccountIds(room));
}

/** Re-broadcast the run-start picker to every connected seat (the seated-account union changed). */
function broadcastDimensionOptions(room: Room): void {
  const options = startableForRoom(room);
  for (const s of room.seats) if (s.socket) io.send(s, { type: "dimensionOptions", options });
}

/** Push the post-bind snapshots to a (re)connecting seat (resume step 8 / hello-reclaim). */
function sendSeatSnapshots(room: Room, seat: Seat): void {
  io.send(seat, { type: "roomState", room: roomStatePayload(room, seat) });
  if (room.phase === "lobby") {
    io.send(seat, { type: "contractOffers", offers: buildContractOffers(room.hexMap.icons) });
    io.send(seat, { type: "dimensionOptions", options: startableForRoom(room) });
  }
  io.send(seat, { type: "chatHistory", entries: room.chatLog });
  if (room.phase === "overworld") {
    // Send the visibility-expanded map (same payload as the broadcast), NOT raw room.hexMap, so the
    // resuming player gets the clickable frontier the server's proposeMove check expects (no desync).
    io.send(seat, { type: "hexMapState", hexMap: hexMapStatePayload(room), gateways: room.gateways });
    // An open vote (move/retreat/travel/loot) must survive a reconnect (03-loot-codex §4.7): without
    // this the returning player sees no ballot and the LootPanel wrongly re-enables its Claim buttons.
    if (room.vote) io.send(seat, { type: "voteState", vote: voteStatePayload(room.vote) });
  }
  sendInventory(room, io, seat);
  if (room.phase === "combat" && room.session) {
    io.send(seat, { type: "state", state: room.session.serialize() as import("shared").SerializedGameState, events: [] }, "snapshot");
    io.send(seat, { type: "coopStatus", coop: coopStatusPayload(room) });
    // After the state + coopStatus are in flight, re-send any defend prompt this seat still owes so
    // a human who reconnected mid-round can answer it (R11 / DESIGN §5), not just see it pending.
    resendPendingDefendPrompts(room, io, seat);
  }
}

function handleHello(ws: ServerWebSocket<SocketData>, msg: Extract<ClientMessage, { type: "hello" }>): void {
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    sendTo(ws, { type: "protocolMismatch", serverVersion: PROTOCOL_VERSION, clientVersion: msg.protocolVersion });
    ws.close();
    return;
  }

  // AUTH_IN_ROOM (design flag #5): a seated socket's account is frozen for the life of the seat.
  // A repeated hello would re-run account resolution and could swap ws.data.accountId (e.g. with a
  // stolen/other token) while the seat stays attributed to the old account — reject it outright.
  // Legit clients only ever hello once per connection, before taking a seat.
  if (ws.data.roomCode !== null) {
    return sendError(ws, "AUTH_IN_ROOM", "Already seated; account identity is fixed while in a room");
  }

  const clientId = msg.clientId;
  ws.data.clientId = clientId;

  // Account resolution (docs/meta-loop/01-accounts.md §4.2): restore from authToken or reuse/mint
  // the device's guest. Orthogonal to the HMAC seat token below (§4.5) — never conflate.
  let resolution: AccountResolution;
  try {
    resolution = resolveConnectionAccount(ws, msg);
  } catch (e) {
    if (e instanceof AccountError) {
      // Guest-mint budget exhausted for this address: no account can be resolved, so no welcome.
      sendError(ws, e.code, e.message, false);
      ws.close();
      return;
    }
    throw e;
  }
  const afterWelcome = () => {
    // A claimed account's friends panel is primed right after the welcome (guests have none).
    if (!resolution.isGuest) pushFriendsListTo(ws.data.accountId!);
  };

  // Resume into a STILL-LIVE in-memory room only (a recent drop, or a crash-recovered run rebuilt at
  // boot). We do NOT lazily reconstruct on hello: a gracefully-reaped run is marked inactive, so
  // findActiveSeatForClient returns nothing and the client lands on HOME below — that is the mortal-
  // game behavior (no "first person back rebuilds the abandoned room and becomes host").
  const durable = findActiveSeatForClient(clientId);
  if (durable) {
    const room = rooms.getByRun(durable.runId);

    if (room) {
      const seat = room.seats.find((s) => s.seatIndex === durable.seatIndex);
      if (seat) {
        // Re-derive THIS seat's token from its durable salt and converge the socket onto it
        // (PERSISTENCE resume step 4: "always return the re-derived token"). This holds whether
        // the seat's current socket is live or dead, so a later reclaim/force verifies (R29).
        const salt = seat.tokenSalt ?? newTokenSalt();
        seat.tokenSalt = salt;
        const token = mintTokenFor(clientId, salt);
        ws.data.sessionToken = token;

        // Auto-reclaim only if the seat's socket is dead (R5/R6); else welcome room-less and the
        // client must explicitly reclaimSeat{force:true} (R6 single-owner).
        if (seat.socket === null) {
          ws.data.roomCode = room.code;
          ws.data.seatId = seat.seatId;
          connectSeat(room, io, seat, ws, clientId);
          sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, auth: buildAuthState(ws, resolution.authRejected), reconnected: { code: room.code, seatId: seat.seatId } });
          afterWelcome();
          sendSeatSnapshots(room, seat);
          broadcastRoomState(room, io);
          if (room.phase === "combat") broadcastCoopStatus(room, io);
        } else {
          // Seat is live elsewhere: welcome room-less but with the valid token (force-reclaim path).
          sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, auth: buildAuthState(ws, resolution.authRejected) });
          afterWelcome();
        }
        return;
      }
    }
  }

  // No resumable seat (or the seat is still live): welcome to lobby. Token is minted fresh and
  // re-derived/replaced when the client takes a seat (createRoom / joinRoom).
  const token = mintTokenFor(clientId, newTokenSalt());
  ws.data.sessionToken = token;
  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, auth: buildAuthState(ws, resolution.authRejected) });
  afterWelcome();
}

/**
 * Existence + startability check for a caller-chosen start dimension (flag #5), against the CALLER's
 * account (resolved at hello). DEFAULT_DIMENSION (tier 0) and the client's ?dim=0 pass by
 * construction. GAME_ALLOW_UNCHARTED_DIMENSIONS=1 skips the eligibility (NOT the existence) check.
 * Returns true if allowed; sends INVALID_INPUT and returns false otherwise.
 */
function validateStartDimension(ws: ServerWebSocket<SocketData>, dimensionId: number): boolean {
  if (!getDimensionMeta(dimensionId)) {
    sendError(ws, "INVALID_INPUT", "Unknown dimension");
    return false;
  }
  if (process.env.GAME_ALLOW_UNCHARTED_DIMENSIONS !== "1") {
    const accountId = ws.data.accountId;
    if (!isStartableDimension(dimensionId, accountId ? [accountId] : [])) {
      sendError(ws, "INVALID_INPUT", "You haven't charted that dimension");
      return false;
    }
  }
  return true;
}

/** Build a brand-new room + durable run for the host (write point 1, R13.1). */
function handleCreateRoom(ws: ServerWebSocket<SocketData>, msg: Extract<ClientMessage, { type: "createRoom" }>): void {
  if (!ws.data.clientId) return sendError(ws, "BAD_PHASE", "Say hello first");
  // Wire JSON is cast to ClientMessage, so RoomCapacity is only a compile-time promise. A capacity
  // outside 2..4 has no partySizeBudgetMult (difficulty.ts throws), soft-locking every fight the
  // room could ever build — reject it at this trust boundary.
  const capacity = msg.capacity as number;
  if (capacity !== 2 && capacity !== 3 && capacity !== 4)
    return sendError(ws, "INVALID_INPUT", "Room capacity must be 2, 3, or 4");
  if (msg.dimensionId !== undefined && !validateStartDimension(ws, msg.dimensionId)) return;
  createRoomFor(ws, msg.capacity, msg.dimensionId ?? DEFAULT_DIMENSION, true);
}

/** Allocate a room + run, seat this socket as host, send welcome/roomState. `listed` controls whether
 *  the room shows in the public browser / quickMatch (false for private rematch rooms). Returns the
 *  created Room, or null if allocation failed (an error was already sent). */
function createRoomFor(
  ws: ServerWebSocket<SocketData>,
  capacity: RoomCapacity,
  dimensionId: number,
  listed: boolean,
): Room | null {
  const clientId = ws.data.clientId!;

  // R32: abandon any prior live seat this client holds BEFORE binding the new one, so the UNIQUE-
  // live index never sees two live rows for this clientId (the "play again" crash class).
  cleanupPriorSeat(ws, clientId);

  const code = freshRoomCode((c) => rooms.isTaken(c));
  if (!code) { sendError(ws, "ROOM_CREATE_FAILED", "Could not allocate a room code", true); return null; }

  // Durable run-create: run row + GLOBAL community discovery (radius disc + origin, per dimension) +
  // origin icon; this run starts cleared only at the origin. seedDiscovery/discoverHex are idempotent
  // so a returning dimension keeps every previously-discovered hex.
  const runId = startNewRun(dimensionId, clientId, capacity);
  seedDiscovery(dimensionId, DISCOVERY_RADIUS);
  discoverHex(dimensionId, ORIGIN);
  saveDiscoveredHexIcon(dimensionId, ORIGIN, "town");
  markRunCleared(runId, dimensionId, ORIGIN);

  const seats = createOpenSeats(capacity);

  const meta = getDimensionMeta(dimensionId);
  if (!meta) throw new Error(`createRoomFor: dimension ${dimensionId} does not exist`); // fail loud

  const hexes = loadDiscoveredHexes(dimensionId);
  hexes[ORIGIN_KEY] = "explored";
  const icons: Record<string, HexIconType> = { [ORIGIN_KEY]: "town" };
  for (const [key, icon] of Object.entries(loadDiscoveredHexIcons(dimensionId))) icons[key] = icon as HexIconType;

  const room: Room = {
    code,
    hostSeatId: null,
    phase: "lobby",
    building: false,
    generation: 0,
    combat: null,
    dimensionId,
    startDimensionId: dimensionId,
    dimensionName: meta.name,
    dimensionTier: meta.tier,
    gateways: loadGatewaysForDimension(dimensionId),
    runId,
    hexMap: { playerPos: ORIGIN, hexes, icons },
    visitedThisRun: new Set([ORIGIN_KEY]),
    runClearedCount: 0,
    pendingHex: null,
    rested: false,
    capacity,
    seats,
    listed,
    rematchCode: null,
    session: null,
    defendRound: null,
    vote: null,
    lootPool: [],
    contract: null,
    outcome: null,
    chatLog: [],
    reapTimer: null,
    lastActivityMs: Date.now(),
  };
  rooms.add(room);

  // Claim seat 0 as the host (human-connected) and bind the socket.
  const host = seats[0]!;
  const salt = newTokenSalt();
  host.tokenSalt = salt;
  host.clientId = clientId;
  host.state = "human-connected";
  host.socket = ws;
  room.hostSeatId = host.seatId;
  bindSeatAccount(host, ws);

  const token = mintTokenFor(clientId, salt);
  ws.data.sessionToken = token;
  ws.data.roomCode = code;
  ws.data.seatId = host.seatId;

  // Durable: host seat row + starter inventory (write point 2).
  upsertRunSeat(runId, host.seatIndex, {
    clientId,
    displayName: host.displayName,
    controllerKind: "human",
    tokenSalt: salt,
    accountId: host.accountId,
  });
  saveSeatInventory(runId, host.seatIndex, host.inventory);

  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, auth: buildAuthState(ws), reconnected: { code, seatId: host.seatId } });
  broadcastRoomState(room, io);
  // The host lands in the lobby without passing through sendSeatSnapshots — send the offer board
  // and the run-start dimension picker.
  io.send(host, { type: "contractOffers", offers: buildContractOffers(room.hexMap.icons) });
  io.send(host, { type: "dimensionOptions", options: startableForRoom(room) });
  sendInventory(room, io, host);
  pushRoomPresenceDelta(room); // the host's friends gain a Join affordance (§7.4)
  return room;
}

/** Fresh-bind attribution (§4.6): seat identity comes from the connection's resolved account —
 *  the profile is the single name source. Throws if hello never resolved an account (cannot
 *  happen behind the "Say hello first" guards). */
function bindSeatAccount(seat: Seat, ws: ServerWebSocket<SocketData>): void {
  const accountId = ws.data.accountId;
  if (!accountId) throw new Error("seat bind without a resolved account (hello must run first)");
  const card = loadCardProfile(accountId);
  seat.accountId = accountId;
  seat.displayName = card.displayName;
  seat.cardProfile = { level: card.level, equippedTitleId: card.equippedTitleId };
}

function handleJoinRoom(ws: ServerWebSocket<SocketData>, msg: Extract<ClientMessage, { type: "joinRoom" }>): void {
  if (!ws.data.clientId) return sendError(ws, "BAD_PHASE", "Say hello first");
  const clientId = ws.data.clientId;

  const room = rooms.get(msg.code);
  if (!room) return sendError(ws, "ROOM_NOT_FOUND", "No room with that code");
  if (room.phase !== "lobby") return sendError(ws, "ALREADY_STARTED", "That game has already started");

  // First open seat -> human-connected (synchronous check-then-flip, R21).
  const seat = room.seats.find((s) => s.state === "open");
  if (!seat) return sendError(ws, "ROOM_FULL", "That room is full");

  // R32: abandon any prior live seat this client holds before binding this one (avoid the UNIQUE-
  // live crash). Keep this room in case the client is somehow already seated here.
  cleanupPriorSeat(ws, clientId, room);

  const salt = newTokenSalt();
  seat.tokenSalt = salt;
  seat.clientId = clientId;
  seat.state = "human-connected";
  seat.socket = ws;
  bindSeatAccount(seat, ws);

  const token = mintTokenFor(clientId, salt);
  ws.data.sessionToken = token;
  ws.data.roomCode = room.code;
  ws.data.seatId = seat.seatId;

  clearReap(room);
  if (room.hostSeatId === null) room.hostSeatId = seat.seatId;

  // Durable: seat row + starter inventory (write point 2).
  upsertRunSeat(room.runId, seat.seatIndex, {
    clientId,
    displayName: seat.displayName,
    controllerKind: "human",
    tokenSalt: salt,
    accountId: seat.accountId,
  });
  saveSeatInventory(room.runId, seat.seatIndex, seat.inventory);

  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, auth: buildAuthState(ws), reconnected: { code: room.code, seatId: seat.seatId } });
  broadcastRoomState(room, io);
  // A joiner lands in the lobby without passing through sendSeatSnapshots — send the offer board.
  io.send(seat, { type: "contractOffers", offers: buildContractOffers(room.hexMap.icons) });
  // The seated-account union grew: re-broadcast the run-start picker to the whole lobby (incl. the joiner).
  broadcastDimensionOptions(room);
  sendInventory(room, io, seat);
  // Friends-panel joinability changed for EVERY seated account: the joiner gained a room, and if
  // this join took the last open seat the others' rooms stopped being joinable (§7.4).
  pushRoomPresenceDelta(room);
}

function handleReclaimSeat(ws: ServerWebSocket<SocketData>, msg: Extract<ClientMessage, { type: "reclaimSeat" }>): void {
  if (!ws.data.clientId) return sendError(ws, "BAD_PHASE", "Say hello first");
  const clientId = ws.data.clientId;

  const room = rooms.get(msg.code);
  if (!room) return sendError(ws, "ROOM_NOT_FOUND", "No room with that code");
  const seat = room.seats.find((s) => s.seatId === msg.seatId);
  if (!seat) return sendError(ws, "NOT_YOUR_SEAT", "No such seat");

  // R5/R29: a human seat is token-gated. Verify the presented identity against the durable salt,
  // AND assert the seat's bound clientId matches this socket's clientId — defense-in-depth so the
  // reclaim never rests on token secrecy alone (the token HMAC already binds clientId, but a stale
  // seat whose clientId was reassigned must not be reclaimable by the old identity).
  if (
    !seat.tokenSalt ||
    !verifySessionToken(ws.data.sessionToken, clientId, seat.tokenSalt) ||
    (seat.clientId !== null && seat.clientId !== clientId)
  ) {
    return sendError(ws, "NOT_YOUR_SEAT", "Not your seat", false);
  }

  // R6: a live socket is only displaced on an explicit force.
  if (seat.socket !== null) {
    if (!msg.force) return sendError(ws, "SEAT_IN_USE", "Seat is currently in use");
    const old = seat.socket;
    // Clear the displaced socket's seat binding BEFORE notifying it (R29) so it can no longer
    // issue seat-scoped writes, then close it.
    old.data.roomCode = null;
    old.data.seatId = null;
    sendTo(old, { type: "displaced" });
    old.close();
    seat.socket = null;
  }

  ws.data.roomCode = room.code;
  ws.data.seatId = seat.seatId;
  connectSeat(room, io, seat, ws, clientId);

  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: ws.data.sessionToken, auth: buildAuthState(ws), reconnected: { code: room.code, seatId: seat.seatId } });
  sendSeatSnapshots(room, seat);
  broadcastRoomState(room, io);
  if (room.phase === "combat") broadcastCoopStatus(room, io);
}

// =====================================================================================
// Matchmaking (connection-scoped: issued from a room-less HOME socket)
// =====================================================================================

/** A minimal browser row (no runId / seat identities / tokens reach an unseated socket). */
function toBrowserEntry(room: Room): RoomBrowserEntry {
  const hostSeat = room.hostSeatId ? room.seats.find((s) => s.seatId === room.hostSeatId) : undefined;
  const hostName =
    hostSeat?.displayName ??
    room.seats.find((s) => s.state === "human-connected")?.displayName ??
    "";
  return {
    code: room.code,
    hostDisplayName: hostName,
    openSeats: room.seats.filter((s) => s.state === "open").length,
    totalSeats: room.capacity,
    dimensionId: room.dimensionId,
    phase: room.phase,
  };
}

function handleListRooms(ws: ServerWebSocket<SocketData>): void {
  if (!ws.data.clientId) return sendError(ws, "BAD_PHASE", "Say hello first");
  sendTo(ws, { type: "roomList", rooms: rooms.joinableRooms().map(toBrowserEntry) });
}

/** Join the first open lobby room, else create a fresh one. Delegates to the existing handlers so the
 *  resulting welcome + roomState (seat binding, token, cleanup) is identical to a manual join/create. */
function handleQuickMatch(ws: ServerWebSocket<SocketData>, msg: Extract<ClientMessage, { type: "quickMatch" }>): void {
  if (!ws.data.clientId) return sendError(ws, "BAD_PHASE", "Say hello first");
  const target = rooms.firstJoinable();
  if (target) {
    handleJoinRoom(ws, { type: "joinRoom", code: target.code });
  } else {
    handleCreateRoom(ws, { type: "createRoom", capacity: QUICKMATCH_CAPACITY, dimensionId: msg.dimensionId });
  }
}

// =====================================================================================
// Host-gated (room-scoped) handlers (startGame / reset / debugWin)
// =====================================================================================

function isHost(room: Room, seat: Seat): boolean {
  return room.hostSeatId === seat.seatId;
}

/** Start the game (R27): bot-fill empty seats, persist them, go to overworld. */
function handleStartGame(room: Room, seat: Seat): void {
  if (!isHost(room, seat)) {
    io.send(seat, { type: "error", code: "NOT_HOST", message: "Only the host can start", recoverable: true });
    return;
  }
  if (room.phase !== "lobby") {
    io.send(seat, { type: "error", code: "BAD_PHASE", message: "Already started", recoverable: true });
    return;
  }

  // Bot-fill every still-open seat (durable controller_kind='bot', write point 2). A bot seat must
  // carry no account identity in memory either — a stale accountId here would crash the next
  // persistSeat (bot + accountId throws) and leak the prior occupant onto the roster.
  for (const s of room.seats) {
    if (s.state === "open") {
      s.state = "bot";
      s.clientId = null;
      s.tokenSalt = null;
      s.accountId = null;
      s.cardProfile = null;
      upsertRunSeat(room.runId, s.seatIndex, {
        clientId: null,
        displayName: s.displayName,
        controllerKind: "bot",
        tokenSalt: null,
        accountId: null,
      });
      saveSeatInventory(room.runId, s.seatIndex, s.inventory);
    }
  }

  // Expedition start recorder: chart this dimension for every attributed human seat.
  emitRunEvent(room, io, { type: "run-started", runId: room.runId, dimensionId: room.dimensionId });

  // Exactly-one-contract invariant (locked #3 / flag #2): no host pick -> the default contract.
  if (!room.contract) assignContract(room, DEFAULT_CONTRACT_TYPE);

  room.phase = "overworld";
  setRunPhase(room.runId, "overworld"); // persist the lifecycle SSOT (crash recovery resumes overworld runs)
  broadcastRoomState(room, io);
  broadcastHexMapState(room, io);
  pushRoomPresenceDelta(room); // the lobby is gone — friends' Join affordances drop (§7.4)
}

function handleReset(room: Room, seat: Seat): void {
  if (!isHost(room, seat)) {
    io.send(seat, { type: "error", code: "NOT_HOST", message: "Only the host can reset", recoverable: true });
    return;
  }
  if (room.phase === "combat") {
    // Abort the encounter and return to overworld of the SAME run (no run swap, R17/R13.5).
    abortDefendRound(room);
    room.generation++;
    room.session = null;
    // Clear building too: if a beginCombatEntry await is in flight, the generation bump already
    // makes its post-await re-validation discard the build, but it returns BEFORE clearing building
    // — so reset must clear the flag itself or it leaks stuck-true (otherwise self-heals next build).
    room.building = false;
    room.combat = null;
    room.pendingHex = null;
    room.phase = "overworld";
    setRunPhase(room.runId, "overworld"); // back to overworld of the SAME run (durable SSOT)
    broadcastRoomState(room, io);
    broadcastHexMapState(room, io);
  } else if (room.phase === "overworld" || room.phase === "gameover") {
    // Explicit host reset in overworld -> fresh run, recorded as 'abandoned' (R13.5; defeat is the
    // party-wipe path in endCombat).
    resetToOrigin(room, io, "abandoned");
  }
}

/**
 * "Play again" from the Game Over end state. Each player who clicks is funneled into ONE shared, fresh
 * PRIVATE lobby (the rematch room) — no run state carries over. The finished room records that lobby's
 * code in `rematchCode`: the first clicker creates it (becomes host); later clickers join the same code.
 * The finished room itself is left in `gameover` and reaps once its last human departs (R32 stamps each
 * leaver; the run only finalizes when no live human remains), so concurrent clicks from other seats
 * still resolve. Non-clickers Return-to-Home as before.
 */
function handlePlayAgain(room: Room, seat: Seat): void {
  if (room.phase !== "gameover") return; // not in the end state
  const ws = seat.socket;
  if (!ws) return;

  const existing = room.rematchCode ? rooms.get(room.rematchCode) : null;
  const joinable = existing && existing.phase === "lobby" && existing.seats.some((s) => s.state === "open");
  if (joinable) {
    handleJoinRoom(ws, { type: "joinRoom", code: existing!.code });
    return;
  }
  // No live rematch room yet (or it filled / already started) — spin up a fresh private one at the
  // run's START dimension (flag #6: a wipe forfeited earned depth). This clicker hosts it; subsequent
  // clickers from this finished room follow into the same code.
  const rematch = createRoomFor(ws, room.capacity as RoomCapacity, room.startDimensionId, false);
  if (rematch) room.rematchCode = rematch.code;
}

/** Host-gated, lobby-only: pick the run's contract from the offer board (02-contracts §4.5). */
function handleChooseContract(
  room: Room,
  seat: Seat,
  ws: ServerWebSocket<SocketData>,
  contractType: ContractType,
): void {
  if (!isHost(room, seat)) return sendError(ws, "NOT_HOST", "Only the host can choose the contract");
  if (room.phase !== "lobby") return sendError(ws, "BAD_PHASE", "Contracts are chosen in the lobby");
  try {
    assignContract(room, contractType); // INVALID_INPUT on unknown/unavailable type
  } catch (e) {
    if (e instanceof AccountError) return sendError(ws, e.code, e.message);
    throw e;
  }
  broadcastRoomState(room, io); // the selection rides roomState.contract
}

/**
 * Host-gated, lobby-only: re-point the expedition's start dimension (04-portals §4.5). Validates
 * existence + startability (env-overridable), then durably re-points the run's current+start
 * dimension, rebuilds the community hexMap/gateway state, re-derives the contract (offers are
 * per-dimension-map, flag #12), and re-sends offers to every seat.
 */
function handleChooseDimension(
  room: Room,
  seat: Seat,
  ws: ServerWebSocket<SocketData>,
  dimensionId: number,
): void {
  if (!isHost(room, seat)) return sendError(ws, "NOT_HOST", "Only the host can choose the destination");
  if (room.phase !== "lobby") return sendError(ws, "BAD_PHASE", "The destination is chosen in the lobby");
  const meta = getDimensionMeta(dimensionId);
  if (!meta) return sendError(ws, "INVALID_INPUT", "Unknown dimension");
  if (
    process.env.GAME_ALLOW_UNCHARTED_DIMENSIONS !== "1" &&
    !isStartableDimension(dimensionId, seatedAccountIds(room))
  ) {
    return sendError(ws, "INVALID_INPUT", "No one in the party has charted that dimension");
  }
  if (dimensionId === room.dimensionId) return; // already there — nothing to do

  setRunStartDimension(room.runId, dimensionId); // durable: dimension_id + start_dimension_id
  seedDiscovery(dimensionId, DISCOVERY_RADIUS); // idempotent community seed
  discoverHex(dimensionId, ORIGIN);
  saveDiscoveredHexIcon(dimensionId, ORIGIN, "town");
  markRunCleared(room.runId, dimensionId, ORIGIN); // old dim's origin row lingers (harmless)

  room.dimensionId = dimensionId;
  room.startDimensionId = dimensionId;
  room.dimensionName = meta.name;
  room.dimensionTier = meta.tier;

  const hexes = loadDiscoveredHexes(dimensionId);
  hexes[ORIGIN_KEY] = "explored";
  const icons: Record<string, HexIconType> = { [ORIGIN_KEY]: "town" };
  for (const [key, icon] of Object.entries(loadDiscoveredHexIcons(dimensionId))) icons[key] = icon as HexIconType;
  room.hexMap = { playerPos: ORIGIN, hexes, icons };
  room.visitedThisRun = new Set([ORIGIN_KEY]);
  room.gateways = loadGatewaysForDimension(dimensionId);

  // Contract re-derivation (flag #12): offers are per-dimension-map. Re-assign the same TYPE with a
  // fresh target hex if still offered, else drop the selection.
  if (room.contract) {
    const offers = buildContractOffers(room.hexMap.icons);
    if (offers.some((o) => o.type === room.contract!.type)) assignContract(room, room.contract.type);
    else {
      room.contract = null;
      clearRunContract(room.runId);
    }
  }

  // Manifest re-validation (flag #12 applied to manifests): drop now-ineligible picks against the
  // new destination's tier and rematerialize; the broadcast below carries the shrunk manifestIds.
  const newTier = effectiveStartingTier(room.dimensionTier);
  for (const s of room.seats) {
    if (s.manifestIds.length === 0 || !s.accountId) continue;
    const kept = s.manifestIds.filter((id) => {
      const e = loadCodexEntry(s.accountId!, id)!;
      return isManifestable(JSON.parse(e.item_json) as ItemDefinition, e.tier, newTier);
    });
    if (kept.length !== s.manifestIds.length) {
      s.manifestIds = kept;
      s.inventory = buildSeatLoadout(s.presetId ?? DEFAULT_PRESET_ID, manifestItemsFor(s));
      saveSeatInventory(room.runId, s.seatIndex, s.inventory);
      if (s.socket) sendInventory(room, io, s);
    }
  }

  broadcastRoomState(room, io);
  const offers = buildContractOffers(room.hexMap.icons);
  for (const s of room.seats) if (s.socket) io.send(s, { type: "contractOffers", offers });
}

function handleDebugWin(room: Room, seat: Seat): void {
  if (!isHost(room, seat)) {
    io.send(seat, { type: "error", code: "NOT_HOST", message: "Only the host can do that", recoverable: true });
    return;
  }
  if (room.phase !== "combat" || !room.session) {
    io.send(seat, { type: "error", code: "BAD_PHASE", message: "Not in combat", recoverable: true });
    return;
  }
  abortDefendRound(room);
  room.session.state = { ...room.session.state, winner: "red" };
  broadcastState(room, io, []);
  endCombat(room, io);
}

/** Dev/test hook: force a party wipe so the held Game Over end state can be exercised deterministically. */
function handleDebugLose(room: Room, seat: Seat): void {
  if (!isHost(room, seat)) {
    io.send(seat, { type: "error", code: "NOT_HOST", message: "Only the host can do that", recoverable: true });
    return;
  }
  if (room.phase !== "combat" || !room.session) {
    io.send(seat, { type: "error", code: "BAD_PHASE", message: "Not in combat", recoverable: true });
    return;
  }
  abortDefendRound(room);
  room.session.state = { ...room.session.state, winner: "blue" };
  broadcastState(room, io, []);
  endCombat(room, io);
}

// =====================================================================================
// Seat-scoped inventory handlers (only off-combat, R26) — durable write point 3 (R34).
// =====================================================================================

function applyInventoryChange(room: Room, seat: Seat): void {
  // R34 write-before-ack: commit the durable rows BEFORE the inventory ack.
  seat.animSet = getAnimSet(seat.inventory.equipped);
  saveSeatInventory(room.runId, seat.seatIndex, seat.inventory);
  sendInventory(room, io, seat);
  broadcastRoomState(room, io); // loadoutSummary in the roster changed
}

/** Re-seed a seat's whole loadout from a starter preset (lobby only, before Start). Auto-equips the
 *  preset kit + baked attachments; the player may then hand-edit it in the loadout editor. */
function handleChoosePreset(room: Room, seat: Seat, ws: ServerWebSocket<SocketData>, presetId: string): void {
  if (room.phase !== "lobby") return sendError(ws, "BAD_PHASE", "Presets can only be chosen in the lobby");
  if (!getPreset(presetId)) return sendError(ws, "BAD_PHASE", `Unknown preset "${presetId}"`);
  // Re-pick keeps the seat's manifested designs (they materialize into the fresh preset bag, §4.6).
  seat.inventory = buildSeatLoadout(presetId, manifestItemsFor(seat));
  seat.presetId = presetId;
  applyInventoryChange(room, seat);
}

/** Set this seat's manifest picks (full replacement). Validates count (K = expeditionSlots(level)),
 *  dedup, codex membership, non-consumable, and the tier gate; then materializes into the bag (§4.6). */
function handleChooseManifest(room: Room, seat: Seat, ws: ServerWebSocket<SocketData>, itemIds: readonly string[]): void {
  if (room.phase !== "lobby") return sendError(ws, "BAD_PHASE", "Manifests are chosen in the lobby");
  if (!seat.accountId) return sendError(ws, "INVALID_INPUT", "No account bound to this seat");
  if (new Set(itemIds).size !== itemIds.length)
    return sendError(ws, "INVALID_INPUT", "Duplicate design"); // flag #7
  const level = loadCardProfile(seat.accountId).level; // server-derived
  const slots = expeditionSlots(level);
  if (itemIds.length > slots)
    return sendError(ws, "INVALID_INPUT", `Too many designs (max ${slots})`);
  const startingTier = effectiveStartingTier(room.dimensionTier); // lobby: current ≡ start (04 §10)
  const manifest: ItemDefinition[] = [];
  for (const id of itemIds) {
    const entry = loadCodexEntry(seat.accountId, id);
    if (!entry) return sendError(ws, "INVALID_INPUT", "Not in your codex");
    const item = JSON.parse(entry.item_json) as ItemDefinition;
    if (item.type === "consumable")
      return sendError(ws, "INVALID_INPUT", "Consumable designs cannot be manifested"); // locked #5
    if (!isManifestable(item, entry.tier, startingTier))
      return sendError(ws, "INVALID_INPUT", "That design's tier exceeds this expedition");
    manifest.push(item);
  }
  seat.manifestIds = [...itemIds];
  seat.inventory = buildSeatLoadout(seat.presetId ?? DEFAULT_PRESET_ID, manifest);
  applyInventoryChange(room, seat);
}

function handleEquip(room: Room, seat: Seat, ws: ServerWebSocket<SocketData>, bagIndex: number): void {
  if (room.phase === "combat") return sendError(ws, "BAD_PHASE", "Cannot change loadout in combat");
  seat.inventory = equipFromBag(seat.inventory, bagIndex);
  seat.presetId = null; // hand-edited: no longer a pristine preset
  applyInventoryChange(room, seat);
}

function handleUnequip(room: Room, seat: Seat, ws: ServerWebSocket<SocketData>, equippedIndex: number): void {
  if (room.phase === "combat") return sendError(ws, "BAD_PHASE", "Cannot change loadout in combat");
  seat.inventory = unequipItem(seat.inventory, equippedIndex);
  seat.presetId = null; // hand-edited: no longer a pristine preset
  applyInventoryChange(room, seat);
}

function handleUpdateAttachment(
  room: Room,
  seat: Seat,
  ws: ServerWebSocket<SocketData>,
  itemId: string,
  attachment: import("shared").AttachmentData,
): void {
  if (room.phase === "combat") return sendError(ws, "BAD_PHASE", "Cannot change loadout in combat");
  seat.inventory = {
    ...seat.inventory,
    attachments: { ...seat.inventory.attachments, [itemId]: attachment },
  };
  applyInventoryChange(room, seat);
}

// =====================================================================================
// Message router
// =====================================================================================

function routeMessage(ws: ServerWebSocket<SocketData>, msg: ClientMessage): void {
  switch (msg.type) {
    // --- connection scope ---
    case "hello":
      return handleHello(ws, msg);
    case "createRoom":
      return handleCreateRoom(ws, msg);
    case "joinRoom":
      return handleJoinRoom(ws, msg);
    case "reclaimSeat":
      return handleReclaimSeat(ws, msg);
    case "listRooms":
      return handleListRooms(ws);
    case "quickMatch":
      return handleQuickMatch(ws, msg);
  }

  // --- connection-scoped account/social (no seat required, but hello must have run) ---
  // claim/register/login are async (Bun.password) and MUST catch internally (§5 async-handler rule):
  // routeMessage and the ws message() try/catch are synchronous, so a rejected promise would escape.
  switch (msg.type) {
    case "claimAccount":
    case "register":
    case "login":
    case "logout":
    case "getProfile":
    case "setDisplayName":
    case "equipTitle":
    case "getFriends":
    case "friendRequest":
    case "friendAccept":
    case "friendDecline":
    case "friendRemove":
    case "getCodex": {
      if (!ws.data.clientId) return sendError(ws, "BAD_PHASE", "Say hello first");
      switch (msg.type) {
        case "getCodex":
          return handleGetCodex(ws);
        case "claimAccount":
          return void handleClaimAccount(ws, msg);
        case "register":
          return void handleRegister(ws, msg);
        case "login":
          return void handleLogin(ws, msg);
        case "logout":
          return handleLogout(ws);
        case "getProfile":
          return handleGetProfile(ws, msg);
        case "setDisplayName":
          return handleSetDisplayName(ws, msg);
        case "equipTitle":
          return handleEquipTitle(ws, msg);
        case "getFriends":
          return handleGetFriends(ws);
        case "friendRequest":
          return handleFriendRequest(ws, msg);
        case "friendAccept":
          return handleFriendAccept(ws, msg);
        case "friendDecline":
          return handleFriendDecline(ws, msg);
        case "friendRemove":
          return handleFriendRemove(ws, msg);
      }
    }
  }

  // Everything below requires a bound seat (R22).
  const bound = seatFor(ws);
  if (!bound) {
    sendError(ws, "NOT_YOUR_SEAT", "No bound seat for this connection");
    return;
  }
  const { room, seat } = bound;

  switch (msg.type) {
    // --- seat-scoped gameplay ---
    case "action": {
      if (msg.seatId !== seat.seatId) {
        sendError(ws, "NOT_YOUR_SEAT", "Action seatId mismatch");
        return;
      }
      // Router rejects the endTurn primitive over the wire (R3); clients pass/unpass.
      if ((msg.action as { type?: string }).type === "endTurn") {
        io.send(seat, { type: "actionRejected", seatId: seat.seatId });
        return;
      }
      applyHumanAction(room, io, seat, msg.action);
      return;
    }
    case "pass":
      return setReady(room, io, seat, true);
    case "unpass":
      return setReady(room, io, seat, false);
    case "defendResult": {
      if (msg.seatId !== seat.seatId) {
        io.send(seat, { type: "actionRejected", seatId: seat.seatId });
        return;
      }
      return submitDefend(room, io, seat, msg.promptId, msg.power);
    }
    case "setReady": {
      // Lobby readiness flag (roster-only). In combat, pass/unpass is the path.
      if (room.phase === "lobby") {
        seat.ready = msg.ready;
        broadcastRoomState(room, io);
      } else {
        io.send(seat, { type: "actionRejected", seatId: seat.seatId });
      }
      return;
    }

    // --- seat-scoped inventory (off-combat, R26) ---
    case "choosePreset":
      return handleChoosePreset(room, seat, ws, msg.presetId);
    case "chooseManifest":
      return handleChooseManifest(room, seat, ws, msg.itemIds);
    case "equip":
      return handleEquip(room, seat, ws, msg.bagIndex);
    case "unequip":
      return handleUnequip(room, seat, ws, msg.equippedIndex);
    case "updateAttachment":
      return handleUpdateAttachment(room, seat, ws, msg.itemId, msg.attachment);

    // --- room-scoped overworld ---
    case "proposeMove":
      return proposeMove(room, io, seat, msg.target);
    case "proposeRetreat":
      return proposeRetreat(room, io, seat);
    case "proposeTravel":
      return proposeTravel(room, io, seat);
    case "claimLoot":
      return proposeLootClaim(room, io, seat, msg.lootId);
    case "castVote":
      return castVote(room, io, seat, msg.proposalId, msg.vote);
    case "playAgain":
      return handlePlayAgain(room, seat);
    case "leaveRoom":
      return handleLeaveRoom(ws, room, seat);

    // --- seat-scoped social ---
    case "chatSend":
      return handleChatSend(room, seat, ws, msg.text);
    case "friendInvite":
      return handleFriendInvite(room, seat, ws, msg.accountId);

    // --- host-gated ---
    case "chooseContract":
      return handleChooseContract(room, seat, ws, msg.contractType);
    case "chooseDimension":
      return handleChooseDimension(room, seat, ws, msg.dimensionId);
    case "startGame":
      return handleStartGame(room, seat);
    case "reset":
      return handleReset(room, seat);
    case "debugWin":
      return handleDebugWin(room, seat);
    case "debugLose":
      return handleDebugLose(room, seat);
  }
}

function handleLeaveRoom(ws: ServerWebSocket<SocketData>, room: Room, seat: Seat): void {
  ws.data.roomCode = null;
  ws.data.seatId = null;
  // An explicit, voluntary leave: a started seat becomes a PERMANENT bot (not a reclaimable drop).
  detachSeat(room, seat, "leave");
  // Tell the now-room-less socket to show HOME; the ws stays open for matchmaking/create/join.
  sendTo(ws, { type: "leftRoom" });
}

/**
 * Teardown for a seat's socket going away. `reason` splits voluntary LEAVE (a started seat becomes a
 * permanent bot; the party plays on) from an involuntary socket CLOSE (a reclaimable drop, today's
 * grace->bot behavior). The lobby branch is identical either way — the seat just frees to `open`.
 */
function detachSeat(room: Room, seat: Seat, reason: "leave" | "close"): void {
  if (room.phase === "lobby") {
    // Lobby: free the seat back to open (or host migrates / room reaps if empty).
    seat.socket = null;
    if (room.hostSeatId === seat.seatId) {
      const next = room.seats.find((s) => s.state === "human-connected" && s !== seat);
      room.hostSeatId = next?.seatId ?? null;
    }
    // Durably stamp this seat as left so its clientId is freed for a fresh create/join (R32) — the
    // in-memory seat going `open` must be mirrored durably or the UNIQUE-live index lingers.
    // The account identity must clear with it: an open seat carrying the leaver's accountId leaks
    // it on every roomState and later crashes persistSeat once the seat is bot-filled.
    const seatIndex = seat.seatIndex;
    const leaverAccountId = seat.accountId;
    seat.state = "open";
    seat.clientId = null;
    seat.tokenSalt = null;
    seat.ready = false;
    seat.accountId = null;
    seat.cardProfile = null;
    seat.displayName = `Player ${seatIndex + 1}`;
    // Loadout is account-gated: a freed seat must return to the createOpenSeats default. Otherwise the
    // next joiner (or a startGame bot) inherits the leaver's manifested codex designs — violating the
    // protocol contract that manifestIds are [] for open/bot seats, and later crashing
    // chooseDimension's codex re-validation on a design the new account never owned.
    seat.manifestIds = [];
    seat.presetId = DEFAULT_PRESET_ID;
    seat.inventory = buildPresetInventory(DEFAULT_PRESET_ID);
    seat.animSet = getAnimSet(seat.inventory.equipped);
    leaveRunSeat(room.runId, seatIndex);
    broadcastRoomState(room, io);
    // The seated-account union shrank: re-broadcast the run-start picker (flag #13 — the current
    // selection is NOT revalidated; eligibility was checked at chooseDimension time). No-op if empty.
    broadcastDimensionOptions(room);
    if (room.seats.every((s) => s.socket === null)) {
      // A never-started lobby that fully empties is abandoned durably so findActiveSeatForClient no
      // longer resolves it (else a later hello would resurrect it mid-overworld with bots, #20) and
      // it cannot linger active=1 forever. Then dispose the in-memory room immediately.
      finalizeRun(room.runId, "abandoned");
      reapRoom(room);
    }
    // Friends-panel joinability (§7.4): the leaver lost their room; the survivors' room may have
    // just regained an open seat (or vanished entirely if it reaped above).
    if (leaverAccountId !== null) pushPresenceDelta(leaverAccountId);
    pushRoomPresenceDelta(room);
    return;
  }
  // Overworld / combat / gameover. A voluntary leave permanently bots the seat; an involuntary close
  // is a reclaimable disconnect (grace->bot). Either way the empty-reap finalizes the run (inactive)
  // so a reconnect after the window lands on HOME (mortal game).
  if (reason === "leave") {
    leaveSeatPermanently(room, io, seat, reapEmptyRoom);
  } else {
    onSeatDisconnected(room, io, seat, reapEmptyRoom);
  }
}

// =====================================================================================
// HTTP + WebSocket server. The fetch() routes are preserved verbatim from the pre-Room
// server (only the websocket handlers + the globals + the seeding boot changed).
// =====================================================================================

const PORT = Number(process.env.PORT) || 3001;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", uptime: process.uptime() });
    }
    if (url.pathname === "/api/wire-log") {
      const limitRaw = Number(url.searchParams.get("limit") ?? "200");
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.floor(limitRaw))) : 200;
      const room = url.searchParams.get("room") ?? undefined;
      // Serve the in-memory ring by default — it's populated in every dev sink (`ring`/`stdout`/`db`),
      // so the log is reachable without forcing `MP_EVENT_LOG=db`. `?persisted=1` reads the DB instead
      // (survives restarts; only written when the sink is `db`).
      const usePersisted = url.searchParams.get("persisted") === "1";
      const records = usePersisted ? eventLog.persisted({ room, limit }) : eventLog.recent({ room, limit });
      return Response.json(records, { headers: CORS_HEADERS });
    }
    if (url.pathname === "/ws") {
      // Identity comes from the `hello` message, never from query params (ruling R22). `?dim=` is
      // tolerated only as an asset-preload hint and ignored for identity here.
      const upgraded = server.upgrade(req, {
        data: { clientId: "", sessionToken: "", roomCode: null, seatId: null, seq: 0, accountId: null, authToken: null } as SocketData,
      });
      if (!upgraded)
        return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined;
    }
    const spritesPrefix = "/api/sprites/";
    if (url.pathname.startsWith(spritesPrefix)) {
      const relativePath = url.pathname.slice(spritesPrefix.length);
      if (relativePath.includes("..")) return new Response("Forbidden", { status: 403 });
      const filePath = join(SERVER_SPRITES_DIR, relativePath);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname.startsWith("/api/dimensions/")) {
      const dimId = parseInt(url.pathname.split("/")[3]!, 10);
      if (isNaN(dimId)) return new Response("Invalid dimension id", { status: 400 });
      const dimension = loadDimension(dimId);
      if (!dimension) return new Response("Dimension not found", { status: 404 });
      const registry = loadEnemyTemplateRegistry(dimId);
      const spritePaths: string[] = [];
      for (const template of Object.values(registry)) {
        if (template.sprites) {
          for (const path of Object.values(template.sprites)) {
            if (!spritePaths.includes(path)) spritePaths.push(path);
          }
        }
      }
      const structureSprites: Record<string, string> = {};
      for (const s of dimension.structures) {
        if (s.spritePath) structureSprites[s.name] = s.spritePath;
      }
      const dimItems = loadItems(dimId);
      const itemSprites: Record<string, string> = {};
      const itemsRoot = ASSETS_DIR;
      for (const item of Object.values(dimItems)) {
        const prefix = item.dimensionId === 0 ? "" : `dimension-${item.dimensionId}/`;
        const rel = `sprites/items/${prefix}${item.sprite}`;
        const ext = existsSync(join(itemsRoot, `${rel}.png`)) ? "png" : "webp";
        itemSprites[item.sprite] = `${rel}.${ext}`;
      }
      return Response.json({
        id: dimId,
        name: dimension.name,
        spritePaths,
        structureSprites,
        itemSprites,
        backgroundPath: dimension.backgroundPath,
        hexDecorationsPath: dimension.hexDecorationsPath,
      }, { headers: CORS_HEADERS });
    }

    // Shared static assets (sprites/maps/items) live in the top-level public/ store. In dev Vite
    // serves these; in prod the bun server is the single origin, so serve them from ASSETS_DIR.
    if (url.pathname.startsWith("/sprites/")) {
      const rel = url.pathname.slice(1);
      if (!rel.includes("..")) {
        const file = Bun.file(join(ASSETS_DIR, rel));
        if (await file.exists()) {
          return new Response(file, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
        }
      }
      return new Response("Not found", { status: 404 });
    }

    // Static: serve the built web app for anything not matched above. In prod the bun server is the
    // single origin (static + /api + /ws); in dev WEB_DIST_DIR is absent and Vite serves the frontend.
    if (req.method === "GET" && existsSync(WEB_DIST_DIR)) {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!rel.includes("..")) {
        const asset = Bun.file(join(WEB_DIST_DIR, rel));
        if (await asset.exists()) {
          const immutable = url.pathname.startsWith("/assets/");
          return new Response(asset, {
            headers: { "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
          });
        }
      }
      // SPA fallback: unknown non-file path -> index.html for client-side routing.
      const index = Bun.file(join(WEB_DIST_DIR, "index.html"));
      if (await index.exists()) {
        return new Response(index, { headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" } });
      }
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws: ServerWebSocket<SocketData>) {
      ws.data = { clientId: "", sessionToken: "", roomCode: null, seatId: null, seq: 0, accountId: null, authToken: null };
    },

    message(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as ClientMessage;
      } catch {
        sendError(ws, "MALFORMED", "Invalid JSON");
        return;
      }
      if (!msg || typeof (msg as { type?: unknown }).type !== "string") {
        sendError(ws, "MALFORMED", "Missing message type");
        return;
      }
      try {
        routeMessage(ws, msg);
      } catch (e) {
        console.error(`[ws] handler error for ${msg.type}:`, e);
        // Surface a recoverable error instead of silently swallowing the throw, so a client whose
        // request hit an unexpected handler failure is not left hanging with no welcome/no error.
        sendError(ws, "MALFORMED", "The server could not process that request", true);
      }
    },

    close(ws: ServerWebSocket<SocketData>) {
      // Presence FIRST, before the early-return-if-unseated: room-less HOME sockets are the
      // primary presence audience and must go offline too. No-op if the socket died pre-hello.
      const prev = presence.unregister(ws);
      if (prev?.wentOffline) pushPresenceDelta(prev.accountId);
      const bound = seatFor(ws);
      if (!bound) return;
      const { room, seat } = bound;
      // Only react if THIS socket still owns the seat (a force-takeover already cleared its binding).
      if (seat.socket !== ws) return;
      detachSeat(room, seat, "close");
    },
  },
});

console.log(`Game server running on port ${PORT}`);
