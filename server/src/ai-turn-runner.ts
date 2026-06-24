import type { AimDirection, AttackAbility, Entity, EntityId, GameEvent, GameState, PlayerAction, TeamId, Vec2 } from "shared";
import { resolveAction, resolveWeaponAttack, serializeGameState, defenseToMultiplier, strategyForEntity } from "shared";
import type { HeroController } from "../../hero-arena/src/types.js";

export type AiStepResult =
  | { type: "events"; serializedState: object; events: readonly GameEvent[]; won: boolean }
  | {
      type: "defendPrompt";
      roundId: string;
      attackerId: EntityId;
      attackerPosition: Vec2;
      aimDirection: AimDirection;
      ability: AttackAbility;
      targetIds: EntityId[];
    }
  // An enemy-phase sweep finished and issued its terminal endTurn (the explicit enemy->player flip
  // signal — the orchestrator no longer infers it from activeTeam). A playerBots burst finishing
  // returns `done` (the Room decides when the shared player phase ends).
  | { type: "endedTurn" }
  | { type: "done" };

/**
 * What the runner is driving:
 *  - `enemyPhase`: sweep a whole AI team, then issue `endTurn` (flips the active team back).
 *  - `playerBots`: drive a specific set of player-team hero ids during the shared player phase,
 *    then stop WITHOUT `endTurn` — the Room's phase machine decides when the player phase ends.
 *
 * `promptsDefense` differs by mode (ruling R16): an enemy attack prompts every player-side
 * (non-AI-team) target; a player-bot attack only prompts the human owner of a friendly-fire
 * target. NOTE: `resolveWeaponAttack` currently drops same-team targets, so a player bot can
 * never actually hit an ally today — the `humanHeroIds` predicate is therefore a no-op in
 * practice and kept only so the routing stays correct if friendly fire is ever introduced.
 */
export type RunnerMode =
  | { kind: "enemyPhase"; team: TeamId }
  | { kind: "playerBots"; entityIds: EntityId[]; humanHeroIds: ReadonlySet<EntityId> };

interface PendingDefend {
  action: PlayerAction;
  targetIds: EntityId[];
  roundId: string;
}

export interface AiTurnRunnerDeps {
  getState(): GameState;
  setState(state: GameState): void;
  heroBrains: ReadonlyMap<EntityId, HeroController>;
  heroBudgetMs: number;
}

export class AiTurnRunner {
  private entityQueue: EntityId[] = [];
  private currentActions: PlayerAction[] = [];
  private actionIndex = 0;
  private mode: RunnerMode = { kind: "enemyPhase", team: "blue" };
  private promptsDefense: (target: Entity) => boolean = () => false;
  private complete = false;
  private pendingDefend: PendingDefend | null = null;
  private turnIndex = 0;
  private roundSeq = 0;

  constructor(private deps: AiTurnRunnerDeps) {}

  hasPendingDefend(): boolean {
    return this.pendingDefend !== null;
  }

  pendingRoundId(): string | null {
    return this.pendingDefend?.roundId ?? null;
  }

  start(mode: RunnerMode, turnIndex: number): void {
    this.mode = mode;
    this.turnIndex = turnIndex;
    const state = this.deps.getState();
    if (mode.kind === "enemyPhase") {
      this.entityQueue = [...state.entities.values()]
        .filter((e) => e.teamId === mode.team && !e.dead)
        .map((e) => e.id);
      this.promptsDefense = (t) => t.teamId !== mode.team;
    } else {
      this.entityQueue = mode.entityIds.filter((id) => {
        const e = state.entities.get(id);
        return !!e && !e.dead;
      });
      const human = mode.humanHeroIds;
      this.promptsDefense = (t) => human.has(t.id);
    }
    this.currentActions = [];
    this.actionIndex = 0;
    this.complete = false;
    this.pendingDefend = null;
  }

  /** Drop a reclaimed entity from the queue and skip its remaining queued actions (ruling R12). */
  abort(entityId: EntityId): void {
    this.entityQueue = this.entityQueue.filter((id) => id !== entityId);
    const current = this.currentActions[this.actionIndex];
    if (current && current.type === "ability" && current.entityId === entityId) {
      this.actionIndex = this.currentActions.length;
    }
  }

