import type {
  ServerMessage,
  SeatId,
  EntityId,
  HexCoord,
  HexIconType,
  VoteChoice,
  RoomStatePayload,
  CoopStatusPayload,
  SeatInfo,
  SeatCombatStatus,
  PendingDefendInfo,
  VoteStatePayload,
  GameEvent,
  SerializedGameState,
  EncounterType,
  Entity,
  TeamId,
} from "shared";
import {
  getVisibleHexes,
  getHexIcon,
  hexKey,
  parseHexKey,
  isAdjacent,
  isDecorationHex,
  getAnimSet,
  isPlayerPhaseOver,
  heroExhausted,
  resolveVote,
} from "shared";
import type { Room, Seat, DefendRound, DefendTarget, MovementVote } from "./room.js";
import { seatBuildSpec, sovereignFor } from "./room.js";
import { EncounterSession } from "./encounter-session.js";
import type { AiStepResult } from "./ai-turn-runner.js";
import {
  saveSeatInventory,
  updateRunPartyPos,
  commitExplore,
  markRunCleared,
  finalizeRun,
  startNewRun,
  setRunPhase,
  loadActiveRunIds,
  setRunHost,
  upsertRunSeat,
  loadRun,
  loadRunSeats,
  loadDiscoveredHexes,
  loadDiscoveredHexIcons,
  loadRunCleared,
  loadSeatInventory,
} from "./db.js";
import { rooms } from "./room-registry.js";
import { buildDefaultInventory, freshRoomCode, heroEntityIdFor, seatIdForIndex } from "./room.js";

type Timer = ReturnType<typeof setTimeout>;

/**
 * The Room combat / defend / vote / lifecycle MACHINE (DESIGN §4-§7, PERSISTENCE resume algo).
 *
 * Everything here operates on a `Room` and an injected {@link RoomIO}. The machine NEVER touches
 * sockets directly — only through `RoomIO` — so it is pure of WS details and the WS layer
 * (index.ts, Phase 6) supplies the transport. setTimeout / Date.now are fair game (server code).
 *
 * Generation / building / phaseTransitioning / aiPlayerBusy guards are honored throughout
 * (rulings R7, R8, R16, R17). Seat/ready/phase/vote/defend state lives only on the Room (R1).
 */

// --- Tunable timeouts (server-authoritative, R28 / R11). ---
export const DEFEND_TIMEOUT_MS = 6_000;
export const VOTE_TIMEOUT_MS = 15_000;
export const AFK_TIMEOUT_MS = 90_000;
export const DISCONNECT_GRACE_MS = Number(process.env.GAME_DISCONNECT_GRACE_MS) || 3_000;
// Env-overridable so integration tests can drive the empty-reap -> HOME path without a real 5-min wait.
export const REAP_TIMEOUT_MS = Number(process.env.GAME_REAP_TIMEOUT_MS) || 5 * 60_000;

const ORIGIN: HexCoord = { q: 0, r: 0 };

/**
 * The only channel through which the machine reaches clients. The WS layer implements it.
 * `send` targets a single seat's live socket (no-op if dead); `broadcast` fans out to every
 * connected seat in the room.
 */
export interface RoomIO {
  send(seat: Seat, msg: ServerMessage): void;
  broadcast(room: Room, msg: ServerMessage): void;
}

// =====================================================================================
// Message builders + broadcasters
// =====================================================================================

function seatInfo(room: Room, seat: Seat): SeatInfo {
  return {
    seatId: seat.seatId,
    state: seat.state,
    isHost: room.hostSeatId === seat.seatId,
    displayName: seat.displayName,
    heroEntityId: seat.heroEntityId,
    ready: seat.ready,
    loadoutSummary: { equippedIds: seat.inventory.equipped.map((i) => i.id) },
  };
}

/** The lobby/roster + phase snapshot for a given seat (R1). `forSeat` fills `yourSeatId`. */
export function roomStatePayload(room: Room, forSeat: Seat | null): RoomStatePayload {
  return {
    protocolVersion: 1,
    code: room.code,
    phase: room.phase,
    hostSeatId: room.hostSeatId,
    capacity: room.capacity,
    seats: room.seats.map((s) => seatInfo(room, s)),
    yourSeatId: forSeat?.seatId ?? null,
    runId: room.runId,
    dimensionId: room.dimensionId,
  };
}

function seatCombatStatus(seat: Seat): SeatCombatStatus {
  const controller: "human" | "ai" = seat.state === "human-connected" ? "human" : "ai";
  return {
    seatId: seat.seatId,
    heroEntityId: seat.heroEntityId,
    controller,
    connected: seat.state === "human-connected",
    ready: seat.ready,
    exhausted: seat.exhausted,
    displayName: seat.displayName,
  };
}

function pendingDefends(room: Room): PendingDefendInfo[] {
  const round = room.defendRound;
  if (!round) return [];
  return round.targets.map((t) => ({
    promptId: t.promptId,
    seatId: t.seatId,
    targetEntityId: t.entityId,
    answered: t.status === "answered",
  }));
}

/** In-combat per-seat status (R1). Sent on every transition. */
export function coopStatusPayload(room: Room): CoopStatusPayload {
  return {
    phase: room.coopPhase,
    seats: room.seats.map(seatCombatStatus),
    pendingDefends: pendingDefends(room),
    paused: room.paused,
  };
}

export function broadcastRoomState(room: Room, io: RoomIO): void {
  // yourSeatId is per-recipient; send each connected seat its own view.
  for (const seat of room.seats) {
    if (seat.socket) io.send(seat, { type: "roomState", room: roomStatePayload(room, seat) });
  }
}

export function broadcastCoopStatus(room: Room, io: RoomIO): void {
  io.broadcast(room, { type: "coopStatus", coop: coopStatusPayload(room) });
}

export function broadcastState(room: Room, io: RoomIO, events: readonly GameEvent[]): void {
  if (!room.session) return;
  io.broadcast(room, {
    type: "state",
    state: room.session.serialize() as SerializedGameState,
    events,
  });
}

export function sendInventory(room: Room, io: RoomIO, seat: Seat): void {
  io.send(seat, { type: "inventory", inventory: seat.inventory });
}

/**
 * The shared overworld hex map, visibility-expanded (adds the unexplored frontier ring via
 * getVisibleHexes) with re-derived icons. Both the broadcast and the per-seat reconnect snapshot
 * MUST use this so a resuming player sees the same clickable frontier the server's proposeMove
 * visibility check uses (no server-permissive / client-blind desync).
 */
export function hexMapStatePayload(room: Room): Extract<ServerMessage, { type: "hexMapState" }>["hexMap"] {
  const visible = getVisibleHexes(room.hexMap);
  const icons: Record<string, HexIconType> = {};
  for (const key of Object.keys(visible)) {
    const coord = parseHexKey(key);
    const icon = getHexIcon(coord, room.hexMap.icons);
    if (icon) icons[key] = icon;
  }
  return { playerPos: room.hexMap.playerPos, hexes: visible, icons };
}

/** Broadcast the shared overworld hex map (visibility-expanded + derived icons). */
export function broadcastHexMapState(room: Room, io: RoomIO): void {
  io.broadcast(room, { type: "hexMapState", hexMap: hexMapStatePayload(room) });
}

