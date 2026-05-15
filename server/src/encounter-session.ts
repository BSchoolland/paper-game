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
import { FIGHTER_TEMPLATE } from "../../hero-arena/src/t2/loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, TANK_WEIGHTS, RANGED_WEIGHTS, PRESETS } from "../../hero-arena/agents/agent-02/sovereign.js";
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

      // Red: a single well-rounded hero (FIGHTER kit — greatsword melee + shield + precision-shot ranged).
      const redPos = findWalkablePosition(map.grid, { x: 120, y: 300 }, FIGHTER_TEMPLATE.collisionRadius);
      entities.set("red1", makeEntity("red1", "fighter", redPos.x, redPos.y, "red", FIGHTER_TEMPLATE));

      // Blue: army of genius-tier goblins. Each runs a Sovereign brain matched to its role.
      const army: Array<{ id: string; name: string; key: string; pos: { x: number; y: number }; weights: typeof FIGHTER_WEIGHTS }> = [
        { id: "b-spear-a",  name: "Goblin Spearman", key: "goblin-spear",  pos: { x: 600, y: 200 }, weights: FIGHTER_WEIGHTS },
        { id: "b-spear-b",  name: "Goblin Spearman", key: "goblin-spear",  pos: { x: 720, y: 240 }, weights: FIGHTER_WEIGHTS },
        { id: "b-archer-a", name: "Goblin Archer",   key: "goblin-archer", pos: { x: 680, y: 380 }, weights: RANGED_WEIGHTS },
        { id: "b-archer-b", name: "Goblin Archer",   key: "goblin-archer", pos: { x: 760, y: 420 }, weights: RANGED_WEIGHTS },
        { id: "b-shield",   name: "Goblin Shield",   key: "goblin-shield", pos: { x: 580, y: 320 }, weights: TANK_WEIGHTS    },
        { id: "b-bigslime", name: "Big Slime",       key: "big-slime",     pos: { x: 640, y: 460 }, weights: FIGHTER_WEIGHTS },
      ];
      for (const u of army) {
        const tpl = enemyTemplates[u.key];
        if (!tpl) continue;
        const p = findWalkablePosition(map.grid, u.pos, tpl.collisionRadius);
        entities.set(u.id, makeEntity(u.id, u.name, p.x, p.y, "blue", tpl));
      }

      const session = new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
      for (const u of army) {
        if (entities.has(u.id)) {
          session.heroBrains.set(u.id as EntityId, makeSovereign(u.weights, PRESETS.genius));
        }
      }
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
