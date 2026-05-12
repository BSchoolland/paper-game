import type { AbilityDefinition, AnimSet, GameEvent, GameState, PlayerAction, TeamId, EncounterType, HexCoord, ItemDefinition, AttachmentData } from "shared";
import {
  resolveAction,
  createGameState,
  serializeGameState,
  AiController,
  generateEncounter,
  setTemplateRegistry,
  buildScenarioMap,
  placePvpEntities,
  placePveEntities,
} from "shared";
import { loadDimension, loadEnemyTemplateRegistry } from "./db.js";
import { loadCollisionGrid } from "./collision-loader.js";
import {
  buildEncounterMap,
  placeEncounterEntities,
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
    dimensionId: number = 0,
  ): Promise<EncounterSession> {
    if (mode === "pve" && hexType && hexCoord && runId !== undefined) {
      const dimension = loadDimension(dimensionId)!;
      const registry = loadEnemyTemplateRegistry(dimensionId);
      setTemplateRegistry(registry);
      const encounter = generateEncounter(hexType, dimension, hexCoord.q, hexCoord.r, runId);
      const map = buildEncounterMap(encounter);
      await loadCollisionGrid(map.grid, map.mapDefinition.objects, dimension.structures);
      const entities = placeEncounterEntities(encounter, map.grid, itemAbilities, animSet, equipped, attachments);
      return new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
    }

    const map = buildScenarioMap(42);
    await loadCollisionGrid(map.grid, map.mapDefinition.objects);
    const entities = mode === "pve" ? placePveEntities(map.grid, loadEnemyTemplateRegistry(dimensionId)) : placePvpEntities(map.grid);
    return new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
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
