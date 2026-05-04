import type { GameState, PlayerAction, TeamId } from "shared";
import { deserializeGameState } from "shared/src/serialization.js";
import type { GameStore } from "./game-store.js";

type Listener = () => void;

export class RemoteGameStore implements GameStore {
  private state: GameState | null = null;
  private listeners: Listener[] = [];
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
        this.state = deserializeGameState(msg.state);
        if (this._onReady) {
          this._onReady();
          this._onReady = null;
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

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
