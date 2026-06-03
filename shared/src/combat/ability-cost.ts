import type { AbilityDefinition, EnergyCost, Entity, GameState, MoveAbility } from "../core/types.js";

export interface AbilityCostContext {
  readonly distance?: number;
}

export function getAbilityCost(ability: AbilityDefinition, context?: AbilityCostContext): EnergyCost {
  if (!ability.variableCost) return ability.cost;
  if (context?.distance !== undefined && ability.kind === "move") {
    return { blue: context.distance <= ability.distance / 2 ? 1 : 2 };
  }
  return ability.cost;
}

export function getMinAbilityCost(ability: AbilityDefinition): EnergyCost {
  if (!ability.variableCost) return ability.cost;
  return {
    red: ability.cost.red ? 1 : undefined,
    blue: ability.cost.blue ? 1 : undefined,
  };
}

export function canAffordAbility(entity: Entity, ability: AbilityDefinition): boolean {
  const min = getMinAbilityCost(ability);
  if ((min.red ?? 0) > entity.energy.red) return false;
  if ((min.blue ?? 0) > entity.energy.blue) return false;
  return true;
}

/** True if this entity is alive and can still afford at least one of its abilities. */
export function entityHasAffordableAction(entity: Entity): boolean {
  if (entity.dead) return false;
  for (const ability of entity.abilities) {
    if (canAffordAbility(entity, ability)) return true;
  }
  return false;
}

export function shouldAutoEndTurn(state: GameState): boolean {
  for (const entity of state.entities.values()) {
    if (entity.teamId !== state.activeTeam) continue;
    if (entityHasAffordableAction(entity)) return false;
  }
  return true;
}
