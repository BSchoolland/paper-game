import type { AbilityDefinition, ActionResult, AimDirection, AttackAbility, AttackHit, BarrierAbility, Entity, EnergyPool, GameEvent, GameState, MoveAbility, PlayerAction, TeamId } from "../core/types.js";
import { distance } from "../core/vec2.js";
import { canAffordAbility, getAbilityCost } from "./ability-cost.js";
import { isPositionWalkable, isWithinBounds } from "../map/collision-grid.js";
import { resolveWeaponAttack, applyDamage } from "./combat.js";
import { processEffects } from "../encounter/effects.js";
import { getEffectiveDistance, getEffectiveRegen } from "./status-modifiers.js";

function checkWinner(state: GameState): TeamId | null {
  let hasRed = false;
  let hasBlue = false;
  for (const entity of state.entities.values()) {
    if (entity.dead) continue;
    if (entity.teamId === "red") hasRed = true;
    if (entity.teamId === "blue") hasBlue = true;
    if (hasRed && hasBlue) return null;
  }
  if (!hasRed) return "blue";
  if (!hasBlue) return "red";
  return null;
}

function entitiesOverlap(
  pos: { x: number; y: number },
  radius: number,
  entities: ReadonlyMap<string, Entity>,
  excludeId: string
): boolean {
  for (const e of entities.values()) {
    if (e.id === excludeId || e.dead) continue;
    const dist = distance(pos, e.position);
    if (dist < radius + e.collisionRadius) return true;
  }
  return false;
}

const NO_CHANGE = (state: GameState): ActionResult => ({ state, events: [] });

function spendEnergy(energy: EnergyPool, cost: { red?: number; blue?: number }): EnergyPool {
  return {
    ...energy,
    red: energy.red - (cost.red ?? 0),
    blue: energy.blue - (cost.blue ?? 0),
  };
}

function findAbility(entity: Entity, abilityId: string): AbilityDefinition | undefined {
  return entity.abilities.find(a => a.id === abilityId);
}

function resolveMove(
  state: GameState,
  entity: Entity,
  ability: MoveAbility,
  destination: { x: number; y: number }
): ActionResult {
  const entityId = entity.id;
  const maxDistance = getEffectiveDistance(entity, ability.distance);
  const dist = distance(entity.position, destination);
  if (dist > maxDistance + 0.01) return NO_CHANGE(state);
  if (!isPositionWalkable(state.grid, destination, entity.collisionRadius))
    return NO_CHANGE(state);
  if (!isWithinBounds(state.grid, destination, entity.collisionRadius))
    return NO_CHANGE(state);
  if (entitiesOverlap(destination, entity.collisionRadius, state.entities, entityId))
    return NO_CHANGE(state);

  const actualCost = getAbilityCost(ability, { distance: dist });
  if ((actualCost.red ?? 0) > entity.energy.red || (actualCost.blue ?? 0) > entity.energy.blue)
    return NO_CHANGE(state);

  const from = entity.position;
  const entities = new Map(state.entities);
  entities.set(entityId, {
    ...entity,
    position: destination,
    energy: spendEnergy(entity.energy, actualCost),
  });
  return {
    state: { ...state, entities },
    events: [{ type: "move", entityId, from, to: destination }],
  };
}

function resolveAttack(
  state: GameState,
  entity: Entity,
  ability: AttackAbility,
  aimDirection: AimDirection
): ActionResult {
  const entityId = entity.id;

  const targets = resolveWeaponAttack(
    entity,
    aimDirection,
    state.entities,
    ability,
    state.grid
  );

  const entities = new Map(state.entities);
  entities.set(entityId, {
    ...entity,
    energy: spendEnergy(entity.energy, ability.cost),
  });
  let newState: GameState = { ...state, entities };

  let hits: readonly AttackHit[] = [];
  if (targets.length > 0) {
    const result = applyDamage(newState, targets, ability.damage);
    newState = result.state;
    hits = result.hits;
  }

  let result: ActionResult = {
    state: newState,
    events: [{
      type: "attack",
      attackerId: entityId,
      attackerPosition: entity.position,
      aimDirection,
      ability,
      hits,
    }],
  };

  result = processEffects(result);

  return {
    state: { ...result.state, winner: checkWinner(result.state) },
    events: result.events,
  };
}

function resolveBarrier(
  state: GameState,
  entity: Entity,
  ability: BarrierAbility
): ActionResult {
  const entityId = entity.id;
  const entities = new Map(state.entities);
  entities.set(entityId, {
    ...entity,
    energy: spendEnergy(entity.energy, ability.cost),
    barrier: entity.barrier + ability.barrierHp,
  });

  return {
    state: { ...state, entities },
    events: [{ type: "barrier", entityId, barrierHp: ability.barrierHp }],
  };
}

