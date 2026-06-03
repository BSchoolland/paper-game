import type { AbilityDefinition, AnimSet, EntityId, GameEvent, GameState, PlayerAction, TeamId, EncounterType, HexCoord, ItemDefinition, AttachmentData, SeatId } from "shared";
import {
  resolveAction,
  isActionLegal,
  createGameState,
  serializeGameState,
  generateEncounter,
  setTemplateRegistry,
  buildScenarioMap,
  placePvpEntities,
  placePveEntities,
  makeEntity,
  findWalkablePosition,
} from "shared";
import { loadDimension, loadEnemyTemplateRegistry } from "./db.js";
import { loadCollisionGrid, loadMaskCollision } from "./collision-loader.js";
import {
  buildEncounterMap,
  placeEncounterEntities,
} from "./encounter-builder.js";
import { FIGHTER_TEMPLATE } from "../../hero-arena/src/t2/loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, TANK_WEIGHTS, RANGED_WEIGHTS, PRESETS } from "../../hero-arena/agents/agent-02/sovereign.js";
import type { HeroController } from "../../hero-arena/src/types.js";
import { AiTurnRunner, type AiStepResult, type RunnerMode } from "./ai-turn-runner.js";
import type { SeatBuildSpec } from "./room.js";

export type { AiStepResult } from "./ai-turn-runner.js";

// Generous cap so even the `engine` preset (8s softBudget) can run. Faster presets self-limit
// via their own softBudgetMs, so this only matters for the heaviest brain.
const HERO_TURN_BUDGET_MS = 10000;

export type SessionMode = "pvp" | "pve" | "duel";

export class EncounterSession {
  state: GameState;
  readonly heroBrains = new Map<EntityId, HeroController>();
  private turnIndex = 0;
  private aiRunner: AiTurnRunner;

  private constructor(state: GameState) {
    this.state = state;
    this.aiRunner = new AiTurnRunner({
      getState: () => this.state,
      setState: (s) => { this.state = s; },
      heroBrains: this.heroBrains,
      heroBudgetMs: HERO_TURN_BUDGET_MS,
    });
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
      if (map.mapDefinition.mapImage) {
        // Single-image map: collide against its mask if one exists, else open field.
        if (map.mapDefinition.maskImage) {
          await loadMaskCollision(map.grid, map.mapDefinition.maskImage);
        }
      } else {
        await loadCollisionGrid(map.grid, map.mapDefinition.objects, dimension.structures);
      }
      const spec: SeatBuildSpec = {
        seatId: "s0" as SeatId,
        heroEntityId: "red1",
        controllerId: "s0" as SeatId,
        animSet: animSet ?? "sword",
        equipped: equipped ?? [],
        attachments: attachments ?? {},
      };
      const entities = placeEncounterEntities(encounter, map.grid, [spec]);
      return new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
    }

    const map = buildScenarioMap(42);
    await loadCollisionGrid(map.grid, map.mapDefinition.objects);