// =====================================================================================
// Helpers: seat lookup, brain derivation, exhaustion
// =====================================================================================

function seatById(room: Room, seatId: SeatId): Seat | null {
  return room.seats.find((s) => s.seatId === seatId) ?? null;
}

function heroEntity(room: Room, seat: Seat): Entity | undefined {
  return room.session?.state.entities.get(seat.heroEntityId);
}

function isBotSeat(seat: Seat): boolean {
  // A seat is AI-driven when it is a bot or a disconnected human awaiting reclaim.
  return seat.state === "bot" || seat.state === "human-disconnected";
}

function humanHeroIds(room: Room): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const seat of room.seats) {
    if (seat.state === "human-connected") ids.add(seat.heroEntityId);
  }
  return ids;
}

/** True iff at least one seat is a live connected human. The combat machine pauses without one. */
export function hasConnectedHuman(room: Room): boolean {
  return room.seats.some((s) => s.state === "human-connected");
}

/** Recompute one seat's exhausted flag from its live hero (R8 input). */
function recomputeSeatExhausted(room: Room, seat: Seat): void {
  seat.exhausted = heroExhausted(heroEntity(room, seat));
}

/** Recompute every seat's exhausted flag. */
export function recomputeExhausted(room: Room): void {
  for (const seat of room.seats) recomputeSeatExhausted(room, seat);
}

/**
 * Rebuild `heroBrains` from seat controllers (R12). The two stores (`seat.state` and
 * `heroBrains` membership) can never drift because this is the single derivation point,
 * called at every player/enemy phase start.
 */
export function rebuildHeroBrains(room: Room): void {
  const session = room.session;
  if (!session) return;
  session.heroBrains.clear();
  for (const seat of room.seats) {
    if (isBotSeat(seat)) {
      const brain = seat.brain ?? sovereignFor(seat);
      seat.brain = brain;
      session.heroBrains.set(seat.heroEntityId, brain);
    } else {
      seat.brain = null;
    }
  }
}

// =====================================================================================
// Timers (AFK, disconnect grace, reap) — R28 / R19 / R31
// =====================================================================================

function clearAfk(seat: Seat): void {
  if (seat.afkTimer) {
    clearTimeout(seat.afkTimer);
    seat.afkTimer = null;
  }
}

/** Arm the AFK auto-pass for a connected human so one idle player can't deadlock the phase (R28). */
function armAfk(room: Room, io: RoomIO, seat: Seat): void {
  clearAfk(seat);
  if (seat.state !== "human-connected") return;
  if (room.phase !== "combat" || room.coopPhase !== "player") return;
  const gen = room.generation;
  seat.afkTimer = setTimeout(() => {
    seat.afkTimer = null;
    if (room.generation !== gen) return;
    if (room.phase !== "combat" || room.coopPhase !== "player") return;
    if (seat.ready || seat.exhausted) return;
    seat.ready = true;
    broadcastCoopStatus(room, io);
    maybeEndPlayerPhase(room, io);
  }, AFK_TIMEOUT_MS);
}

export function clearReap(room: Room): void {
  if (room.reapTimer) {
    clearTimeout(room.reapTimer);
    room.reapTimer = null;
  }
}

/**
 * Arm the idle reaper. A room with no connected humans is disposed after the timeout (R19/R31). The
 * `onReap` callback decides whether the durable run is finalized: the graceful empty-reap passes
 * `reapEmptyRoom` (marks the run inactive -> reconnect goes HOME), while prior-seat/zombie disposal
 * passes plain `reapRoom` (run stays active). Crash recovery relies on a crashed run staying active.
 */
export function armReap(room: Room, onReap: (room: Room) => void): void {
  clearReap(room);
  room.reapTimer = setTimeout(() => {
    room.reapTimer = null;
    const stillEmpty = room.seats.every((s) => s.socket === null);
    if (stillEmpty) onReap(room);
  }, REAP_TIMEOUT_MS);
}

// =====================================================================================
// Combat phase machine (DESIGN §4)
// =====================================================================================

/**
 * Begin a fresh player phase (DESIGN §4 startPlayerPhase). Rebuilds brains (R12), resets per-seat
 * flags, arms AFK timers, then runs the synchronous player-bot burst (R16) and routes through the
 * single latch (R8).
 */
export function startPlayerPhase(room: Room, io: RoomIO): void {
  const session = room.session;
  if (!session) return;
  room.coopPhase = "player";
  rebuildHeroBrains(room);

  for (const seat of room.seats) {
    seat.ready = false;
    seat.actedThisPhase = false;
    recomputeSeatExhausted(room, seat);
    armAfk(room, io, seat);
  }

  // PAUSE: with no connected human nobody is watching, so freeze the phase rather than letting the
  // player-bot burst + enemy sweep cascade the whole encounter to a win/wipe unobserved. Resumed by
  // connectSeat when a human (re)joins. (Phase 1 of the lifecycle redesign.)
  if (!hasConnectedHuman(room)) {
    room.paused = true;
    broadcastCoopStatus(room, io);
    return;
  }
  room.paused = false;
  broadcastCoopStatus(room, io);

  // Player-bot burst: drive every bot/disconnected seat synchronously in seat order.
  const botIds = room.seats.filter(isBotSeat).map((s) => s.heroEntityId);
  if (botIds.length > 0) {
    room.aiPlayerBusy = true;
    session.startAiTurn({ kind: "playerBots", entityIds: botIds, humanHeroIds: humanHeroIds(room) });
    driveAiSteps(room, io);
  } else {
    maybeEndPlayerPhase(room, io);
  }
}

/**
 * The SINGLE player->enemy latch (R8). It is the ONLY site that issues the player-phase-ending
 * `endTurn`. No-ops unless the phase is genuinely open and not already transitioning / mid-burst.
 */
export function maybeEndPlayerPhase(room: Room, io: RoomIO): void {
  const session = room.session;
  if (!session) return;
  if (room.phase !== "combat" || room.coopPhase !== "player") return;
  if (session.state.activeTeam !== "red") return;
  if (room.phaseTransitioning || room.aiPlayerBusy || room.building) return;
  if (session.pendingDefend) return; // an open defend round is mid-flight
  // The single load-bearing pause latch: never issue the player->enemy flip without a human present
  // (this subsumes a guard in startEnemyPhase — the enemy sweep is unreachable human-less from here).
  if (!hasConnectedHuman(room)) {
    room.paused = true;
    return;
  }

  const phaseStates = room.seats.map((s) => ({ ready: s.ready, exhausted: s.exhausted }));
  if (!isPlayerPhaseOver(phaseStates)) return;

  room.phaseTransitioning = true;
  for (const seat of room.seats) clearAfk(seat);

  const result = session.applyAction({ type: "endTurn" });
  room.coopPhase = "enemy";
  broadcastState(room, io, result.events);
  broadcastCoopStatus(room, io);

  if (session.state.winner) {
    endCombat(room, io);
    return;
  }
  startEnemyPhase(room, io);
}

