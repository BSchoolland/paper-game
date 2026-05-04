import type { GameState, PlayerAction } from "shared";
import { resolveAction } from "shared";

type Listener = () => void;

export interface GameStore {
  getState(): GameState;
  dispatch(action: PlayerAction): void;
  reset(): void;
  subscribe(listener: Listener): () => void;
}

export class LocalGameStore implements GameStore {
  private state: GameState;
  private listeners: Listener[] = [];
  private readonly initialState: GameState;

  constructor(initialState: GameState) {
    this.state = initialState;
    this.initialState = initialState;
  }

  getState(): GameState {
    return this.state;
  }

  dispatch(action: PlayerAction) {
    const next = resolveAction(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.notify();
    }
  }

  reset() {
    this.state = this.initialState;
    this.notify();
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
