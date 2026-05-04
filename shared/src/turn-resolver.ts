import type { ActionResult, AttackHit, Entity, GameEvent, GameState, PlayerAction, TeamId } from "./types.js";
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

const NO_CHANGE = (state: GameState): ActionResult => ({ state, events: [] });

function resolveMove(
  state: GameState,
  entityId: string,
  destination: { x: number; y: number }
): ActionResult {
  const entity = state.entities.get(entityId);
  if (!entity) return NO_CHANGE(state);
  if (entity.teamId !== state.activeTeam) return NO_CHANGE(state);
  if (entity.hasAttackedThisTurn && !entity.canMoveAfterAttack) return NO_CHANGE(state);

  const dist = distance(entity.position, destination);
  if (dist > entity.movementRemaining + 0.01) return NO_CHANGE(state);
  if (!isPositionWalkable(state.grid, destination, entity.collisionRadius))
    return NO_CHANGE(state);
  if (!isWithinBounds(state.grid, destination, entity.collisionRadius))
    return NO_CHANGE(state);
  if (entitiesOverlap(destination, entity.collisionRadius, state.entities, entityId))
    return NO_CHANGE(state);

  const from = entity.position;
  const entities = new Map(state.entities);
  entities.set(entityId, {
    ...entity,
    position: destination,
    movementRemaining: entity.movementRemaining - dist,
  });
  return {
    state: { ...state, entities },
    events: [{ type: "move", entityId, from, to: destination }],
  };
}

function resolveAttack(
  state: GameState,
  entityId: string,
  aimDirection: { x: number; y: number }
): ActionResult {
  const entity = state.entities.get(entityId);
  if (!entity) return NO_CHANGE(state);
  if (entity.teamId !== state.activeTeam) return NO_CHANGE(state);
  if (entity.actionsRemaining < entity.weapon.actionCost) return NO_CHANGE(state);

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

  let hits: readonly AttackHit[] = [];
  if (targets.length > 0) {
    const result = applyDamage(newState, targets, entity.weapon.damage);
    newState = result.state;
    hits = result.hits;
  }

  return {
    state: { ...newState, winner: checkWinner(newState) },
    events: [{ type: "attack", attackerId: entityId, hits }],
  };
}

function resolveEndTurn(state: GameState): ActionResult {
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
    state: {
      ...state,
      entities,
      activeTeam: nextTeam,
      turnNumber: state.turnNumber + 1,
    },
    events: [{ type: "endTurn", nextTeam }],
  };
}

export function resolveAction(
  state: GameState,
  action: PlayerAction
): ActionResult {
  if (state.winner) return NO_CHANGE(state);

  switch (action.type) {
    case "move":
      return resolveMove(state, action.entityId, action.destination);
    case "attack":
      return resolveAttack(state, action.entityId, action.aimDirection);
    case "endTurn":
      return resolveEndTurn(state);
  }
}