/**
 * Begin the enemy phase (DESIGN §4 startEnemyPhase). The runner sweeps `"blue"` and issues the
 * terminal `endTurn` that flips blue->red, after which we re-open the player phase.
 */
export function startEnemyPhase(room: Room, io: RoomIO): void {
  const session = room.session;
  if (!session) return;
  rebuildHeroBrains(room);
  const beforeTeam = session.state.activeTeam;
  session.startAiTurn({ kind: "enemyPhase", team: "blue" });
  driveAiSteps(room, io);
  // If the sweep already flipped back to red (no defend prompt is pending), re-open the player phase.
  if (
    !session.state.winner &&
    !session.pendingDefend &&
    session.state.activeTeam === "red" &&
    beforeTeam !== "red"
  ) {
    room.phaseTransitioning = false;
    startPlayerPhase(room, io);
  }
}

/**
 * Generation-guarded AI step loop (R17). Drives `session.stepAi()`: broadcasts on events, opens a
 * defend round on a prompt (and returns — resumed by maybeResolveDefendRound), finishes on `done`.
 * A `done` while in the player-bot burst marks bot seats ready and re-latches the phase.
 */
export function driveAiSteps(room: Room, io: RoomIO): void {
  const session = room.session;
  if (!session) return;
  const gen = room.generation;
  let safety = 0;
  while (true) {
    if (++safety > 500) {
      console.error("[room] driveAiSteps safety break");
      return;
    }
    if (room.generation !== gen) return; // superseded by reset/rebuild (R17)

    const step: AiStepResult = session.stepAi();

    if (step.type === "done" || step.type === "endedTurn") {
      // Step 6 (transitional): treat the new explicit `endedTurn` like `done`; the enemy->player flip
      // is still detected after-the-fact by startEnemyPhase below. Step 8 makes this the explicit flip.
      onAiBurstDone(room, io);
      return;
    }
    if (step.type === "defendPrompt") {
      openDefendRound(room, io, step);
      return;
    }
    // events
    io.broadcast(room, {
      type: "state",
      state: step.serializedState as SerializedGameState,
      events: step.events,
    });
    // Track per-seat actedThisPhase for player-bot driven heroes.
    if (room.coopPhase === "player") {
      for (const ev of step.events) markActedFromEvent(room, ev);
    }
    if (step.won) {
      endCombat(room, io);
      return;
    }
  }
}

function markActedFromEvent(room: Room, ev: GameEvent): void {
  // `attack` events carry the actor as `attackerId`; move/barrier/knockback/etc. use `entityId`.
  // Reading only `entityId` would miss the most common bot action (an attack), letting a mid-burst
  // reclaim hand an attacking bot's already-spent turn back to the human (R10 connectSeat check).
  const actor = ev.type === "attack" ? ev.attackerId : (ev as { entityId?: EntityId }).entityId;
  if (!actor) return;
  const seat = room.seats.find((s) => s.heroEntityId === actor);
  if (seat) seat.actedThisPhase = true;
}

/**
 * The AI runner reported `done`. In the enemy phase the runner already issued `endTurn` (handled by
 * startEnemyPhase's flip check). In the player-bot burst, mark every bot seat ready and re-latch.
 */
function onAiBurstDone(room: Room, io: RoomIO): void {
  if (room.coopPhase === "player" && room.aiPlayerBusy) {
    for (const seat of room.seats) {
      if (isBotSeat(seat)) {
        seat.ready = true;
        seat.actedThisPhase = true;
      }
    }
    room.aiPlayerBusy = false;
    broadcastCoopStatus(room, io);
    maybeEndPlayerPhase(room, io);
  }
  // enemy-phase `done`: the flip back to red is detected by startEnemyPhase's caller.
}

// =====================================================================================
// Human action / pass / disconnect-driven (DESIGN §4)
// =====================================================================================

/**
 * Apply a human action for a seat (DESIGN §4). Rejected (no-op + targeted actionRejected, R18)
 * unless the player phase is genuinely open for that seat. On a real change: mark acted, re-arm
 * AFK, recompute exhaustion, broadcast, then end-combat or re-latch.
 */
export function applyHumanAction(
  room: Room,
  io: RoomIO,
  seat: Seat,
  action: import("shared").WireAction,
): void {
  const session = room.session;
  const reject = () => io.send(seat, { type: "actionRejected", seatId: seat.seatId });

  if (!session || room.phase !== "combat" || room.coopPhase !== "player" || room.building) return reject();
  if (room.aiPlayerBusy || room.phaseTransitioning) return reject();
  if (session.pendingDefend) return reject();
  if (seat.ready || seat.exhausted) return reject();
  if ((action as { entityId?: EntityId }).entityId !== seat.heroEntityId) return reject();

  const { changed, events } = session.applyAction(action);
  if (!changed) return reject();

  seat.actedThisPhase = true;
  armAfk(room, io, seat);
  recomputeSeatExhausted(room, seat);
  broadcastState(room, io, events);
  broadcastCoopStatus(room, io);

  if (session.state.winner) {
    endCombat(room, io);
    return;
  }
  maybeEndPlayerPhase(room, io);
}

/** `pass`/`unpass` (DESIGN §4). `unpass` is only valid while the phase is open and not exhausted. */
export function setReady(room: Room, io: RoomIO, seat: Seat, ready: boolean): void {
  if (room.phase !== "combat" || room.coopPhase !== "player") {
    io.send(seat, { type: "actionRejected", seatId: seat.seatId });
    return;
  }
  if (!ready) {
    // unpass
    if (room.phaseTransitioning || room.aiPlayerBusy || seat.exhausted) {
      io.send(seat, { type: "actionRejected", seatId: seat.seatId });
      return;
    }
    seat.ready = false;
    armAfk(room, io, seat);
  } else {
    seat.ready = true;
    clearAfk(seat);
  }
  broadcastCoopStatus(room, io);
  maybeEndPlayerPhase(room, io);
}

/**
 * A seat just flipped human->bot mid-phase (post-burst disconnect, R9). Drive its single hero
 * once, mark it ready, then re-latch so the phase never silently stalls.
 */
export function onSeatBecameBotMidPhase(room: Room, io: RoomIO, seat: Seat): void {
  const session = room.session;
  if (!session) return;
  if (room.phase !== "combat" || room.coopPhase !== "player") return;
  if (room.phaseTransitioning) return;

  // If the seat that just flipped to bot was the LAST connected human, freeze instead of driving the
  // now-all-bot cascade unobserved. This is the load-bearing pause site: both the disconnect-grace
  // expiry and the explicit-leave path reach the bot conversion through here.
  if (!hasConnectedHuman(room)) {
    room.paused = true;
    broadcastCoopStatus(room, io);
    return;
  }

  rebuildHeroBrains(room);
  recomputeSeatExhausted(room, seat);

  // Only drive an open player phase (activeTeam red, not transitioning). If the burst is still
  // running, the seat will be swept by it; defer.
  if (session.state.activeTeam === "red" && !room.aiPlayerBusy && !seat.ready && !seat.exhausted) {
    room.aiPlayerBusy = true;
    session.runHero(seat.heroEntityId, humanHeroIds(room));
    driveAiSteps(room, io);
    room.aiPlayerBusy = false;
  }
  seat.ready = true;
  seat.actedThisPhase = true;
  broadcastCoopStatus(room, io);
  maybeEndPlayerPhase(room, io);
}

