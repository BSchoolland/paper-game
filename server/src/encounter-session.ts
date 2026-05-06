import type { GameEvent, GameState, PlayerAction, TeamId, EncounterType, HexCoord } from "shared";
import {
  createInitialGameState,
  createPveGameState,
  resolveAction,
  serializeGameState,
  AiController,
  generateEncounter,
  GREENLANDS_BIOME,
  resetSpawnCounter,
} from "shared";
import { loadCollisionGrid } from "./collision-loader.js";
import { createEncounterGameState } from "./encounter-builder.js";

export class EncounterSession {
  state: GameState;
  readonly ai = new AiController();

  private constructor(state: GameState) {
    this.state = state;
  }

  static async create(
    mode: "pvp" | "pve",
    hexType?: EncounterType,
    hexCoord?: HexCoord
  ): Promise<EncounterSession> {
    resetSpawnCounter();
    let state: GameState;

    if (mode === "pve" && hexType && hexCoord) {
      const encounter = generateEncounter(hexType, GREENLANDS_BIOME, hexCoord.q, hexCoord.r);
      state = createEncounterGameState(encounter);
    } else if (mode === "pve") {
      state = createPveGameState();
    } else {
      state = createInitialGameState();
    }

    await loadCollisionGrid(state.grid, state.mapDefinition.objects);
    return new EncounterSession(state);
  }

  serialize(): object {
    return serializeGameState(this.state);
  }

  applyAction(action: PlayerAction): { changed: boolean; events: readonly GameEvent[] } {
    const result = resolveAction(this.state, action);
    if (result.state !== this.state) {
      this.state = result.state;
      return { changed: true, events: result.events };
    }
    return { changed: false, events: [] };
  }

  runAi(aiTeam: TeamId): { serializedState: object; events: readonly GameEvent[]; won: boolean }[] {
    if (this.state.activeTeam !== aiTeam || this.state.winner) return [];

    const actions = this.ai.computeActions(this.state, aiTeam);
    const results: { serializedState: object; events: readonly GameEvent[]; won: boolean }[] = [];

    for (const action of actions) {
      const result = resolveAction(this.state, action);
      if (result.state !== this.state) {
        this.state = result.state;
        results.push({
          serializedState: serializeGameState(this.state),
          events: result.events,
          won: !!this.state.winner,
        });
        if (this.state.winner) break;
      }
    }

    return results;
  }
}
