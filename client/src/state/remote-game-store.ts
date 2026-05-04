import type { GameState, GameEvent, PlayerAction, TeamId } from "shared";
import { deserializeGameState } from "shared/src/serialization.js";
import type { GameStore } from "./game-store.js";

type Listener = () => void;
type EventListener = (events: readonly GameEvent[]) => void;

export class RemoteGameStore implements GameStore {
  private state: GameState | null = null;
  private listeners: Listener[] = [];
  private eventListeners: EventListener[] = [];
  private ws: WebSocket;
  private _team: TeamId | null = null;
  private _onReady: (() => void) | null = null;

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

        if (this.state && events.length === 0) {
          console.warn("[sync] State update with no events — full state recovery");
        }

        this.state = newState;

        if (this._onReady) {
          this._onReady();
          this._onReady = null;
        }

        if (events.length > 0) {
          for (const listener of this.eventListeners) {
            listener(events);
          }
        }

        this.notify();
      }
    });
  }

  ready(): Promise<void> {
    if (this.state) return Promise.resolve();
    return new Promise((resolve) => {
      this._onReady = resolve;
    });
  }

  getState(): GameState {
    return this.state!;
  }

  dispatch(action: PlayerAction) {
    this.ws.send(JSON.stringify({ type: "action", action }));
  }

  reset() {
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

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
