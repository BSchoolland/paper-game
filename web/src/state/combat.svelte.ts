import type { CoopStatusPayload, EntityId, GameEvent, GameState, InventoryState, ServerMessage } from "shared";
import { deserializeGameState } from "shared";
import { room } from "./room.svelte.js";
import { clientWireLog } from "../net/wire-log.js";
import { DisplayQueue } from "./display-queue.js";

type DefendPromptMsg = Extract<ServerMessage, { type: "defendPrompt" }>;

/**
 * Combat truth vs presentation (the prototype's proven model, rune-reactive). `truth` is always
 * the latest wire snapshot; `display` is what the board renders, advanced through a per-batch
 * event queue (DisplayQueue) that waits for the renderer's animations between drains. Every
 * snapshot — including empty-events re-syncs — rides the queue, so nothing is dropped or
 * reordered relative to wire order.
 */
interface CombatStore {
  truth: GameState | null;
  display: GameState | null;
  coop: CoopStatusPayload | null;
  inventory: InventoryState | null;
  /** The open defend prompt for OUR seat (server enforces the deadline). */
  defend: DefendPromptMsg | null;
}

export const combat = $state<CombatStore>({ truth: null, display: null, coop: null, inventory: null, defend: null });

let animatingCheck: (() => boolean) | null = null;
let eventListeners: ((events: readonly GameEvent[]) => void)[] = [];
let selfActedListeners: (() => void)[] = [];
let rejectedListeners: (() => void)[] = [];
let phaseListeners: ((phase: CoopStatusPayload["phase"], prev: CoopStatusPayload["phase"] | null) => void)[] = [];

const displayQueue = new DisplayQueue({
  commitBatch(state, events) {
    combat.display = state;
    for (const l of eventListeners) l(events);
  },
  commitCoop,
  waitForAnimations,
  now: () => performance.now(),
  schedule: (cb, ms) => {
    setTimeout(cb, ms);
  },
});

export function applyCombatSnapshot(serialized: Parameters<typeof deserializeGameState>[0], events: readonly GameEvent[]): void {
  const next = deserializeGameState(serialized);

  // actionCount monotonicity assertion: with per-connection seq verified at the socket, a
  // regression here means the server emitted out of order — a protocol violation, not a state
  // to quietly absorb. Record + warn always; throw in dev; drop (never move display backwards).
  if (combat.display && next.actionCount < combat.display.actionCount) {
    clientWireLog.note("dropped-stale", { actionCount: next.actionCount, queueDepth: displayQueue.depth() });
    console.warn("[combat] dropped stale state", { incoming: next.actionCount, display: combat.display.actionCount });
    if (import.meta.env.DEV) {
      throw new Error(`Stale combat state: actionCount ${next.actionCount} < displayed ${combat.display.actionCount}`);
    }
    return;
  }

  if (snapshotIsMyAction(combat.display, next, events)) {
    for (const l of selfActedListeners) l();
  }

  combat.truth = next;

  if (!combat.display) {
    combat.display = next;
    return;
  }

  // An empty-events re-sync (reconnect snapshot / server-side snap) rides the same queue as
  // everything else: with animations in flight it lands AFTER them instead of wiping them —
  // queued batches and coop flips are never dropped. With an idle queue it commits immediately.
  if (events.length === 0 && !displayQueue.isIdle()) {
    clientWireLog.note("empty-snap-queued", { actionCount: next.actionCount, queueDepth: displayQueue.depth() });
  }
  displayQueue.enqueueBatch(next, events);
}

/** Pause the display drain (not the wire) until `ms` from now — lets a phase slate land first. */
export function holdDisplayFor(ms: number): void {
  displayQueue.holdFor(ms);
}

/** Register the single pre-batch hook. Returns an unregister. */
export function setBatchGate(gate: ((state: GameState, events: readonly GameEvent[]) => Promise<void>) | null): void {
  displayQueue.setBatchGate(gate);
}

/**
 * Apply a coopStatus payload in display-time: while batches are draining it queues behind
 * them (wire order preserved), otherwise it commits immediately. Dispatch calls this instead
 * of assigning `combat.coop` directly.
 */
export function applyCoopStatus(coop: CoopStatusPayload): void {
  displayQueue.enqueueCoop(coop);
}

function commitCoop(coop: CoopStatusPayload): void {
  const prev = combat.coop?.phase ?? null;
  combat.coop = coop;
  if (coop.phase !== prev) {
    for (const l of phaseListeners) l(coop.phase, prev);
  }
}

/** Fired whenever the coop phase actually changes (including the first status of a combat). */
export function onCoopPhaseChange(listener: (phase: CoopStatusPayload["phase"], prev: CoopStatusPayload["phase"] | null) => void): () => void {
  phaseListeners.push(listener);
  return () => {
    phaseListeners = phaseListeners.filter((l) => l !== listener);
  };
}

function waitForAnimations(cb: () => void): void {
  const check = () => {
    if (animatingCheck?.()) requestAnimationFrame(check);
    else cb();
  };
  requestAnimationFrame(check);
}

/**
 * True iff `next` reflects MY hero acting (vs a peer's snapshot). Zone placement emits no
 * actor-keyed event, so a drop in my hero's spendable energy also counts — only the actor
 * spends energy during the open player phase.
 */
function snapshotIsMyAction(prev: GameState | null, next: GameState, events: readonly GameEvent[]): boolean {
  const myHeroId = room.state?.seats.find((s) => s.seatId === room.state?.yourSeatId)?.heroEntityId;
  if (!myHeroId) return false;
  for (const ev of events) {
    const actor: EntityId | undefined = ev.type === "attack" ? ev.attackerId : (ev as { entityId?: EntityId }).entityId;
    if (actor === myHeroId) return true;
  }
  const before = prev?.entities.get(myHeroId);
  const after = next.entities.get(myHeroId);
  if (!before || !after) return false;
  return after.energy.red + after.energy.blue < before.energy.red + before.energy.blue;
}

/** The board renderer registers its "still animating?" probe here. */
export function setAnimatingCheck(fn: (() => boolean) | null): void {
  animatingCheck = fn;
}

/** Renderer subscription: each drained batch's events, in order, at animation pace. */
export function onCombatEvents(listener: (events: readonly GameEvent[]) => void): () => void {
  eventListeners.push(listener);
  return () => {
    eventListeners = eventListeners.filter((l) => l !== listener);
  };
}

/** Fired when a snapshot reflects MY hero acting — releases the local submit lock. */
export function onSelfActed(listener: () => void): () => void {
  selfActedListeners.push(listener);
  return () => {
    selfActedListeners = selfActedListeners.filter((l) => l !== listener);
  };
}

/** Fired on `actionRejected` for MY seat — releases the local submit lock only. */
export function onActionRejected(listener: () => void): () => void {
  rejectedListeners.push(listener);
  return () => {
    rejectedListeners = rejectedListeners.filter((l) => l !== listener);
  };
}

export function notifyActionRejected(): void {
  for (const l of rejectedListeners) l();
}

/** True once every received batch has finished animating: queue empty and not mid-drain. */
export function combatIsIdle(): boolean {
  return displayQueue.isIdle();
}

/** Leaving the combat screen: next entry re-seeds display from the first snapshot. */
export function resetCombatDisplay(): void {
  combat.display = null;
  combat.truth = null;
  displayQueue.reset();
}

export function resetCombat(): void {
  resetCombatDisplay();
  combat.coop = null;
  combat.inventory = null;
  combat.defend = null;
}
