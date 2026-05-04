import type { Entity, EntityId, GameState, PlayerAction } from "../types.js";
import { distance } from "../vec2.js";
import { resolveAction } from "../turn-resolver.js";
import type { AiStrategy } from "./strategy.js";
import { strategyForEntity, ThreatStrategy } from "./strategy.js";

function closestEnemyDist(entity: Entity, state: GameState): number {
  let best = Infinity;
  for (const other of state.entities.values()) {
    if (other.teamId === entity.teamId) continue;
    const d = distance(entity.position, other.position);
    if (d < best) best = d;
  }
  return best;
}

export class AiController {
  private strategies = new Map<EntityId, AiStrategy>();

  computeActions(state: GameState, aiTeam: "red" | "blue"): PlayerAction[] {
    this.processEvents(state, aiTeam);

    const actions: PlayerAction[] = [];
    let simState = state;

    const aiEntities = [...state.entities.values()]
      .filter((e) => e.teamId === aiTeam)
      .sort((a, b) => closestEnemyDist(a, state) - closestEnemyDist(b, state));

    for (const entity of aiEntities) {
      const strategy = this.getStrategy(entity);
      const planned = strategy.planActions(entity, simState);

      for (const action of planned) {
        const next = resolveAction(simState, action);
        if (next !== simState) {
          actions.push(action);
          simState = next;
          if (action.type === "attack") {
            simState = resolveAction(simState, {
              type: "applyDamage",
              entityId: action.entityId,
              aimDirection: action.aimDirection,
            });
          }
        }
      }
    }

    actions.push({ type: "endTurn" });
    return actions;
  }

  private getStrategy(entity: Entity): AiStrategy {
    let strategy = this.strategies.get(entity.id);
    if (!strategy) {
      strategy = strategyForEntity(entity);
      this.strategies.set(entity.id, strategy);
    }
    return strategy;
  }

  private processEvents(state: GameState, aiTeam: "red" | "blue") {
    for (const event of state.events) {
      if (event.type === "damage") {
        const target = state.entities.get(event.targetId);
        if (!target || target.teamId !== aiTeam) continue;

        const strategy = this.getStrategy(target);
        if (strategy instanceof ThreatStrategy) {
          strategy.notifyDamaged(event.attackerId);
        }
      }
    }
  }
}

/** Stateless convenience wrapper for backwards compat */
export function computeAiActions(
  state: GameState,
  aiTeam: "red" | "blue",
  _strategyMap?: Map<string, AiStrategy>
): PlayerAction[] {
  const controller = new AiController();
  return controller.computeActions(state, aiTeam);
}