/**
 * Resume a combat frozen by the no-human pause (Phase 1), once a human (re)binds in connectSeat.
 * It CONTINUES the frozen sub-phase, never restarts a turn: an in-flight enemy sweep is continued via
 * resumeAfterDefend (driveAiSteps picks up the runner's remaining queue — re-calling startEnemyPhase
 * would re-sweep already-acted enemies), while a frozen player phase is re-opened fresh.
 */
export function resumeCombat(room: Room, io: RoomIO): void {
  if (!room.session || room.phase !== "combat" || !room.paused) return;
  if (!hasConnectedHuman(room)) return; // still nobody back; stay paused
  room.paused = false;
  if (room.coopPhase === "enemy") {
    resumeAfterDefend(room, io);
  } else {
    startPlayerPhase(room, io);
  }
}

// =====================================================================================
// Defend round (DESIGN §5 / R11)
// =====================================================================================

/**
 * Open (or extend into) a defend round from a runner `defendPrompt` step. Builds one target row
 * per (seat, entity); sends a `defendPrompt` to each human-connected target's socket. Bot /
 * disconnected targets stay `pending` and rely on the per-round timeout (R11).
 */
export function openDefendRound(
  room: Room,
  io: RoomIO,
  promptStep: Extract<AiStepResult, { type: "defendPrompt" }>,
): void {
  const targets: DefendTarget[] = [];
  for (const entityId of promptStep.targetIds) {
    const seat = room.seats.find((s) => s.heroEntityId === entityId);
    if (!seat) continue; // an enemy/non-seat target carries neutral defense by omission
    targets.push({
      promptId: `${promptStep.roundId}:${seat.seatId}`,
      entityId,
      seatId: seat.seatId,
      status: "pending",
      // Neutral / no-defense default = power 0. `defenseToMultiplier(0) === 1` (full damage); a
      // bot/disconnected/timed-out defender that never answers takes the full hit. (power 1.0 would
      // map to the "perfect" tier => 0 damage, i.e. invulnerable — the inverse of neutral. R11.)
      power: 0,
    });
  }

  const round: DefendRound = {
    generation: room.generation,
    attackerId: promptStep.attackerId,
    attackerPosition: promptStep.attackerPosition,
    aimDirection: promptStep.aimDirection,
    ability: promptStep.ability,
    targets,
    resolved: false,
    timeout: null,
  };
  room.defendRound = round;

  // Send the prompt to each human-connected target only; others rely on the timeout.
  for (const target of targets) {
    const seat = seatById(room, target.seatId);
    if (!seat) continue;
    if (seat.state === "human-connected") {
      io.send(seat, {
        type: "defendPrompt",
        promptId: target.promptId,
        seatId: target.seatId,
        targetEntityId: target.entityId,
        attackerId: round.attackerId,
        attackerPosition: round.attackerPosition,
        aimDirection: round.aimDirection,
        ability: round.ability,
      });
    }
  }
  broadcastCoopStatus(room, io);

  // If NO target is a human we can wait on (all bots/disconnected, or no seat targets at all),
  // resolve immediately with the neutral default instead of stalling combat for the full timeout —
  // there is no human to give the timing window to. Otherwise arm the timeout for the humans (R11).
  const anyHumanTarget = targets.some((t) => seatById(room, t.seatId)?.state === "human-connected");
  if (!anyHumanTarget) {
    maybeResolveDefendRound(room, io, true);
    return;
  }

  const gen = room.generation;
  round.timeout = setTimeout(() => {
    round.timeout = null;
    if (room.generation !== gen || room.defendRound !== round || round.resolved) return;
    // Timeout: any still-pending target keeps the neutral default (full damage) and we resolve.
    maybeResolveDefendRound(room, io, true);
  }, DEFEND_TIMEOUT_MS);

  maybeResolveDefendRound(room, io, false);
}

/**
 * Re-send the open defend round's still-pending prompts that belong to `seat` (reconnect/reclaim
 * into a live round, R11 / DESIGN §5: "on reclaim, only still-pending prompts are re-sent").
 * Generation-guarded so a stale round from a superseded generation is never resurfaced.
 */
export function resendPendingDefendPrompts(room: Room, io: RoomIO, seat: Seat): void {
  const round = room.defendRound;
  if (!round || round.resolved || round.generation !== room.generation) return;
  if (seat.state !== "human-connected") return;
  for (const target of round.targets) {
    if (target.seatId !== seat.seatId || target.status !== "pending") continue;
    io.send(seat, {
      type: "defendPrompt",
      promptId: target.promptId,
      seatId: target.seatId,
      targetEntityId: target.entityId,
      attackerId: round.attackerId,
      attackerPosition: round.attackerPosition,
      aimDirection: round.aimDirection,
      ability: round.ability,
    });
  }
}

/**
 * Record a `defendResult` for a target. Accepted only if the matching target is still `pending`
 * and the round/generation match; otherwise it is silently dropped (R11) and the seat is acked.
 */
export function submitDefend(
  room: Room,
  io: RoomIO,
  seat: Seat,
  promptId: string,
  power: number,
): void {
  const round = room.defendRound;
  if (!round || round.resolved || round.generation !== room.generation) {
    io.send(seat, { type: "actionRejected", seatId: seat.seatId });
    return;
  }
  const target = round.targets.find((t) => t.promptId === promptId && t.seatId === seat.seatId);
  if (!target || target.status !== "pending") {
    io.send(seat, { type: "actionRejected", seatId: seat.seatId });
    return;
  }
  target.status = "answered";
  target.power = power;
  broadcastCoopStatus(room, io);
  maybeResolveDefendRound(room, io, false);
}

/**
 * Resolve the open defend round exactly once (R11) when all targets are non-`pending` (answered)
 * or `force` (timeout) is set. Calls `session.resolveDefend(powerMap, roundId)` once, then resumes
 * the AI step loop. Generation-guarded (R17).
 */
export function maybeResolveDefendRound(room: Room, io: RoomIO, force: boolean): void {
  const round = room.defendRound;
  const session = room.session;
  if (!round || !session || round.resolved) return;
  if (round.generation !== room.generation) return;

  const anyPending = round.targets.some((t) => t.status === "pending");
  if (anyPending && !force) return;

  round.resolved = true;
  if (round.timeout) {
    clearTimeout(round.timeout);
    round.timeout = null;
  }

  // Build the per-entity raw power map. Pending (timed-out) targets keep the neutral default (0 =
  // full damage). Derive the roundId from the runner's pending round so the stale-round guard
  // (ai-turn-runner.resolveDefend) always receives a concrete id, even if `targets` is empty
  // (every prompted entity mapped to a non-seat). Falling back to undefined would skip that guard.
  const powerMap: Record<string, number> = {};
  for (const target of round.targets) powerMap[target.entityId] = target.power;

  const roundId =
    session.pendingDefendRoundId ?? round.targets[0]?.promptId.split(":")[0] ?? undefined;
  room.defendRound = null;

  const step = session.resolveDefend(powerMap, roundId);

  if (step.type === "events") {
    io.broadcast(room, {
      type: "state",
      state: step.serializedState as SerializedGameState,
      events: step.events,
    });
    // Broadcast the resolved state (damage) BEFORE coopStatus clears the pending-defend banner, to
    // match the state-before-coopStatus ordering used by every other transition.
    broadcastCoopStatus(room, io);
    if (step.won) {
      endCombat(room, io);
      return;
    }
    resumeAfterDefend(room, io);
  } else if (step.type === "defendPrompt") {
    broadcastCoopStatus(room, io);
    openDefendRound(room, io, step);
  } else {
    broadcastCoopStatus(room, io);
    resumeAfterDefend(room, io);
  }
}

