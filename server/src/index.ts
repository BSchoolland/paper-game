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
  HexCoord,
} from "shared";
import { PROTOCOL_VERSION, getAnimSet, hexKey, getHexIcon, isDecorationHex } from "shared";
import { loadDimension, loadEnemyTemplateRegistry, loadItems } from "./db.js";
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
  newTokenSalt,
  mintSessionToken,
  verifySessionToken,
} from "./db.js";
import { rooms } from "./room-registry.js";
import {
  createOpenSeats,
  buildDefaultInventory,
  freshRoomCode,
  seatIdForIndex,
} from "./room.js";
import type { Room, Seat, SocketData } from "./room.js";
import {
  type RoomIO,
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
  castVote,
  beginCombatEntry,
  endCombat,
  resetToOrigin,
  recoverActiveRuns,
  connectSeat,
  onSeatDisconnected,
  leaveSeatPermanently,
  abortDefendRound,
  resendPendingDefendPrompts,
  armReap,
  clearReap,
} from "./room-machine.js";
import { seedDimension0 } from "./seed.js";
import { seedDimension1 } from "./seed-dimension-1.js";
import { seedDimension2 } from "./seed-dimension-2.js";
import { seedDimension3 } from "./seed-dimension-3.js";
import { seedDimension501 } from "./seed-dimension-501.js";
import { equipFromBag, unequipItem } from "shared";
import { join } from "path";
import { existsSync } from "fs";

export function initSeeds(): void {
  seedDimension0();
  seedDimension1();
  seedDimension2();
  seedDimension3();
  seedDimension501();
}

// Auto-seed on normal boot. Tests/harnesses set GAME_SKIP_SEED=1 (with an in-memory
// GAME_DB_PATH) to import the server without touching disk seeds. There is no global game
// session anymore (ruling R27): rooms — and their runs — are created on demand via createRoom.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // R33: deactivate runs idle longer than 7 days.
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000; // hourly sweep.
if (process.env.GAME_SKIP_SEED !== "1") {
  initSeeds();
  recoverActiveRuns(reapEmptyRoom);
  // R33 retention housekeeping: periodically inactivate runs untouched past the retention window,
  // catching abandoned lobby/overworld runs that no run-end event ever closed. Gated off under
  // GAME_SKIP_SEED (tests) so the in-memory test DB isn't churned by a timer.
  const sweep = setInterval(() => {
    try {
      const n = deactivateStaleRuns(RETENTION_MS, (runId) => rooms.getByRun(runId) !== null);
      if (n > 0) console.log(`[housekeeping] deactivated ${n} stale run(s)`);
    } catch (e) {
      console.error("[housekeeping] sweep failed:", e);
    }
  }, HOUSEKEEPING_INTERVAL_MS);
  sweep.unref?.(); // don't keep the process alive solely for the sweep.
}

const ORIGIN: HexCoord = { q: 0, r: 0 };
const ORIGIN_KEY = hexKey(ORIGIN);
const DISCOVERY_RADIUS = 15;
const DEFAULT_DIMENSION = 1;
const QUICKMATCH_CAPACITY: RoomCapacity = 4; // quick-match creates a 4-seat room when none are open

// =====================================================================================
// RoomIO — the WS transport the machine drives through (it never touches sockets itself).
// =====================================================================================

const io: RoomIO = {
  send(seat: Seat, msg: ServerMessage): void {
    seat.socket?.send(JSON.stringify(msg));
  },
  broadcast(room: Room, msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const seat of room.seats) {
      if (seat.socket) seat.socket.send(json);
    }
  },
};

