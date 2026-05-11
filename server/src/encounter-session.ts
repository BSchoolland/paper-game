import type { AbilityDefinition, AnimSet, GameEvent, GameState, PlayerAction, TeamId, EncounterType, HexCoord, ItemDefinition, AttachmentData } from "shared";
import {
  resolveAction,
  serializeGameState,
  AiController,
  generateEncounter,
  GREENLANDS_BIOME,
  resetSpawnCounter,
  buildScenarioMap,
  placePvpEntities,
  placePveEntities,
  assembleGameState as assembleScenarioState,
} from "shared";
import { loadCollisionGrid } from "./collision-loader.js";
import {
  buildEncounterMap,
  placeEncounterEntities,
  assembleGameState as assembleEncounterState,
} from "./encounter-builder.js";

export class EncounterSession {
  state: GameState;
  readonly ai = new AiController();

  private constructor(state: GameState) {
    this.state = state;
  }

  static async create(
    mode: "pvp" | "pve",
    hexType?: EncounterType,
    hexCoord?: HexCoord,
    runId?: number,
    itemAbilities?: readonly AbilityDefinition[],
    animSet?: AnimSet,
    equipped?: readonly ItemDefinition[],
    attachments?: Record<string, AttachmentData>,
  ): Promise<EncounterSession> {
    resetSpawnCounter();

    if (mode === "pve" && hexType && hexCoord && runId !== undefined) {
      const encounter = generateEncounter(hexType, GREENLANDS_BIOME, hexCoord.q, hexCoord.r, runId);
      const map = buildEncounterMap(encounter);
      await loadCollisionGrid(map.grid, map.mapDefinition.objects);
      const entities = placeEncounterEntities(encounter, map.grid, itemAbilities, animSet, equipped, attachments);
      return new EncounterSession(assembleEncounterState(map, entities));
    }

    const map = buildScenarioMap(42);
    await loadCollisionGrid(map.grid, map.mapDefinition.objects);
    const entities = mode === "pve" ? placePveEntities(map.grid) : placePvpEntities(map.grid);
    return new EncounterSession(assembleScenarioState(map, entities));
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