/** After a defend resolves, continue the AI burst then re-evaluate the relevant phase latch. */
function resumeAfterDefend(room: Room, io: RoomIO): void {
  const session = room.session;
  if (!session) return;
  // A defend round can resolve via timeout after the last human left mid enemy-sweep; freeze the
  // in-flight sweep rather than finishing it unobserved. resumeCombat continues it on reconnect.
  if (!hasConnectedHuman(room)) {
    room.paused = true;
    broadcastCoopStatus(room, io);
    return;
  }
  const beforeTeam = session.state.activeTeam;
  driveAiSteps(room, io);
  if (room.coopPhase === "player") {
    maybeEndPlayerPhase(room, io);
  } else if (
    !session.state.winner &&
    !session.pendingDefend &&
    session.state.activeTeam === "red" &&
    beforeTeam === "blue"
  ) {
    // Enemy sweep finished and flipped back to red.
    room.phaseTransitioning = false;
    startPlayerPhase(room, io);
  }
}

/** Abort any open defend round (reset/debugWin, R17). */
export function abortDefendRound(room: Room): void {
  const round = room.defendRound;
  if (!round) return;
  if (round.timeout) clearTimeout(round.timeout);
  round.resolved = true;
  room.defendRound = null;
}

// =====================================================================================
// Movement vote (DESIGN §6 / R15)
// =====================================================================================

let voteSeq = 0;

/** Currently-connected human seat ids (the frozen electorate snapshot source). */
function connectedHumanSeatIds(room: Room): SeatId[] {
  return room.seats.filter((s) => s.state === "human-connected").map((s) => s.seatId);
}

function voteStatePayload(vote: MovementVote): VoteStatePayload {
  const votes: Partial<Record<SeatId, VoteChoice>> = {};
  for (const [seatId, choice] of vote.ballots) votes[seatId] = choice;
  return {
    proposalId: vote.proposalId,
    proposerSeatId: vote.proposerSeatId,
    target: vote.target,
    votes,
    electorate: vote.electorate,
    deadlineMs: vote.deadline,
  };
}

/**
 * Propose a move to an adjacent visible hex (DESIGN §6). Valid only in overworld with no open vote.
 * Single human resolves instantly; otherwise opens a vote (proposer auto-yes) with a ~15s deadline.
 */
export function proposeMove(room: Room, io: RoomIO, seat: Seat, target: HexCoord): void {
  const err = (code: import("shared").ErrorCode, message: string) =>
    io.send(seat, { type: "error", code, message, recoverable: true });

  if (room.phase !== "overworld") return err("BAD_PHASE", "Not in overworld");
  if (room.vote) return err("BAD_PHASE", "A vote is already open");
  if (seat.state !== "human-connected") return err("NOT_YOUR_SEAT", "Spectators cannot propose");
  if (!isAdjacent(room.hexMap.playerPos, target)) return err("INVALID_MOVE", "Target not adjacent");

  const visible = getVisibleHexes(room.hexMap);
  if (!(hexKey(target) in visible)) return err("INVALID_MOVE", "Target not visible");

  const electorate = connectedHumanSeatIds(room);
  const proposalId = `v${++voteSeq}`;
  const ballots = new Map<SeatId, VoteChoice>([[seat.seatId, "yes"]]);

  if (electorate.length <= 1) {
    // Single human -> instant resolve.
    io.broadcast(room, { type: "voteState", vote: null });
    finalizeMove(room, io, proposalId, target, true);
    return;
  }

  const vote: MovementVote = {
    proposalId,
    proposerSeatId: seat.seatId,
    target,
    electorate,
    ballots,
    deadline: Date.now() + VOTE_TIMEOUT_MS,
    timer: null,
  };
  room.vote = vote;

  const gen = room.generation;
  vote.timer = setTimeout(() => {
    vote.timer = null;
    if (room.generation !== gen || room.vote !== vote) return;
    resolveMovementVote(room, io, true);
  }, VOTE_TIMEOUT_MS);

  io.broadcast(room, { type: "voteState", vote: voteStatePayload(vote) });
  resolveMovementVote(room, io, false);
}

/** Cast a ballot into the open vote (only electorate members count, R15). */
export function castVote(
  room: Room,
  io: RoomIO,
  seat: Seat,
  proposalId: string,
  choice: VoteChoice,
): void {
  const vote = room.vote;
  if (!vote || vote.proposalId !== proposalId) {
    io.send(seat, { type: "error", code: "NO_OPEN_PROPOSAL", message: "No matching open vote", recoverable: true });
    return;
  }
  if (!vote.electorate.includes(seat.seatId)) return; // not in the frozen electorate
  vote.ballots.set(seat.seatId, choice);
  io.broadcast(room, { type: "voteState", vote: voteStatePayload(vote) });
  resolveMovementVote(room, io, false);
}

/**
 * Resolve the open vote over the frozen electorate (R15). When decided: broadcast `moveResolved`,
 * clear the vote, and on accept either move the party (visited) or enter combat (unexplored).
 * Generation-guarded (R17).
 */
export function resolveMovementVote(room: Room, io: RoomIO, deadlinePassed: boolean): void {
  const vote = room.vote;
  if (!vote) return;
  if (room.phase !== "overworld") return;

  const resolution = resolveVote(vote.ballots, vote.electorate, { deadlinePassed });
  if (!resolution.decided) return;

  if (vote.timer) {
    clearTimeout(vote.timer);
    vote.timer = null;
  }
  const { target, proposalId } = vote;
  room.vote = null;
  io.broadcast(room, { type: "voteState", vote: null });

  if (resolution.accepted) {
    finalizeMove(room, io, proposalId, target, true);
  } else {
    io.broadcast(room, { type: "moveResolved", proposalId, accepted: false, target });
  }
}

/**
 * Apply an accepted move. Already-cleared target -> pure party move (durable party_q/r written
 * synchronously before any subsequent message, R35). Unexplored target -> R7 atomic combat entry.
 */
function finalizeMove(room: Room, io: RoomIO, proposalId: string, target: HexCoord, accepted: boolean): void {
  io.broadcast(room, { type: "moveResolved", proposalId, accepted, target });
  if (!accepted) return;

  const tk = hexKey(target);
  if (room.visitedThisRun.has(tk)) {
    // Pure party move onto an already-cleared hex (write point 5, R35): durable synchronously.
    room.hexMap = { ...room.hexMap, playerPos: target };
    updateRunPartyPos(room.runId, target);
    broadcastHexMapState(room, io);
  } else {
    void beginCombatEntry(room, io, target);
  }
}