function resolveAbility(
  state: GameState,
  entityId: string,
  abilityId: string,
  aimDirection?: AimDirection,
  destination?: { x: number; y: number }
): ActionResult {
  const entity = state.entities.get(entityId);
  if (!entity || entity.dead) return NO_CHANGE(state);
  if (entity.teamId !== state.activeTeam) return NO_CHANGE(state);

  const ability = findAbility(entity, abilityId);
  if (!ability) return NO_CHANGE(state);
  if (!canAffordAbility(entity, ability)) return NO_CHANGE(state);

  const nextCount = state.actionCount + 1;

  let result: ActionResult;
  switch (ability.kind) {
    case "move": {
      if (!destination) return NO_CHANGE(state);
      result = resolveMove(state, entity, ability, destination);
      break;
    }
    case "attack": {
      if (!aimDirection) return NO_CHANGE(state);
      result = resolveAttack(state, entity, ability, aimDirection);
      break;
    }
    case "barrier":
      result = resolveBarrier(state, entity, ability);
      break;
  }

  if (result.state === state) return result;
  return { ...result, state: { ...result.state, actionCount: nextCount } };
}

function tickStatusEffects(
  entities: Map<string, Entity>,
  team: TeamId
): { entities: Map<string, Entity>; events: GameEvent[] } {
  const events: GameEvent[] = [];

  for (const [id, entity] of entities) {
    if (entity.dead || entity.teamId !== team) continue;
    const statuses = entity.statusEffects;
    if (!statuses || statuses.length === 0) continue;

    const remaining = statuses
      .map(s => ({ ...s, duration: s.duration - 1 }))
      .filter(s => s.duration > 0);

    entities.set(id, { ...entity, statusEffects: remaining.length > 0 ? remaining : undefined });
  }

  return { entities, events };
}

function resolveEndTurn(state: GameState): ActionResult {
  const nextTeam: TeamId = state.activeTeam === "red" ? "blue" : "red";

  const endState: GameState = {
    ...state,
    activeTeam: nextTeam,
    turnNumber: state.turnNumber + 1,
  };

  const startResult = startTurn(endState, nextTeam);

  return {
    state: {
      ...startResult.state,
      winner: checkWinner(startResult.state),
    },
    events: [{ type: "endTurn", nextTeam }, ...startResult.events],
  };
}

/**
 * The single canonical "a turn begins for `team`" transition: regenerate that team's banked
 * energy (after status penalties, clamped to the cap), clear their one-turn barrier, and tick
 * down their status durations. Called both when a turn flips (`resolveEndTurn`) and when a
 * fresh game starts (`createGameState`), so turn 1 behaves exactly like every other turn.
 */
export function startTurn(state: GameState, team: TeamId): ActionResult {
  const entities = new Map<string, Entity>();
  for (const [id, entity] of state.entities) {
    if (entity.dead) {
      entities.set(id, entity);
    } else if (entity.teamId === team) {
      entities.set(id, {
        ...entity,
        energy: {
          ...entity.energy,
          red: Math.min(entity.energy.red + getEffectiveRegen(entity, "red", entity.energy.regenRed), entity.energy.maxRed),
          blue: Math.min(entity.energy.blue + getEffectiveRegen(entity, "blue", entity.energy.regenBlue), entity.energy.maxBlue),
        },
        barrier: 0,
      });
    } else {
      entities.set(id, entity);
    }
  }

  const tick = tickStatusEffects(entities, team);

  return {
    state: { ...state, entities: tick.entities },
    events: [{ type: "turnStart", team }, ...tick.events],
  };
}

/**
 * The one way to spell a fresh game state. Sets the initial scalar fields and immediately runs
 * the starting team's turn-start, so callers only supply the board (entities, grid, map).
 */
export function createGameState(init: {
  entities: GameState["entities"];
  grid: GameState["grid"];
  mapDefinition: GameState["mapDefinition"];
  startingTeam?: TeamId;
}): GameState {
  const team = init.startingTeam ?? "red";
  return startTurn(
    {
      entities: init.entities,
      grid: init.grid,
      mapDefinition: init.mapDefinition,
      activeTeam: team,
      turnNumber: 1,
      winner: null,
      nextSpawnId: 0,
      actionCount: 0,
    },
    team,
  ).state;
}

export function resolveAction(
  state: GameState,
  action: PlayerAction
): ActionResult {
  if (state.winner) return NO_CHANGE(state);

  switch (action.type) {
    case "ability":
      return resolveAbility(state, action.entityId, action.abilityId, action.aimDirection, action.destination);
    case "endTurn":
      return resolveEndTurn(state);
  }
}
