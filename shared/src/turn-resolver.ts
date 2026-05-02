import type { Entity, GameState, PlayerAction, TeamId } from "./types.js";
import { distance } from "./vec2.js";
import { isPositionWalkable, isWithinBounds } from "./collision-grid.js";
import { resolveWeaponAttack, applyDamage } from "./combat.js";

function checkWinner(state: GameState): TeamId | null {
  let hasRed = false;
  let hasBlue = false;
  for (const entity of state.entities.values()) {
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
    if (e.id === excludeId) continue;
    const dist = distance(pos, e.position);
    if (dist < radius + e.collisionRadius) return true;
  }
  return false;
}

function resolveMove(
  state: GameState,
  entityId: string,
  destination: { x: number; y: number }
): GameState {
  const entity = state.entities.get(entityId);
  if (!entity) return state;
  if (entity.teamId !== state.activeTeam) return state;
  if (entity.hasAttackedThisTurn && !entity.canMoveAfterAttack) return state;

  const dist = distance(entity.position, destination);
  if (dist > entity.movementRemaining + 0.01) return state;
  if (!isPositionWalkable(state.grid, destination, entity.collisionRadius))
    return state;
  if (!isWithinBounds(state.grid, destination, entity.collisionRadius))
    return state;
  if (entitiesOverlap(destination, entity.collisionRadius, state.entities, entityId))
    return state;

  const entities = new Map(state.entities);
  entities.set(entityId, {
    ...entity,
    position: destination,
    movementRemaining: entity.movementRemaining - dist,
  });
  return { ...state, entities };
}

function resolveAttack(
  state: GameState,
  entityId: string,
  aimDirection: { x: number; y: number }
): GameState {
  const entity = state.entities.get(entityId);
  if (!entity) return state;
  if (entity.teamId !== state.activeTeam) return state;
  if (entity.actionsRemaining < entity.weapon.actionCost) return state;

  const targets = resolveWeaponAttack(
    entity,
    aimDirection,
    state.entities,
    entity.weapon,
    state.grid
  );

  const entities = new Map(state.entities);
  entities.set(entityId, {
    ...entity,
    actionsRemaining: entity.actionsRemaining - entity.weapon.actionCost,
    hasAttackedThisTurn: true,
    movementRemaining: entity.canMoveAfterAttack
      ? entity.movementRemaining
      : 0,
  });
  let newState: GameState = { ...state, entities };

  if (targets.length > 0) {
    newState = applyDamage(newState, targets, entity.weapon.damage);
  }

  return { ...newState, winner: checkWinner(newState) };
}

function resolveEndTurn(state: GameState): GameState {
  const nextTeam: TeamId = state.activeTeam === "red" ? "blue" : "red";
  const entities = new Map<string, Entity>();
  for (const [id, entity] of state.entities) {
    if (entity.teamId === nextTeam) {
      entities.set(id, {
        ...entity,
        movementRemaining: entity.movementBudget,
        actionsRemaining: 1,
        hasAttackedThisTurn: false,
      });
    } else {
      entities.set(id, entity);
    }
  }
  return {
    ...state,
    entities,
    activeTeam: nextTeam,
    turnNumber: state.turnNumber + 1,
  };
}

export function resolveAction(
  state: GameState,
  action: PlayerAction
): GameState {
  if (state.winner) return state;

  switch (action.type) {
    case "move":
      return resolveMove(state, action.entityId, action.destination);
    case "attack":
      return resolveAttack(state, action.entityId, action.aimDirection);
    case "endTurn":
      return resolveEndTurn(state);
  }
}
