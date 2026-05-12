import type { GameState, PlayerAction } from "shared";
import { resolveAction, isActionLegal, shouldAutoEndTurn } from "shared";

type Listener = () => void;

export interface GameStore {
  getState(): GameState | null;
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
    if (!isActionLegal(this.state, action)) return;
    const result = resolveAction(this.state, action);
    if (result.state !== this.state) {
      this.state = result.state;
      if (action.type !== "endTurn" && !this.state.winner && shouldAutoEndTurn(this.state)) {
        const endResult = resolveAction(this.state, { type: "endTurn" });
        if (endResult.state !== this.state) {
          this.state = endResult.state;
        }
      }
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