function sendTo(ws: ServerWebSocket<SocketData>, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

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

/** Push the post-bind snapshots to a (re)connecting seat (resume step 8 / hello-reclaim). */
function sendSeatSnapshots(room: Room, seat: Seat): void {
  io.send(seat, { type: "roomState", room: roomStatePayload(room, seat) });
  if (room.phase === "overworld") {
    // Send the visibility-expanded map (same payload as the broadcast), NOT raw room.hexMap, so the
    // resuming player gets the clickable frontier the server's proposeMove check expects (no desync).
    io.send(seat, { type: "hexMapState", hexMap: hexMapStatePayload(room) });
  }
  sendInventory(room, io, seat);
  if (room.phase === "combat" && room.session) {
    io.send(seat, { type: "state", state: room.session.serialize() as import("shared").SerializedGameState, events: [] });
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

  const clientId = msg.clientId;
  ws.data.clientId = clientId;

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
          sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, reconnected: { code: room.code, seatId: seat.seatId } });
          sendSeatSnapshots(room, seat);
          broadcastRoomState(room, io);
          if (room.phase === "combat") broadcastCoopStatus(room, io);
        } else {
          // Seat is live elsewhere: welcome room-less but with the valid token (force-reclaim path).
          sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token });
        }
        return;
      }
    }
  }

  // No resumable seat (or the seat is still live): welcome to lobby. Token is minted fresh and
  // re-derived/replaced when the client takes a seat (createRoom / joinRoom).
  const token = mintTokenFor(clientId, newTokenSalt());
  ws.data.sessionToken = token;
  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token });
}

/** Build a brand-new room + durable run for the host (write point 1, R13.1). */
function handleCreateRoom(ws: ServerWebSocket<SocketData>, msg: Extract<ClientMessage, { type: "createRoom" }>): void {
  if (!ws.data.clientId) return sendError(ws, "BAD_PHASE", "Say hello first");

  const capacity: RoomCapacity = msg.capacity;
  const dimensionId = msg.dimensionId ?? DEFAULT_DIMENSION;
  const clientId = ws.data.clientId;

  // R32: abandon any prior live seat this client holds BEFORE binding the new one, so the UNIQUE-
  // live index never sees two live rows for this clientId (the "play again" crash class).
  cleanupPriorSeat(ws, clientId);

  const code = freshRoomCode((c) => rooms.isTaken(c));
  if (!code) return sendError(ws, "ROOM_CREATE_FAILED", "Could not allocate a room code", true);

  // Durable run-create: run row + GLOBAL community discovery (radius disc + origin, per dimension) +
  // origin icon; this run starts cleared only at the origin. seedDiscovery/discoverHex are idempotent
  // so a returning dimension keeps every previously-discovered hex.
  const runId = startNewRun(dimensionId, clientId, capacity);
  seedDiscovery(dimensionId, DISCOVERY_RADIUS);
  discoverHex(dimensionId, ORIGIN);
  saveDiscoveredHexIcon(dimensionId, ORIGIN, "town");
  markRunCleared(runId, ORIGIN);

  const seats = createOpenSeats(capacity, dimensionId);

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
    runId,
    hexMap: { playerPos: ORIGIN, hexes, icons },
    visitedThisRun: new Set([ORIGIN_KEY]),
    pendingHex: null,
    capacity,
    seats,
    session: null,
    defendRound: null,
    vote: null,
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
  });
  saveSeatInventory(runId, host.seatIndex, host.inventory);

  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, reconnected: { code, seatId: host.seatId } });
  broadcastRoomState(room, io);
  sendInventory(room, io, host);
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
  if (msg.displayName) seat.displayName = msg.displayName;

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
  });
  saveSeatInventory(room.runId, seat.seatIndex, seat.inventory);

  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: token, reconnected: { code: room.code, seatId: seat.seatId } });
  broadcastRoomState(room, io);
  sendInventory(room, io, seat);
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

  sendTo(ws, { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: ws.data.sessionToken, reconnected: { code: room.code, seatId: seat.seatId } });
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
    handleJoinRoom(ws, { type: "joinRoom", code: target.code, displayName: msg.displayName });
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

  // Bot-fill every still-open seat (durable controller_kind='bot', write point 2).
  for (const s of room.seats) {
    if (s.state === "open") {
      s.state = "bot";
      s.clientId = null;
      s.tokenSalt = null;
      upsertRunSeat(room.runId, s.seatIndex, {
        clientId: null,
        displayName: s.displayName,
        controllerKind: "bot",
        tokenSalt: null,
      });
      saveSeatInventory(room.runId, s.seatIndex, s.inventory);
    }
  }

  room.phase = "overworld";
  setRunPhase(room.runId, "overworld"); // persist the lifecycle SSOT (crash recovery resumes overworld runs)
  broadcastRoomState(room, io);
  broadcastHexMapState(room, io);
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
 * "Play again" from the Game Over end state. ANY player may trigger it (locked decision — not host-
 * gated). The `phase === "gameover"` guard is what closes the double-click race: the first call's
 * resetToOrigin flips the phase to "overworld", so every subsequent concurrent click is a clean no-op
 * (single-threaded event loop — no interleaving between the guard and the flip). Host is re-derived by
 * resetToOrigin's startNewRun(hostClientId) over the currently-connected humans.
 */
