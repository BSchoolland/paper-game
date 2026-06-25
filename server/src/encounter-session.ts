import type { EntityId, GameEvent, GameState, PlayerAction, TeamId, EncounterType, HexCoord } from "shared";
import {
  resolveAction,
  isActionLegal,
  createGameState,
  serializeGameState,
  generateEncounter,
  setTemplateRegistry,
} from "shared";
import { loadDimension, loadEnemyTemplateRegistry } from "./db.js";
import { loadCollisionGrid, loadMaskCollision } from "./collision-loader.js";
import {
  buildEncounterMap,
  placeEncounterEntities,
} from "./encounter-builder.js";
import type { HeroController } from "../../hero-arena/src/types.js";
import { AiTurnRunner, type AiStepResult, type RunnerMode } from "./ai-turn-runner.js";
import type { SeatBuildSpec } from "./room.js";

export type { AiStepResult } from "./ai-turn-runner.js";

// Generous cap so even the `engine` preset (8s softBudget) can run. Faster presets self-limit
// via their own softBudgetMs, so this only matters for the heaviest brain.
const HERO_TURN_BUDGET_MS = 10000;

/** A move request is the only action carrying a `destination`. If the server denies one, the client
 *  predicted a move the authoritative resolver rejected — i.e. client/server drift — so surface it
 *  loudly rather than letting the move silently no-op. */
function logDeniedMove(state: GameState, action: PlayerAction, reason: string): void {
  if (action.type !== "ability" || !action.destination) return;
  const from = state.entities.get(action.entityId)?.position;
  const fromStr = from ? `(${from.x.toFixed(1)},${from.y.toFixed(1)})` : "?";
  const { x, y } = action.destination;
  console.error(`[move] denied: ${action.entityId} ${fromStr} -> (${x.toFixed(1)},${y.toFixed(1)}): ${reason}`);
}

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

  /**
   * Co-op encounter: one red hero per seat (from each seat's loadout snapshot) vs the generated
   * blue enemies. This is the sole encounter construction path (ruling R25).
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
    if (!isActionLegal(this.state, action)) {
      logDeniedMove(this.state, action, "illegal (out of turn, dead, or game over)");
      return { changed: false, events: [] };
    }
    // Player moves are path-based (cost = the route around obstacles); the AI keeps the cheap
    // straight-line check via its own resolve call sites (ai-turn-runner). Server-trusted: the flag
    // isn't part of the action, so a client can't ask for the cheaper rule.
    const result = resolveAction(this.state, action, { pathBased: true });
    if (result.state !== this.state) {
      this.state = result.state;
      return { changed: true, events: result.events };
    }
    logDeniedMove(this.state, action, "no legal path within move budget");
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
