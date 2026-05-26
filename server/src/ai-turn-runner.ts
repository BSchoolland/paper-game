import type { AimDirection, AttackAbility, EntityId, GameEvent, GameState, PlayerAction, TeamId, Vec2 } from "shared";
import { resolveAction, resolveWeaponAttack, serializeGameState, defenseToMultiplier, strategyForEntity } from "shared";
import type { HeroController } from "../../hero-arena/src/types.js";

export type AiStepResult =
  | { type: "events"; serializedState: object; events: readonly GameEvent[]; won: boolean }
  | { type: "defendPrompt"; attackerId: EntityId; attackerPosition: Vec2; aimDirection: AimDirection; ability: AttackAbility; targetIds: EntityId[] }
  | { type: "done" };

interface PendingDefend {
  action: PlayerAction;
  targetIds: EntityId[];
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
  private aiTeam: TeamId = "blue";
  private complete = false;
  private pendingDefend: PendingDefend | null = null;
  private turnIndex = 0;

  constructor(private deps: AiTurnRunnerDeps) {}

  hasPendingDefend(): boolean {
    return this.pendingDefend !== null;
  }

  start(aiTeam: TeamId, turnIndex: number): void {
    this.aiTeam = aiTeam;
    this.turnIndex = turnIndex;
    const state = this.deps.getState();
    this.entityQueue = [...state.entities.values()]
      .filter(e => e.teamId === aiTeam && !e.dead)
      .map(e => e.id);
    this.currentActions = [];
    this.actionIndex = 0;
    this.complete = false;
    this.pendingDefend = null;
  }

  step(): AiStepResult {
    const state = this.deps.getState();
    if (state.winner) return { type: "done" };
    if (this.complete) return { type: "done" };

    while (true) {
      const nextActionResult = this.tryNextAction();
      if (nextActionResult) return nextActionResult;

      if (this.entityQueue.length > 0) {
        this.loadActionsForNextEntity();
        continue;
      }

      return this.endTurn();
    }
  }

  resolveDefend(defenseResults: Record<string, number>): AiStepResult {
    if (!this.pendingDefend) return { type: "done" };
    const { action } = this.pendingDefend;
    this.pendingDefend = null;

    const defenseMap = new Map<string, number>();
    for (const [entityId, power] of Object.entries(defenseResults)) {
      defenseMap.set(entityId, defenseToMultiplier(power));
    }

    const result = resolveAction(this.deps.getState(), action, { defenseMap });
    if (result.state !== this.deps.getState()) {
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
        const ability = entity.abilities.find(a => a.id === action.abilityId);
        if (ability?.kind === "attack") {
          const targets = resolveWeaponAttack(
            entity, action.aimDirection, state.entities, ability, state.grid
          );
          const playerTargets = targets.filter(t => t.teamId !== this.aiTeam);
          if (playerTargets.length > 0) {
            this.pendingDefend = { action, targetIds: playerTargets.map(t => t.id) };
            return {
              type: "defendPrompt",
              attackerId: entity.id,
              attackerPosition: entity.position,
              aimDirection: action.aimDirection,
              ability: ability as AttackAbility,
              targetIds: playerTargets.map(t => t.id),
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
          (a: PlayerAction) => a.type === "ability" && a.entityId === entityId
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

  private endTurn(): AiStepResult {
    const state = this.deps.getState();
    const endResult = resolveAction(state, { type: "endTurn" });
    this.complete = true;
    if (endResult.state !== state) {
      this.deps.setState(endResult.state);
      return {
        type: "events",
        serializedState: serializeGameState(endResult.state),
        events: endResult.events,
        won: !!endResult.state.winner,
      };
    }
    return { type: "done" };
  }
}
