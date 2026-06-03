import type { EntityId, GameState, GameEvent, PlayerAction, WireAction } from "shared";
import { deserializeGameState } from "shared/src/core/serialization.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "./seat-context.js";
import type { GameStore } from "./game-store.js";

type Listener = () => void;
type EventListener = (events: readonly GameEvent[]) => void;
type RejectListener = () => void;

interface QueuedUpdate {
  state: GameState;
  events: readonly GameEvent[];
}

/**
 * The networked combat store. Holds the authoritative `state` snapshot (latest from the wire)
 * and a `displayState` the renderer animates toward via a per-event queue. Snapshots arriving
 * behind the current display are ignored (monotonic `actionCount` guard); a per-seat
 * `actionRejected` only unlocks the local submit lock — it never flushes the queue or snaps.
 */
export class CombatStore implements GameStore {
  private state: GameState | null = null;
  private displayState: GameState | null = null;
  private queue: QueuedUpdate[] = [];
  private draining = false;
  private listeners: Listener[] = [];
  private eventListeners: EventListener[] = [];
  private rejectListeners: RejectListener[] = [];
  private selfActedListeners: Listener[] = [];
  private _animatingCheck: (() => boolean) | null = null;
  private _onStateReady: (() => void) | null = null;

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
  ) {
    conn.on("state", (msg) => this.handleState(msg.state, msg.events));
    conn.on("actionRejected", (msg) => {
      if (msg.seatId === this.seat.mySeatId) this.notifyRejected();
    });
  }

  private handleState(serialized: Parameters<typeof deserializeGameState>[0], events: readonly GameEvent[]) {
    const newState = deserializeGameState(serialized);

    // Ignore any snapshot older than what we already display (out-of-order / dup).
    if (this.displayState && newState.actionCount < this.displayState.actionCount) return;

    if (this.snapshotIsMyAction(this.displayState, newState, events)) this.notifySelfActed();

    this.state = newState;

    if (!this.displayState) {
      this.displayState = newState;
      if (this._onStateReady) {
        this._onStateReady();
        this._onStateReady = null;
      }
      this.notify();
      return;
    }

    if (events.length === 0) {
      this.queue.length = 0;
      this.displayState = newState;
      this.notify();
      return;
    }

    this.queue.push({ state: newState, events });
    this.drain();
  }

  setAnimatingCheck(fn: () => boolean) {
    this._animatingCheck = fn;
  }

  private drain() {
    if (this.draining) return;
    this.draining = true;
    this.processNext();
  }

  private processNext() {
    if (this.queue.length === 0) {
      this.draining = false;
      return;
    }

    const next = this.queue.shift()!;
    this.displayState = next.state;

    for (const listener of this.eventListeners) {
      listener(next.events);
    }
    this.notify();

    this.waitForAnimations(() => this.processNext());
  }

  private waitForAnimations(cb: () => void) {
    const check = () => {
      if (this._animatingCheck && this._animatingCheck()) {
        requestAnimationFrame(check);
      } else {
        cb();
      }
    };
    requestAnimationFrame(check);
  }

  waitForState(): Promise<void> {
    if (this.displayState) return Promise.resolve();
    return new Promise((resolve) => {
      this._onStateReady = resolve;
    });
  }

  hasState(): boolean {
    return this.displayState !== null;
  }

  getState(): GameState | null {
    return this.displayState;
  }

  getLatestState(): GameState {
    return this.state!;
  }

  /**
   * True iff `next` reflects MY hero acting (vs a peer's snapshot). Most actions emit an event keyed
   * on the actor (attack uses `attackerId`); zone placement only emits `zoneCreated`, so we also
   * treat a drop in my hero's spendable energy as my action — only the actor spends energy, and the
   * open player phase doesn't run energy-draining ticks, so this never fires for a peer.
   */
  private snapshotIsMyAction(prev: GameState | null, next: GameState, events: readonly GameEvent[]): boolean {
    const myHeroId = this.seat.myHeroEntityId();
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

  dispatch(action: PlayerAction) {
    if (action.type === "endTurn") {
      throw new Error("CombatStore.dispatch received endTurn; clients send pass/unpass");
    }
    const seatId = this.seat.mySeatId;
    if (!seatId) throw new Error("CombatStore.dispatch with no bound seat");
    this.conn.send({ type: "action", seatId, action: action as WireAction });
  }

  pass() {
    this.conn.send({ type: "pass" });
  }

  unpass() {
    this.conn.send({ type: "unpass" });
  }

  reset() {
    this.queue.length = 0;
    this.draining = false;
    this.conn.send({ type: "reset" });
  }

  resetDisplayState() {
    this.displayState = null;
    this.state = null;
    this.queue.length = 0;
    this.draining = false;
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  subscribeEvents(listener: EventListener) {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  /** Fired when MY seat's action was rejected/no-op'd; unlock the local submit lock only. */
  subscribeRejected(listener: RejectListener) {
    this.rejectListeners.push(listener);
    return () => {
      this.rejectListeners = this.rejectListeners.filter((l) => l !== listener);
    };
  }

  /** Fired when a snapshot reflects MY hero acting; releases my submit lock (not on peers' actions). */
  subscribeSelfActed(listener: Listener) {
    this.selfActedListeners.push(listener);
    return () => {
      this.selfActedListeners = this.selfActedListeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private notifyRejected() {
    for (const listener of this.rejectListeners) listener();
  }

  private notifySelfActed() {
    for (const listener of this.selfActedListeners) listener();
  }
}
