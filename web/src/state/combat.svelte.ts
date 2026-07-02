import type { CoopStatusPayload, EntityId, GameEvent, GameState, InventoryState, ServerMessage } from "shared";
import { deserializeGameState } from "shared";
import { room } from "./room.svelte.js";

type DefendPromptMsg = Extract<ServerMessage, { type: "defendPrompt" }>;

/**
 * Combat truth vs presentation (the prototype's proven model, rune-reactive). `truth` is always
 * the latest wire snapshot; `display` is what the board renders, advanced through a per-batch
 * event queue that waits for the renderer's animations between drains. An empty-events snapshot
 * wipes the queue and snaps (the server re-syncing us, e.g. on reconnect).
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

interface QueuedUpdate {
  state: GameState;
  events: readonly GameEvent[];
}

let queue: QueuedUpdate[] = [];
let draining = false;
let animatingCheck: (() => boolean) | null = null;
let eventListeners: ((events: readonly GameEvent[]) => void)[] = [];
let selfActedListeners: (() => void)[] = [];
let rejectedListeners: (() => void)[] = [];

export function applyCombatSnapshot(serialized: Parameters<typeof deserializeGameState>[0], events: readonly GameEvent[]): void {
  const next = deserializeGameState(serialized);

  // Out-of-order / duplicate guard: never move display backwards.
  if (combat.display && next.actionCount < combat.display.actionCount) {
    console.warn("[combat] dropped stale state", { incoming: next.actionCount, display: combat.display.actionCount });
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

  if (events.length === 0) {
    queue = [];
    combat.display = next;
    return;
  }

  queue.push({ state: next, events });
  drain();
}

function drain(): void {
  if (draining) return;
  draining = true;
  processNext();
}

function processNext(): void {
  const next = queue.shift();
  if (!next) {
    draining = false;
    return;
  }
  combat.display = next.state;
  for (const l of eventListeners) l(next.events);
  waitForAnimations(processNext);
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
  return queue.length === 0 && !draining;
}

/** Leaving the combat screen: next entry re-seeds display from the first snapshot. */
export function resetCombatDisplay(): void {
  combat.display = null;
  combat.truth = null;
  queue = [];
  draining = false;
}

export function resetCombat(): void {
  resetCombatDisplay();
  combat.coop = null;
  combat.inventory = null;
  combat.defend = null;
}