/** Cancel an open vote (proposer disconnect, R15). */
export function cancelVote(room: Room, io: RoomIO): void {
  const vote = room.vote;
  if (!vote) return;
  if (vote.timer) clearTimeout(vote.timer);
  const { proposalId, target } = vote;
  room.vote = null;
  io.broadcast(room, { type: "voteState", vote: null });
  io.broadcast(room, { type: "moveResolved", proposalId, accepted: false, target });
}

// =====================================================================================
// Combat entry (DESIGN §6/§7 R7 atomic) + combat end
// =====================================================================================

function encounterTypeFor(room: Room, target: HexCoord): EncounterType {
  return (
    getHexIcon(target, room.hexMap.icons) ??
    (isDecorationHex(target) ? "dense-wilderness" : "wilderness")
  );
}

/**
 * R7 ATOMIC combat entry. Synchronously (pre-await): set phase=combat, building=true, vote=null,
 * pendingHex=target, bump generation, snapshot all seat loadouts. After the await, re-validate the
 * room still wants this build (generation unchanged + not disposed/superseded) before assigning the
 * session and starting the player phase. No durable write here — the departure tile is already
 * durable (PERSISTENCE §8 / R35).
 */
export async function beginCombatEntry(room: Room, io: RoomIO, target: HexCoord): Promise<void> {
  // --- synchronous, pre-await ---
  room.phase = "combat";
  setRunPhase(room.runId, "combat"); // persist the lifecycle SSOT (a crash mid-combat resumes at overworld)
  room.building = true;
  room.vote = null;
  room.pendingHex = target;
  room.coopPhase = "player";
  room.phaseTransitioning = false;
  room.aiPlayerBusy = false;
  room.paused = false;
  room.generation++;
  const gen = room.generation;
  const specs = room.seats.map(seatBuildSpec);
  const hexType = encounterTypeFor(room, target);

  broadcastRoomState(room, io);

  let session: EncounterSession;
  try {
    session = await EncounterSession.createEncounter({
      seats: specs,
      hexType,
      hexCoord: target,
      runId: room.runId,
      dimensionId: room.dimensionId,
    });
  } catch (e) {
    console.error(`[room] encounter build failed: ${(e as Error).message}`);
    if (room.generation === gen) {
      room.building = false;
      room.phase = "overworld";
      setRunPhase(room.runId, "overworld"); // build failed -> stay in overworld (durable SSOT)
      room.pendingHex = null;
      broadcastRoomState(room, io);
    }
    return;
  }

  // --- post-await re-validation (R7) ---
  if (room.generation !== gen || room.phase !== "combat" || room.disposed) {
    // Superseded (reset/another build) or the room was reaped/disposed while we awaited — discard,
    // so we never assign a session / re-arm timers on a zombie room no longer in the registry.
    return;
  }

  room.session = session;
  room.building = false;

  io.broadcast(room, { type: "combatStart", encounterHex: target });
  broadcastState(room, io, []);
  broadcastCoopStatus(room, io);

  startPlayerPhase(room, io);
}

/**
 * End the current encounter (DESIGN §6 combat end). On a player win + pendingHex: exploreHex
 * (durable cleared + party_q/r, atomic) -> overworld. Party wipe / loss: resetToOrigin (new run).
 * Bumps generation and tears down the session.
 */
export function endCombat(room: Room, io: RoomIO): void {
  const session = room.session;
  if (!session) return;
  const won = session.state.winner === "red";

  // Stop any open defend round; the encounter is over.
  abortDefendRound(room);
  for (const seat of room.seats) clearAfk(seat);

  io.broadcast(room, { type: "combatEnd", won });

  room.generation++;
  room.session = null;
  room.phaseTransitioning = false;
  room.aiPlayerBusy = false;
  room.paused = false;
  room.coopPhase = "player";

  if (won && room.pendingHex) {
    const firstEver = exploreHex(room, room.pendingHex);
    const discovered = room.pendingHex;
    room.pendingHex = null;
    room.phase = "overworld";
    setRunPhase(room.runId, "overworld"); // back to overworld after a win (durable SSOT)
    broadcastRoomState(room, io);
    broadcastHexMapState(room, io);
    // First-ever discovery in this dimension is a community KEY MOMENT — celebrate it.
    if (firstEver) io.broadcast(room, { type: "hexDiscovered", coord: discovered });
  } else {
    // Party wipe -> a HELD Game Over end state (the previously-dead `gameover` RoomPhase, now used).
    // Finalize the run immediately (locked decision): a disconnect from Game Over lands on HOME and a
    // crash can never resurrect a wiped party. The in-memory room stays live at `gameover` so any
    // player can Play Again (-> a fresh active run via resetToOrigin) or Return to Home (-> leave).
    room.pendingHex = null;
    room.phase = "gameover";
    finalizeRun(room.runId, "defeat"); // the single run-end owner (also persists phase='gameover')
    broadcastRoomState(room, io);
    io.broadcast(room, { type: "gameOver", outcome: "defeat" });
  }
}

/**
 * Mark a freshly-won hex discovered (GLOBAL community map) + cleared-this-run and advance the party
 * onto it (write point 4, R13.2): durable discovery + run-cleared + party_q/r in the same DB pass,
 * atomic with the in-memory advance. Returns true iff this was the first-ever discovery (KEY MOMENT).
 */
function exploreHex(room: Room, target: HexCoord): boolean {
  const tk = hexKey(target);
  room.hexMap = {
    ...room.hexMap,
    playerPos: target,
    hexes: { ...room.hexMap.hexes, [tk]: "explored" as const },
  };
  room.visitedThisRun.add(tk);
  const icon = getHexIcon(target, room.hexMap.icons);
  // Write point 4 (R13.2): global discovery + icon + this-run cleared + party_q/r in one transaction.
  return commitExplore(room.dimensionId, room.runId, target, icon ?? null);
}

/**
 * Run defeat -> swap to a fresh run (write point 9 / R13.5 / R30): mark the old run inactive
 * (left_at-stamps all seats), start a new run at ORIGIN, re-key the registry, reset overworld
 * state, and persist seats with fresh starter inventory.
 */
export function resetToOrigin(room: Room, io: RoomIO, outcome: "defeat" | "abandoned" = "defeat"): void {
  const oldRunId = room.runId;
  finalizeRun(oldRunId, outcome); // single run-end owner (no-op if already final, e.g. play-again after a wipe)
  const newRunId = startNewRun(room.dimensionId, hostClientId(room), room.capacity);
  setRunPhase(newRunId, "overworld"); // a play-again / abandon run resumes at the overworld, never a lobby
  // Discovery is GLOBAL per dimension and persists across runs — do NOT re-seed it. The fresh run
  // only re-clears its own origin; the community map (loadDiscoveredHexes) carries forward.
  markRunCleared(newRunId, ORIGIN);

  room.runId = newRunId;
  rooms.rekeyRun(oldRunId, room);

  const originKey = hexKey(ORIGIN);
  const hexes = loadDiscoveredHexes(room.dimensionId);
  hexes[originKey] = "explored";
  const icons: Record<string, HexIconType> = { [originKey]: "town" };
  for (const [key, icon] of Object.entries(loadDiscoveredHexIcons(room.dimensionId))) icons[key] = icon as HexIconType;
  room.hexMap = { playerPos: ORIGIN, hexes, icons };
  room.visitedThisRun = new Set([originKey]);
  room.phase = "overworld";
  room.pendingHex = null;

  // Persist seats + fresh starter inventory for the new run.
  for (const seat of room.seats) {
    seat.inventory = buildDefaultInventory(room.dimensionId);
    seat.animSet = getAnimSet(seat.inventory.equipped);
    persistSeat(room, seat);
  }

  broadcastRoomState(room, io);
  broadcastHexMapState(room, io);
}

