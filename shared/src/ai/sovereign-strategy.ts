/**
 * Adapter that lets Sovereign be used as a regular `AiStrategy` — the same interface that
 * scripted strategies (rush/kite/threat) implement. The `AiController` dispatches to this
 * for any entity whose `strategy` is "crazy", "crafty", or "genius".
 *
 * Sovereign needs a `turnIndex` that the basic `AiStrategy.planActions(entity, state)` doesn't
 * carry — we supply it from an internal per-instance turn counter. The search budget is
 * deterministic (SearchParams.nodeBudget), so no wall-clock deadline is plumbed in.
 */
import type { AiStrategy } from "./strategy.js";
import type { AiStrategyType, Entity, GameState, PlayerAction } from "../core/types.js";
import { ShapeKind } from "../core/types.js";
import {
  HeroController, makeSovereign, PRESETS,
  FIGHTER_WEIGHTS, TANK_WEIGHTS, RANGED_WEIGHTS,
} from "./sovereign.js";

const SOVEREIGN_PRESETS = { crazy: PRESETS.crazy, crafty: PRESETS.crafty, genius: PRESETS.genius } as const;
export type SovereignStrategyName = keyof typeof SOVEREIGN_PRESETS;

export function isSovereignStrategy(s: AiStrategyType | undefined): s is SovereignStrategyName {
  return s === "crazy" || s === "crafty" || s === "genius";
}

/**
 * Pick role-matched eval weights for an entity. Hero-class entities (the in-game player template)
 * are 120-HP fighters by default; bigger entities get tank weights; lightweight ranged kits
 * (Point/long-Circle attacks) get ranged weights.
 */
function pickWeights(entity: Entity) {
  const hasLongRanged = entity.abilities.some(a => a.kind === "attack" && a.shape.kind === ShapeKind.Point);
  if (entity.maxHp >= 200) return TANK_WEIGHTS;
  if (hasLongRanged) return RANGED_WEIGHTS;
  return FIGHTER_WEIGHTS;
}

class SovereignAiStrategy implements AiStrategy {
  private turnCount = 0;
  constructor(private readonly brain: HeroController) {}

  planActions(entity: Entity, state: GameState): PlayerAction[] {
    this.turnCount++;
    const actions = this.brain({
      state,
      heroId: entity.id,
      turnIndex: this.turnCount,
    });
    // Sovereign only emits ability actions for its own hero. Filter defensively.
    return actions.filter(a => a.type === "ability" && a.entityId === entity.id);
  }
}

/**
 * Build an `AiStrategy` backed by Sovereign for the given preset name. Each entity gets its
 * own instance (so the internal `turnCount` is per-entity).
 */
export function makeSovereignAiStrategy(preset: SovereignStrategyName, entity: Entity): AiStrategy {
  const params = SOVEREIGN_PRESETS[preset];
  const weights = pickWeights(entity);
  const brain = makeSovereign(weights, params);
  return new SovereignAiStrategy(brain);
}
