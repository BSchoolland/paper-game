import type { Entity, EntityId, GameState, PlayerAction } from "../types.js";
import { distance } from "../vec2.js";
import { resolveAction } from "../turn-resolver.js";
import type { AiStrategy } from "./strategy.js";
import { strategyForEntity } from "./strategy.js";

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
    const actions: PlayerAction[] = [];
    let simState = state;

    const aiEntities = [...state.entities.values()]
      .filter((e) => e.teamId === aiTeam)
      .sort((a, b) => closestEnemyDist(a, state) - closestEnemyDist(b, state));

    for (const entity of aiEntities) {
      const strategy = this.getStrategy(entity);
      const planned = strategy.planActions(entity, simState);

      for (const action of planned) {
        const result = resolveAction(simState, action);
        if (result.state !== simState) {
          actions.push(action);
          simState = result.state;
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
}