function hostClientId(room: Room): string | null {
  if (!room.hostSeatId) return null;
  const seat = seatById(room, room.hostSeatId);
  return seat?.clientId ?? null;
}

/** Upsert a seat's durable row + inventory (used at run swap and bind). */
function persistSeat(room: Room, seat: Seat): void {
  upsertRunSeat(room.runId, seat.seatIndex, {
    clientId: seat.clientId,
    displayName: seat.displayName,
    controllerKind: seat.state === "bot" ? "bot" : seat.clientId ? "human" : "bot",
    tokenSalt: seat.tokenSalt,
  });
  // Inventory persistence is handled by the equip/bind write points (index.ts); for run swap we
  // refresh starter inventory durably too (synchronous, R35).
  saveSeatInventory(room.runId, seat.seatIndex, seat.inventory);
}

// =====================================================================================
// Identity / lifecycle (DESIGN §7 / R14 / R31)
// =====================================================================================

/**
 * Migrate the host (R14): runs on every human disconnect regardless of phase. Host moves to the
 * lowest-index connected human, or null if none. Returns true if the host changed.
 */
export function migrateHost(room: Room): boolean {
  const prev = room.hostSeatId;
  const lowest = room.seats.find((s) => s.state === "human-connected");
  room.hostSeatId = lowest?.seatId ?? null;
  if (room.hostSeatId !== prev) {
    setRunHostSafe(room);
    return true;
  }
  return false;
}

function setRunHostSafe(room: Room): void {
  try {
    setRunHost(room.runId, hostClientId(room));
  } catch (e) {
    // Host is re-derived on resume (R14), so this write isn't load-bearing — but surface it.
    console.error(`[room] host persistence failed: ${(e as Error).message}`);
  }
}

/**
 * Arm the 3s disconnect grace (R28). On expiry without reconnect: flip the seat human->bot, install
 * a brain, and (if mid open player phase) drive it once + ready via onSeatBecameBotMidPhase (R9).
 */
export function armDisconnectGrace(room: Room, io: RoomIO, seat: Seat): void {
  if (seat.disconnectGraceTimer) clearTimeout(seat.disconnectGraceTimer);
  const gen = room.generation;
  seat.disconnectGraceTimer = setTimeout(() => {
    seat.disconnectGraceTimer = null;
    if (seat.state !== "human-disconnected") return;
    // Keep it reclaim-only in roster terms, but bot-drive it for liveness (R9/R31).
    seat.brain = sovereignFor(seat);
    if (room.phase === "combat" && room.coopPhase === "player" && room.generation === gen) {
      onSeatBecameBotMidPhase(room, io, seat);
    } else {
      broadcastCoopStatus(room, io);
    }
  }, DISCONNECT_GRACE_MS);
}

/**
 * Handle a seat's socket closing (DESIGN §7). Marks the seat human-disconnected, migrates host,
 * cancels its open vote if it was the proposer, and arms grace / reap. The defend round leaves the
 * seat's prompts pending (the round timeout covers it, R11).
 */
export function onSeatDisconnected(
  room: Room,
  io: RoomIO,
  seat: Seat,
  onReap: (room: Room) => void,
): void {
  clearAfk(seat);
  seat.socket = null;
  seat.state = "human-disconnected";

  if (room.vote && room.vote.proposerSeatId === seat.seatId) cancelVote(room, io);

  migrateHost(room);
  broadcastRoomState(room, io);
  if (room.phase === "combat") broadcastCoopStatus(room, io);

  if (room.phase === "combat" || room.phase === "overworld") {
    armDisconnectGrace(room, io, seat);
  }

  if (room.seats.every((s) => s.socket === null)) armReap(room, onReap);
}

/**
 * Explicit voluntary LEAVE of a started game (overworld/combat/gameover): the seat becomes a
 * PERMANENT bot and the party plays on — distinct from the reclaimable `onSeatDisconnected` (a
 * transport drop). Ordering is load-bearing (per review):
 *  - memory first: drop the socket, flip `state="bot"` (so migrateHost excludes the leaver), null the
 *    identity, install a brain;
 *  - durable: `upsertRunSeat(controllerKind:"bot", clientId:null)` — IDENTICAL to start-game bot-fill,
 *    NOT `leaveRunSeat`. The null client_id frees the UNIQUE-live index for the leaver's next match;
 *    a left `human`+clientId row would instead be rehydrated by crash-recovery as a reclaimable human.
 *  - then migrate host, drive the now-bot seat once if mid player phase (pause-aware), broadcast, and
 *    arm the (inactivating) reap if no humans remain.
 */
export function leaveSeatPermanently(
  room: Room,
  io: RoomIO,
  seat: Seat,
  onReap: (room: Room) => void,
): void {
  clearAfk(seat);
  if (seat.disconnectGraceTimer) {
    clearTimeout(seat.disconnectGraceTimer);
    seat.disconnectGraceTimer = null;
  }
  if (room.vote && room.vote.proposerSeatId === seat.seatId) cancelVote(room, io);

  seat.socket = null;
  seat.state = "bot";
  seat.clientId = null;
  seat.tokenSalt = null;
  seat.brain = sovereignFor(seat);

  upsertRunSeat(room.runId, seat.seatIndex, {
    clientId: null,
    displayName: seat.displayName,
    controllerKind: "bot",
    tokenSalt: null,
  });

  migrateHost(room);

  // Mid open player phase: drive the freshly-botted seat once and re-latch. onSeatBecameBotMidPhase is
  // pause-aware — if the leaver was the LAST human it freezes combat instead of cascading (Phase 1).
  if (room.phase === "combat" && room.coopPhase === "player") {
    onSeatBecameBotMidPhase(room, io, seat);
  }

  broadcastRoomState(room, io);
  if (room.phase === "combat") broadcastCoopStatus(room, io);

  if (room.seats.every((s) => s.socket === null)) armReap(room, onReap);
}

/**
 * Bind a connecting socket to a seat (connect / reclaim / resume). Drops the bot brain (R12/R31),
 * marks human-connected, cancels grace + reap, applies the R10 ready/exhausted reclaim rules when
 * landing in an open player phase, and re-derives host (R14).
 */