    if (mode === "duel") {
      const entities = new Map<string, ReturnType<typeof makeEntity>>();
      const enemyTemplates = loadEnemyTemplateRegistry(dimensionId);

      // Red: a balanced hero (FIGHTER kit — greatsword melee + shield + precision-shot ranged).
      const redPos = findWalkablePosition(map.grid, { x: 120, y: 300 }, FIGHTER_TEMPLATE.collisionRadius);
      entities.set("red1", makeEntity("red1", "fighter", redPos.x, redPos.y, "red", FIGHTER_TEMPLATE));

      // Blue: 1 normal goblin (basic AI) + 1 smart fighter with Sovereign brain.
      const goblins: Array<{ id: string; name: string; key: string; pos: { x: number; y: number } }> = [
        { id: "b-spear-a",  name: "Goblin Spearman", key: "goblin-spear",  pos: { x: 600, y: 200 } },
      ];
      for (const g of goblins) {
        const tpl = enemyTemplates[g.key];
        if (!tpl) continue;
        const p = findWalkablePosition(map.grid, g.pos, tpl.collisionRadius);
        entities.set(g.id, makeEntity(g.id, g.name, p.x, p.y, "blue", tpl));
      }

      // Smart fighter — standard fighter abilities, Sovereign brain at crafty preset.
      const smartPos = findWalkablePosition(map.grid, { x: 660, y: 320 }, FIGHTER_TEMPLATE.collisionRadius);
      entities.set("b-smart", makeEntity("b-smart", "Fighter", smartPos.x, smartPos.y, "blue", FIGHTER_TEMPLATE));

      const session = new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
      session.heroBrains.set("b-smart" as EntityId, makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty));
      return session;
    }

    const entities = mode === "pve" ? placePveEntities(map.grid, loadEnemyTemplateRegistry(dimensionId)) : placePvpEntities(map.grid);
    return new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
  }

  /**
   * Co-op encounter: one red hero per seat (from each seat's loadout snapshot) vs the generated
   * blue enemies. This is the sole encounter path post-Phase-6; `create()` above is the legacy
   * pvp/duel/pve path kept until the index.ts rewrite deletes it.
   */
  static async createEncounter(opts: {
    seats: readonly SeatBuildSpec[];
    hexType: EncounterType;
    hexCoord: HexCoord;
    runId: number;
    dimensionId: number;
  }): Promise<EncounterSession> {
    const { seats, hexType, hexCoord, runId, dimensionId } = opts;
    const dimension = loadDimension(dimensionId)!;
    setTemplateRegistry(loadEnemyTemplateRegistry(dimensionId));
    const encounter = generateEncounter(hexType, dimension, hexCoord.q, hexCoord.r, runId);
    const map = buildEncounterMap(encounter);
    if (map.mapDefinition.mapImage) {
      if (map.mapDefinition.maskImage) await loadMaskCollision(map.grid, map.mapDefinition.maskImage);
    } else {
      await loadCollisionGrid(map.grid, map.mapDefinition.objects, dimension.structures);
    }
    const entities = placeEncounterEntities(encounter, map.grid, seats);
    return new EncounterSession(createGameState({ entities, grid: map.grid, mapDefinition: map.mapDefinition }));
  }

  serialize(): object {
    return serializeGameState(this.state);
  }

  applyAction(action: PlayerAction): { changed: boolean; events: readonly GameEvent[] } {
    if (!isActionLegal(this.state, action)) return { changed: false, events: [] };
    // Player moves are path-based (cost = the route around obstacles); the AI keeps the cheap
    // straight-line check via its own resolve call sites (ai-turn-runner). Server-trusted: the flag
    // isn't part of the action, so a client can't ask for the cheaper rule.
    const result = resolveAction(this.state, action, { pathBased: true });
    if (result.state !== this.state) {
      this.state = result.state;
      return { changed: true, events: result.events };
    }
    return { changed: false, events: [] };
  }


  startAiTurn(modeOrTeam: TeamId | RunnerMode): void {
    const mode: RunnerMode = typeof modeOrTeam === "string" ? { kind: "enemyPhase", team: modeOrTeam } : modeOrTeam;
    this.turnIndex++;
    this.aiRunner.start(mode, this.turnIndex);
  }

  /** Drive a single player-team bot hero during the player phase (e.g. a mid-phase disconnect, R9). */
  runHero(entityId: EntityId, humanHeroIds: ReadonlySet<EntityId>): void {
    this.startAiTurn({ kind: "playerBots", entityIds: [entityId], humanHeroIds });
  }

  /** Abort a reclaimed entity mid-burst (ruling R12). */
  abortAi(entityId: EntityId): void {
    this.aiRunner.abort(entityId);
  }

  stepAi(): AiStepResult {
    return this.aiRunner.step();
  }

  resolveDefend(defenseResults: Record<string, number>, roundId?: string): AiStepResult {
    return this.aiRunner.resolveDefend(defenseResults, roundId);
  }

  get pendingDefend(): boolean {
    return this.aiRunner.hasPendingDefend();
  }

  get pendingDefendRoundId(): string | null {
    return this.aiRunner.pendingRoundId();
  }
}
