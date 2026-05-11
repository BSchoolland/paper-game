import type { AbilityDefinition, GameState, PlayerAction } from "shared";
import type { GameStore } from "./game-store.js";

type Listener = () => void;

export class ClientState {
  private listeners: Listener[] = [];

  selectedEntityId: string | null = null;
  selectedAbilityId: string | null = null;
  inputMode: "select" | "attack" = "select";
  showDebugWalls = false;

  constructor(private gameStore: GameStore) {
    gameStore.subscribe(() => this.notify());
  }

  getState(): GameState | null {
    return this.gameStore.getState();
  }

  dispatch(action: PlayerAction) {
    this.gameStore.dispatch(action);
  }

  selectEntity(entityId: string | null) {
    this.selectedEntityId = entityId;
    this.selectedAbilityId = null;
    this.inputMode = "select";
    this.notify();
  }

  selectAbility(abilityId: string | null) {
    if (!this.selectedEntityId) return;
    if (abilityId === null) {
      this.selectedAbilityId = null;
      this.inputMode = "select";
    } else {
      const state = this.getState();
      if (!state) return;
      const entity = state.entities.get(this.selectedEntityId);
      if (!entity) return;
      const ability = entity.abilities.find(a => a.id === abilityId);
      if (!ability) return;

      this.selectedAbilityId = abilityId;
      this.inputMode = ability.kind === "attack" ? "attack" : "select";
    }
    this.notify();
  }

  getSelectedAbility(): AbilityDefinition | null {
    if (!this.selectedEntityId || !this.selectedAbilityId) return null;
    const state = this.getState();
    if (!state) return null;
    const entity = state.entities.get(this.selectedEntityId);
    if (!entity) return null;
    return entity.abilities.find(a => a.id === this.selectedAbilityId) ?? null;
  }

  resetSelection() {
    this.selectedEntityId = null;
    this.selectedAbilityId = null;
    this.inputMode = "select";
  }

  toggleDebugWalls() {
    this.showDebugWalls = !this.showDebugWalls;
    this.notify();
  }

  endTurn() {
    this.dispatch({ type: "endTurn" });
    this.selectedAbilityId = null;
    this.inputMode = "select";
  }

  autoSelectPlayer() {
    const state = this.getState();
    if (!state) return;
    const player = [...state.entities.values()].find(e => e.teamId === "red");
    if (player) {
      this.selectedEntityId = player.id;
      this.selectedAbilityId = null;
      this.inputMode = "select";
      this.notify();
    }
  }

  reset() {
    this.gameStore.reset();
    this.selectedEntityId = null;
    this.selectedAbilityId = null;
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