function handlePlayAgain(room: Room, seat: Seat): void {
  if (room.phase !== "gameover") return; // not in the end state, or someone already restarted
  resetToOrigin(room, io);
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

function handleEquip(room: Room, seat: Seat, ws: ServerWebSocket<SocketData>, bagIndex: number): void {
  if (room.phase === "combat") return sendError(ws, "BAD_PHASE", "Cannot change loadout in combat");
  seat.inventory = equipFromBag(seat.inventory, bagIndex);
  applyInventoryChange(room, seat);
}

function handleUnequip(room: Room, seat: Seat, ws: ServerWebSocket<SocketData>, equippedIndex: number): void {
  if (room.phase === "combat") return sendError(ws, "BAD_PHASE", "Cannot change loadout in combat");
  seat.inventory = unequipItem(seat.inventory, equippedIndex);
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
    case "equip":
      return handleEquip(room, seat, ws, msg.bagIndex);
    case "unequip":
      return handleUnequip(room, seat, ws, msg.equippedIndex);
    case "updateAttachment":
      return handleUpdateAttachment(room, seat, ws, msg.itemId, msg.attachment);

    // --- room-scoped overworld ---
    case "proposeMove":
      return proposeMove(room, io, seat, msg.target);
    case "castVote":
      return castVote(room, io, seat, msg.proposalId, msg.vote);
    case "playAgain":
      return handlePlayAgain(room, seat);
    case "leaveRoom":
      return handleLeaveRoom(ws, room, seat);

    // --- host-gated ---
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
    const seatIndex = seat.seatIndex;
    seat.state = "open";
    seat.clientId = null;
    seat.tokenSalt = null;
    seat.ready = false;
    leaveRunSeat(room.runId, seatIndex);
    broadcastRoomState(room, io);
    if (room.seats.every((s) => s.socket === null)) {
      // A never-started lobby that fully empties is abandoned durably so findActiveSeatForClient no
      // longer resolves it (else a later hello would resurrect it mid-overworld with bots, #20) and
      // it cannot linger active=1 forever. Then dispose the in-memory room immediately.
      finalizeRun(room.runId, "abandoned");
      reapRoom(room);
    }
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
    if (url.pathname === "/ws") {
      // Identity comes from the `hello` message, never from query params (ruling R22). `?dim=` is
      // tolerated only as an asset-preload hint and ignored for identity here.
      const upgraded = server.upgrade(req, {
        data: { clientId: "", sessionToken: "", roomCode: null, seatId: null } as SocketData,
      });
      if (!upgraded)
        return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined;
    }
    const spritesPrefix = "/api/sprites/";
    if (url.pathname.startsWith(spritesPrefix)) {
      const relativePath = url.pathname.slice(spritesPrefix.length);
      if (relativePath.includes("..")) return new Response("Forbidden", { status: 403 });
      const filePath = join(import.meta.dir, "..", "sprites", relativePath);
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
      const itemsRoot = join(import.meta.dir, "..", "..", "client", "public");
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

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws: ServerWebSocket<SocketData>) {
      ws.data = { clientId: "", sessionToken: "", roomCode: null, seatId: null };
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
