import type { GameState, GameEvent, PlayerAction } from "shared";
import { deserializeGameState } from "shared/src/core/serialization.js";
import type { Connection } from "../net/connection.js";
import type { GameStore } from "./game-store.js";

type Listener = () => void;
type EventListener = (events: readonly GameEvent[]) => void;

interface QueuedUpdate {
  state: GameState;
  events: readonly GameEvent[];
}

export class CombatStore implements GameStore {
  private state: GameState | null = null;
  private displayState: GameState | null = null;
  private queue: QueuedUpdate[] = [];
  private draining = false;
  private listeners: Listener[] = [];
  private eventListeners: EventListener[] = [];
  private _animatingCheck: (() => boolean) | null = null;
  private _onStateReady: (() => void) | null = null;

  constructor(private conn: Connection) {
    conn.on("state", (msg) => this.handleState(msg));
  }

  private handleState(msg: any) {
    const newState = deserializeGameState(msg.state);
    const events: readonly GameEvent[] = msg.events ?? [];

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

  dispatch(action: PlayerAction) {
    this.conn.send({ type: "action", action });
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

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