  step(): AiStepResult {
    const state = this.deps.getState();
    if (state.winner) return { type: "done" };
    // Once complete, an enemy sweep reports its explicit terminal endTurn; a playerBots burst is done.
    if (this.complete) return this.mode.kind === "enemyPhase" ? { type: "endedTurn" } : { type: "done" };

    while (true) {
      const next = this.tryNextAction();
      if (next) return next;

      if (this.entityQueue.length > 0) {
        this.loadActionsForNextEntity();
        continue;
      }
      return this.finish();
    }
  }

  resolveDefend(defenseResults: Record<string, number>, roundId?: string): AiStepResult {
    if (!this.pendingDefend) return this.step();
    // Stale round (superseded by reset/reclaim/a newer round) — ignore and continue (ruling R11/R17).
    if (roundId !== undefined && roundId !== this.pendingDefend.roundId) return this.step();

    const { action } = this.pendingDefend;
    this.pendingDefend = null;

    const defenseMap = new Map<string, number>();
    for (const [entityId, power] of Object.entries(defenseResults)) {
      defenseMap.set(entityId, defenseToMultiplier(power));
    }

    const state = this.deps.getState();
    const result = resolveAction(state, action, { defenseMap });
    if (result.state !== state) {
      this.deps.setState(result.state);
      return {
        type: "events",
        serializedState: serializeGameState(result.state),
        events: result.events,
        won: !!result.state.winner,
      };
    }
    return this.step();
  }

  private tryNextAction(): AiStepResult | null {
    if (this.actionIndex >= this.currentActions.length) return null;

    const action = this.currentActions[this.actionIndex]!;
    this.actionIndex++;

    const state = this.deps.getState();

    if (action.type === "ability" && action.aimDirection) {
      const entity = state.entities.get(action.entityId);
      if (entity && !entity.dead) {
        const ability = entity.abilities.find((a) => a.id === action.abilityId);
        if (ability?.kind === "attack") {
          const targets = resolveWeaponAttack(entity, action.aimDirection, state.entities, ability, state.grid);
          const promptTargets = targets.filter((t) => this.promptsDefense(t));
          if (promptTargets.length > 0) {
            const roundId = `r${this.turnIndex}-${this.roundSeq++}`;
            this.pendingDefend = { action, targetIds: promptTargets.map((t) => t.id), roundId };
            return {
              type: "defendPrompt",
              roundId,
              attackerId: entity.id,
              attackerPosition: entity.position,
              aimDirection: action.aimDirection,
              ability: ability as AttackAbility,
              targetIds: promptTargets.map((t) => t.id),
            };
          }
        }
      }
    }

    const result = resolveAction(state, action);
    if (result.state !== state) {
      this.deps.setState(result.state);
      return {
        type: "events",
        serializedState: serializeGameState(result.state),
        events: result.events,
        won: !!result.state.winner,
      };
    }
    return null;
  }

  private loadActionsForNextEntity(): void {
    const entityId = this.entityQueue.shift()!;
    const state = this.deps.getState();
    const entity = state.entities.get(entityId);
    if (!entity || entity.dead) {
      this.currentActions = [];
      this.actionIndex = 0;
      return;
    }

    const brain = this.deps.heroBrains.get(entityId);
    if (brain) {
      const ctx = {
        state,
        heroId: entityId,
        deadlineMs: Date.now() + this.deps.heroBudgetMs,
        turnIndex: this.turnIndex,
      };
      try {
        this.currentActions = (brain(ctx) ?? []).filter(
          (a: PlayerAction) => a.type === "ability" && a.entityId === entityId,
        );
      } catch (e) {
        console.error(`Hero brain threw for ${entityId}: ${(e as Error).message}`);
        this.currentActions = [];
      }
    } else {
      this.currentActions = strategyForEntity(entity).planActions(entity, state);
    }
    this.actionIndex = 0;
  }

  /** Queue drained. Enemy phase issues `endTurn`; player-bots stop and let the Room end the phase. */
  private finish(): AiStepResult {
    this.complete = true;
    if (this.mode.kind !== "enemyPhase") return { type: "done" };

    const state = this.deps.getState();
    const endResult = resolveAction(state, { type: "endTurn" });
    if (endResult.state !== state) {
      this.deps.setState(endResult.state);
      // Emit the terminal endTurn's flip/turnStart/regen events FIRST; the next stepAi() returns
      // `endedTurn` (complete is set), so the broadcast always precedes the player phase re-opening.
      return {
        type: "events",
        serializedState: serializeGameState(endResult.state),
        events: endResult.events,
        won: !!endResult.state.winner,
      };
    }
    return { type: "endedTurn" };
  }
}
