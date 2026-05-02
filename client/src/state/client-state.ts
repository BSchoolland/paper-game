import type { GameState, PlayerAction } from "shared";
import { resolveAction } from "shared";

type Listener = () => void;

export class ClientState {
  private state: GameState;
  private listeners: Listener[] = [];
  private initialState: GameState;

  selectedEntityId: string | null = null;
  inputMode: "select" | "attack" = "select";

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

  selectEntity(entityId: string | null) {
    this.selectedEntityId = entityId;
    this.inputMode = "select";
    this.notify();
  }

  toggleAttackMode() {
    if (!this.selectedEntityId) return;
    this.inputMode = this.inputMode === "attack" ? "select" : "attack";
    this.notify();
  }

  endTurn() {
    this.dispatch({ type: "endTurn" });
    this.selectedEntityId = null;
    this.inputMode = "select";
  }

  reset() {
    this.state = this.initialState;
    this.selectedEntityId = null;
    this.inputMode = "select";
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