export function connectSeat(
  room: Room,
  io: RoomIO,
  seat: Seat,
  socket: import("bun").ServerWebSocket<import("./room.js").SocketData>,
  clientId: import("shared").ClientId,
): void {
  const session = room.session;
  const wasBotDriven = isBotSeat(seat);

  if (seat.disconnectGraceTimer) {
    clearTimeout(seat.disconnectGraceTimer);
    seat.disconnectGraceTimer = null;
  }
  clearReap(room);

  // Abort the reclaimed entity's queued bot actions whenever it was bot-driven and a session exists
  // (R12). Gating on aiPlayerBusy missed the case where the bot queued actions outside the burst
  // window (e.g. between phases), so leftover bot actions could still fire on the next player phase.
  if (session && wasBotDriven) session.abortAi(seat.heroEntityId);

  seat.socket = socket;
  seat.clientId = clientId;
  seat.state = "human-connected";
  seat.brain = null;

  // R10 reclaim ready/exhausted rules (only meaningful in combat).
  if (session && room.phase === "combat") {
    recomputeSeatExhausted(room, seat);
    const phaseOpen = room.coopPhase === "player" && session.state.activeTeam === "red" && !room.phaseTransitioning;
    if (phaseOpen && !seat.actedThisPhase && !seat.exhausted) {
      seat.ready = false; // the human inherits an unspent turn
      armAfk(room, io, seat);
    }
    // else: the bot already consumed the turn (actedThisPhase) or exhausted/closed -> spectate.
  }

  rebuildHeroBrains(room);

  // Re-derive host: first connected human becomes host if there is none (R14 stays-migrated).
  if (room.hostSeatId === null) {
    room.hostSeatId = room.seats.find((s) => s.state === "human-connected")?.seatId ?? null;
    setRunHostSafe(room);
  }

  // If combat was frozen waiting for a human, resume it now that this human has (re)bound (Phase 1).
  if (room.phase === "combat" && room.paused) resumeCombat(room, io);
}

// =====================================================================================
// Reconstruction (PERSISTENCE resume) — overworld phase from durable rows (R30/R31)
// =====================================================================================

/**
 * Reconstruct a Room at the OVERWORLD phase from durable rows (PERSISTENCE resume algorithm).
 * Synchronous (no await) so two near-simultaneous reconnects converge on one Room via the
 * check-or-throw registry (R30). Human seats start `human-disconnected` + bot-driven from t0 for
 * liveness (R31); bot seats start `bot`. A fresh code is assigned (R36) and the reap timer armed.
 *
 * Returns the existing Room if one is already registered for the run (lost the race, R30).
 */
export function reconstructRoomForRun(
  runId: number,
  onReap: (room: Room) => void,
): Room | null {
  const existing = rooms.getByRun(runId);
  if (existing) return existing;

  const runRow = loadRun(runId);
  if (!runRow || !runRow.active) return null;

  const dimensionId = runRow.dimension_id;
  const capacity = runRow.capacity;

  // Hex map: visibility from the GLOBAL community discovery set (per dimension), icons from
  // persisted + derived, cleared set is the PER-RUN durable visitedThisRun (R13.2 — NEVER rebuilt
  // from visibility).
  const hexes = loadDiscoveredHexes(dimensionId);
  const originKey = hexKey(ORIGIN);
  if (!(originKey in hexes)) hexes[originKey] = "explored";
  const iconRows = loadDiscoveredHexIcons(dimensionId);
  const icons: Record<string, HexIconType> = { [originKey]: "town" };
  for (const [key, icon] of Object.entries(iconRows)) icons[key] = icon as HexIconType;
  const playerPos: HexCoord = { q: runRow.party_q, r: runRow.party_r };
  const visitedThisRun = loadRunCleared(runId);
  // Empty only for a corrupt row: every run durably clears ORIGIN at creation/reset, so this
  // fallback re-adds ORIGIN alone and never leaks another run's cleared hexes (no cross-run skip).
  if (visitedThisRun.size === 0) visitedThisRun.add(originKey);

  const code = freshRoomCode((c) => rooms.isTaken(c));
  if (!code) return null;

  const seatRows = loadRunSeats(runId);
  const seats: Seat[] = [];
  for (let i = 0; i < capacity; i++) {
    const seatId = seatIdForIndex(i);
    const row = seatRows.find((r) => r.seat_index === i);
    const isHuman = row?.controller_kind === "human" && !!row.client_id;
    // Durable rows rehydrate the bag (R13.3); a seat with no row falls back to a starter loadout.
    const inventory = row ? loadSeatInventory(runId, i, dimensionId) : buildDefaultInventory(dimensionId);
    const seat: Seat = {
      seatId,
      seatIndex: i,
      heroEntityId: heroEntityIdFor(seatId),
      // Human seats resume disconnected (reclaim-only, R21); they are bot-driven for liveness (R31).
      state: isHuman ? "human-disconnected" : "bot",
      socket: null,
      clientId: row?.client_id ?? null,
      tokenSalt: row?.token_salt ?? null,
      brain: null, // sovereignFor installed below for liveness
      inventory,
      animSet: getAnimSet(inventory.equipped),
      displayName: row?.display_name || `Player ${i + 1}`,
      ready: false,
      exhausted: false,
      actedThisPhase: false,
      disconnectGraceTimer: null,
      afkTimer: null,
    };
    seat.brain = sovereignFor(seat); // R31: bot-driven from t0
    seats.push(seat);
  }

  const room: Room = {
    code,
    hostSeatId: null, // re-derived on first bind (R14)
    phase: "overworld",
    building: false,
    phaseTransitioning: false,
    generation: 0,
    coopPhase: "player",
    aiPlayerBusy: false,
    paused: false,
    dimensionId,
    runId,
    hexMap: { playerPos, hexes, icons },
    visitedThisRun,
    pendingHex: null,
    capacity,
    seats,
    session: null,
    defendRound: null,
    vote: null,
    reapTimer: null,
    lastActivityMs: Date.now(),
  };

  try {
    rooms.registerRoomForRun(runId, room); // check-or-throw (R30)
  } catch {
    return rooms.getByRun(runId); // lost the race; reuse the winner
  }

  // The room is rebuilt at 'overworld' (combat is volatile); converge the durable SSOT if it was 'combat'.
  if (runRow.phase !== "overworld") setRunPhase(runId, "overworld");

  armReap(room, onReap); // R31: a reconstructed room nobody reconnects to is reaped
  return room;
}

/**
 * Boot crash-recovery: rebuild every run a process death left active=1 — server-side, not lazily by an
 * arbitrary client's hello. The durable run.phase SSOT decides: a run the crash caught in the LOBBY is
 * NOT resurrected as a game (it is abandoned so reconnects route HOME); an overworld/combat run is rebuilt
 * (combat is volatile — it resumes at overworld). Each reconstructed room arms its own (inactivating)
 * `onReap`, so one nobody reconnects to within the window is finalized.
 */
export function recoverActiveRuns(onReap: (room: Room) => void): void {
  for (const runId of loadActiveRunIds()) {
    const run = loadRun(runId);
    if (!run) continue;
    if (run.phase === "lobby") {
      finalizeRun(runId, "abandoned");
      continue;
    }
    reconstructRoomForRun(runId, onReap);
  }
}

/** Dispose passthrough (R19): the WS layer calls this; durable rows are not touched (R13.1). */
export { disposeRoom } from "./room.js";
