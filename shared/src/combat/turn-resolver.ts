import type { AbilityDefinition, ActionResult, AimDirection, AttackAbility, AttackHit, BarrierAbility, Entity, EnergyPool, GameEvent, GameState, MoveAbility, PlayerAction, TeamId, Vec2, ZoneAbility } from "../core/types.js";
import { distance, add, scale, normalize, length } from "../core/vec2.js";
import { canAffordAbility, getAbilityCost } from "./ability-cost.js";
import { canEntityOccupy } from "./movement.js";
import { playerMovePath } from "../map/pathfinding.js";
import { resolveWeaponAttack, applyDamage } from "./combat.js";
import { processEffects } from "../encounter/effects.js";
import { getEffectiveDistance, getEffectiveRegen } from "./status-modifiers.js";
import { createZone, canPlaceWallZone, tickZones } from "./zones.js";
import { powerToMultiplier, scaleAttack } from "./power.js";

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
  destination: { x: number; y: number },
  pathBased: boolean
): ActionResult {
  const entityId = entity.id;
  const maxDistance = getEffectiveDistance(entity, ability.distance);
  if (!canEntityOccupy(state, entity, destination)) return NO_CHANGE(state);

  // `pathBased` (player moves): cost = the route the body actually travels around obstacles, and the
  // move is illegal if no such route fits within budget. Default (AI / scripted): cheap straight-line
  // distance + endpoint check — the historical behaviour, no per-resolve pathfinding.
  let dist: number;
  if (pathBased) {
    const plan = playerMovePath(entity, destination, state.grid, maxDistance);
    if (!plan.reachable) return NO_CHANGE(state);
    dist = plan.cost;
  } else {
    dist = distance(entity.position, destination);
    if (dist > maxDistance + 0.01) return NO_CHANGE(state);
  }

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
  aimDirection: AimDirection,
  power: number | undefined,
  defenseMap?: ReadonlyMap<string, number>
): ActionResult {
  const entityId = entity.id;
  const scaled = scaleAttack(ability, powerToMultiplier(power));

  const targets = resolveWeaponAttack(
    entity,
    aimDirection,
    state.entities,
    scaled,
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
    const result = applyDamage(newState, targets, scaled.damage, defenseMap);
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
      ability: scaled,
      hits,
    }],
  };

  result = processEffects(result, defenseMap);

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
    events: [{ type: "barrier", entityId, barrierHp: ability.barrierHp, ability }],
  };
}

function resolveZone(
  state: GameState,
  entity: Entity,
  ability: ZoneAbility,
  aim: AimDirection
): ActionResult {
  const aimLen = length(aim);
  if (aimLen < 0.01) return NO_CHANGE(state);
  const dist = Math.min(aimLen, ability.range);
  const center: Vec2 = add(entity.position, scale(normalize(aim), dist));
  if (ability.zone.effect === "wall" && !canPlaceWallZone(state, center, ability.zone.radius)) return NO_CHANGE(state);

  const { state: withZone, zone } = createZone(state, center, ability.zone);
  const entities = new Map(withZone.entities);
  entities.set(entity.id, { ...entity, energy: spendEnergy(entity.energy, ability.cost) });
  return {
    state: { ...withZone, entities },
    events: [{ type: "zoneCreated", zone }],
  };
}

function resolveAbility(
  state: GameState,
  entityId: string,
  abilityId: string,
  aimDirection?: AimDirection,
  destination?: { x: number; y: number },
  power?: number,
  defenseMap?: ReadonlyMap<string, number>,
  pathBased = false
): ActionResult {
  const entity = state.entities.get(entityId);
  if (!entity || entity.dead) return NO_CHANGE(state);

  const ability = findAbility(entity, abilityId);
  if (!ability) return NO_CHANGE(state);
  if (!canAffordAbility(entity, ability)) return NO_CHANGE(state);

  const nextCount = state.actionCount + 1;

  let result: ActionResult;
  switch (ability.kind) {
    case "move": {
      if (!destination) return NO_CHANGE(state);
      result = resolveMove(state, entity, ability, destination, pathBased);
      break;
    }
    case "attack": {
      if (!aimDirection) return NO_CHANGE(state);
      result = resolveAttack(state, entity, ability, aimDirection, power, defenseMap);
      break;
    }
    case "barrier":
      result = resolveBarrier(state, entity, ability);
      break;
    case "zone": {
      if (!aimDirection) return NO_CHANGE(state);
      result = resolveZone(state, entity, ability, aimDirection);
      break;
    }
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

  // Persistent zones resolve after the active team's regen / barrier-clear / status-tick, so a
  // barrier zone can top players back up the same turn it would otherwise have been wiped.
  const zoned = tickZones({ ...state, entities: tick.entities });

  return {
    state: zoned.state,
    events: [{ type: "turnStart", team }, ...tick.events, ...zoned.events],
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
      zones: [],
      nextZoneId: 0,
    },
    team,
  ).state;
}

/**
 * Whether the active team is allowed to take `action` right now. The pure resolver no longer
 * enforces turn order — that's a session-layer rule — so authoritative callers (the server,
 * the offline store) gate on this before applying, while the preview path runs the resolver
 * directly so it can show what *would* happen on your turn.
 */
export function isActionLegal(state: GameState, action: PlayerAction): boolean {
  if (state.winner) return false;
  if (action.type === "endTurn") return true;
  const entity = state.entities.get(action.entityId);
  return !!entity && !entity.dead && entity.teamId === state.activeTeam;
}

export interface ResolveOptions {
  /** Per-target damage multipliers from defensive timing (1.0 = full damage, 0.5 = best block). */
  readonly defenseMap?: ReadonlyMap<string, number>;
  /** Skip the active-team / dead-entity check. For preview dry-runs only. */
  readonly allowOutOfTurn?: boolean;
  /** Resolve move actions as path-based (cost = body-clearance route distance, illegal if no route
   *  fits within budget) instead of straight-line. Set by trusted server code for player moves; AI
   *  call sites leave it off. Never read from the serialized action, so a client can't spoof it. */
  readonly pathBased?: boolean;
}

export function resolveAction(
  state: GameState,
  action: PlayerAction,
  options?: ResolveOptions
): ActionResult {
  if (state.winner) return NO_CHANGE(state);
  if (!options?.allowOutOfTurn && !isActionLegal(state, action)) return NO_CHANGE(state);

  switch (action.type) {
    case "ability":
      return resolveAbility(state, action.entityId, action.abilityId, action.aimDirection, action.destination, action.power, options?.defenseMap, options?.pathBased);
    case "endTurn":
      return resolveEndTurn(state);
  }
}
