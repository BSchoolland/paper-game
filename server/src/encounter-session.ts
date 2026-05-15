import type { AbilityDefinition, AnimSet, EntityId, GameEvent, GameState, PlayerAction, TeamId, EncounterType, HexCoord, ItemDefinition, AttachmentData } from "shared";
import {
  resolveAction,
  isActionLegal,
  createGameState,
  serializeGameState,
  AiController,
  generateEncounter,
  setTemplateRegistry,
  buildScenarioMap,
  placePvpEntities,
  placePveEntities,
  makeEntity,
  findWalkablePosition,
} from "shared";
import { loadDimension, loadEnemyTemplateRegistry } from "./db.js";
import { loadCollisionGrid } from "./collision-loader.js";
import {
  buildEncounterMap,
  placeEncounterEntities,
} from "./encounter-builder.js";
import { TANK_TEMPLATE, RANGED_TEMPLATE } from "../../hero-arena/src/t2/loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../hero-arena/agents/agent-02/sovereign.js";
import type { HeroController } from "../../hero-arena/src/types.js";
import { strategyForEntity } from "../../shared/src/ai/strategy.js";

// Generous cap so even the `engine` preset (8s softBudget) can run. Faster presets self-limit
// via their own softBudgetMs, so this only matters for the heaviest brain.
const HERO_TURN_BUDGET_MS = 10000;

export type SessionMode = "pvp" | "pve" | "duel";

export class EncounterSession {
  state: GameState;
  readonly ai = new AiController();
  readonly heroBrains = new Map<EntityId, HeroController>();
  private turnCounts: Record<TeamId, number> = { red: 0, blue: 0 };

  private constructor(state: GameState) {
    this.state = state;
  }

  static async create(
    mode: SessionMode,
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

    if (mode === "duel") {
      const entities = new Map<string, ReturnType<typeof makeEntity>>();
      const enemyTemplates = loadEnemyTemplateRegistry(dimensionId);
      const redPos = findWalkablePosition(map.grid, { x: 120, y: 300 }, RANGED_TEMPLATE.collisionRadius);
      const bluePos = findWalkablePosition(map.grid, { x: 680, y: 300 }, TANK_TEMPLATE.collisionRadius);
      entities.set("red1", makeEntity("red1", "ranged", redPos.x, redPos.y, "red", RANGED_TEMPLATE));
      entities.set("blue1", makeEntity("blue1", "tank", bluePos.x, bluePos.y, "blue", TANK_TEMPLATE));

      // Minions on the AI (blue) side: a spearman to soak hits and an archer for cover-fire.
      const spear = enemyTemplates["goblin-spear"];
      const archer = enemyTemplates["goblin-archer"];
      if (spear) {
        const p = findWalkablePosition(map.grid, { x: 600, y: 240 }, spear.collisionRadius);
        entities.set("blue-minion1", makeEntity("blue-minion1", "Goblin Spearman", p.x, p.y, "blue", spear));
      }
      if (archer) {
        const p = findWalkablePosition(map.grid, { x: 600, y: 360 }, archer.collisionRadius);
        entities.set("blue-minion2", makeEntity("blue-minion2", "Goblin Archer", p.x, p.y, "blue", archer));
      }

      const session = new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
      session.heroBrains.set(
        "blue1" as EntityId,
        makeSovereign(FIGHTER_WEIGHTS, PRESETS.genius),
      );
      return session;
    }

    const entities = mode === "pve" ? placePveEntities(map.grid, loadEnemyTemplateRegistry(dimensionId)) : placePvpEntities(map.grid);
    return new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
  }

  serialize(): object {
    return serializeGameState(this.state);
  }

  applyAction(action: PlayerAction): { changed: boolean; events: readonly GameEvent[] } {
    if (!isActionLegal(this.state, action)) return { changed: false, events: [] };
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

  /**
   * Run any registered HeroController brains for the AI team, then endTurn.
   * Falls back to the scripted AiController for entities without a registered brain.
   */
  runHeroAi(aiTeam: TeamId): { serializedState: object; events: readonly GameEvent[]; won: boolean }[] {
    if (this.state.activeTeam !== aiTeam || this.state.winner) return [];

    this.turnCounts[aiTeam]++;
    const results: { serializedState: object; events: readonly GameEvent[]; won: boolean }[] = [];

    const apply = (action: PlayerAction) => {
      const result = resolveAction(this.state, action);
      if (result.state !== this.state) {
        this.state = result.state;
        results.push({
          serializedState: serializeGameState(this.state),
          events: result.events,
          won: !!this.state.winner,
        });
        return true;
      }
      return false;
    };

    const aiEntities = [...this.state.entities.values()]
      .filter(e => e.teamId === aiTeam && !e.dead);

    for (const entity of aiEntities) {
      if (this.state.winner) break;
      const brain = this.heroBrains.get(entity.id);
      if (brain) {
        const ctx = {
          state: this.state,
          heroId: entity.id,
          deadlineMs: Date.now() + HERO_TURN_BUDGET_MS,
          turnIndex: this.turnCounts[aiTeam],
        };
        let actions: PlayerAction[] = [];
        try { actions = brain(ctx) ?? []; }
        catch (e) { console.error(`Hero brain threw for ${entity.id}: ${(e as Error).message}`); }
        for (const action of actions) {
          if (action.type !== "ability" || action.entityId !== entity.id) continue;
          apply(action);
          if (this.state.winner) break;
        }
      } else {
        // Scripted minion — re-read its live entity each iteration since prior actions may have moved/killed it.
        const live = this.state.entities.get(entity.id);
        if (!live || live.dead) continue;
        for (const action of strategyForEntity(live).planActions(live, this.state)) {
          apply(action);
          if (this.state.winner) break;
        }
      }
    }

    if (!this.state.winner) apply({ type: "endTurn" });
    return results;
  }
}
