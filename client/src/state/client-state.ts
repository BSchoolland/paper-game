import type { GameState, PlayerAction } from "shared";
import type { GameStore } from "./game-store.js";

type Listener = () => void;

export class ClientState {
  private listeners: Listener[] = [];

  selectedEntityId: string | null = null;
  inputMode: "select" | "attack" = "select";
  showDebugWalls = false;

  constructor(private gameStore: GameStore) {
    gameStore.subscribe(() => this.notify());
  }

  getState(): GameState {
    return this.gameStore.getState();
  }

  dispatch(action: PlayerAction) {
    this.gameStore.dispatch(action);
  }

  selectEntity(entityId: string | null) {
    this.selectedEntityId = entityId;
    this.inputMode = "select";
    this.notify();
  }

  toggleDebugWalls() {
    this.showDebugWalls = !this.showDebugWalls;
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
    this.gameStore.reset();
    this.selectedEntityId = null;
    this.inputMode = "select";
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
