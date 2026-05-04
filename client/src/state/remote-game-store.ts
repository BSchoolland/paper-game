import type { GameState, GameEvent, PlayerAction, TeamId } from "shared";
import { deserializeGameState } from "shared/src/serialization.js";
import type { GameStore } from "./game-store.js";

type Listener = () => void;
type EventListener = (events: readonly GameEvent[]) => void;

interface QueuedUpdate {
  state: GameState;
  events: readonly GameEvent[];
}

export class RemoteGameStore implements GameStore {
  private state: GameState | null = null;
  private displayState: GameState | null = null;
  private queue: QueuedUpdate[] = [];
  private draining = false;
  private listeners: Listener[] = [];
  private eventListeners: EventListener[] = [];
  private ws: WebSocket;
  private _team: TeamId | null = null;
  private _onReady: (() => void) | null = null;
  private _animatingCheck: (() => boolean) | null = null;

  get team(): TeamId | null {
    return this._team;
  }

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.type === "team") {
        this._team = msg.team;
      } else if (msg.type === "state") {
        const newState = deserializeGameState(msg.state);
        const events: readonly GameEvent[] = msg.events ?? [];

        this.state = newState;

        if (!this.displayState) {
          this.displayState = newState;
          if (this._onReady) {
            this._onReady();
            this._onReady = null;
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
    });
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

  ready(): Promise<void> {
    if (this.displayState) return Promise.resolve();
    return new Promise((resolve) => {
      this._onReady = resolve;
    });
  }

  getState(): GameState {
    return this.displayState!;
  }

  getLatestState(): GameState {
    return this.state!;
  }

  dispatch(action: PlayerAction) {
    this.ws.send(JSON.stringify({ type: "action", action }));
  }

  reset() {
    this.queue.length = 0;
    this.draining = false;
    this.ws.send(JSON.stringify({ type: "reset" }));
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

  isQueueEmpty(): boolean {
    return this.queue.length === 0 && !this.draining;
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
