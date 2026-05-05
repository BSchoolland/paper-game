import type { AiStrategyType, Entity, GameState, PlayerAction, Vec2 } from "../types.js";
import { distance, sub, normalize, add, scale } from "../vec2.js";
import { pathfindMove } from "../pathfinding.js";
import { isPositionWalkable, isWithinBounds } from "../collision-grid.js";

export interface AiStrategy {
  planActions(entity: Entity, state: GameState): PlayerAction[];
}

function closestEnemy(entity: Entity, state: GameState): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const other of state.entities.values()) {
    if (other.teamId === entity.teamId) continue;
    const d = distance(entity.position, other.position);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

function getAttackRange(entity: Entity): number {
  const shape = entity.weapon.shape;
  switch (shape.kind) {
    case "point": return shape.range;
    case "sector": return shape.radius;
    case "rectangle": return shape.length;
    default: return 80;
  }
}

function tryAttack(
  entity: Entity,
  target: Entity,
  fromPos: Vec2,
  actions: PlayerAction[]
): boolean {
  const attackRange = getAttackRange(entity);
  if (distance(fromPos, target.position) <= attackRange + target.collisionRadius
    && entity.actionsRemaining > 0) {
    const dir = normalize(sub(target.position, fromPos));
    actions.push({ type: "attack", entityId: entity.id, aimDirection: dir });
    return true;
  }
  return false;
}

/** Charges straight at the closest enemy, attacks when in range. */
export const rushStrategy: AiStrategy = {
  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const actions: PlayerAction[] = [];
    const target = closestEnemy(entity, state);
    if (!target) return actions;

    if (tryAttack(entity, target, entity.position, actions)) return actions;

    const destination = pathfindMove(
      entity, target.position, state.grid, state.entities
    );
    if (destination) {
      actions.push({ type: "move", entityId: entity.id, destination });
      tryAttack(entity, target, destination, actions);
    }

    return actions;
  },
};

/** Stays at range, attacks from a distance. Retreats if enemies get too close. */
export const kiteStrategy: AiStrategy = {
  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const actions: PlayerAction[] = [];
    const target = closestEnemy(entity, state);
    if (!target) return actions;

    const dist = distance(entity.position, target.position);
    const attackRange = getAttackRange(entity);
    const preferredMin = attackRange * 0.5;

    const tooClose = dist < preferredMin;

    if (tooClose && entity.canMoveAfterAttack) {
      if (tryAttack(entity, target, entity.position, actions)) {
        const retreatPos = findRetreatPos(entity, target, state);
        if (retreatPos) {
          actions.push({ type: "move", entityId: entity.id, destination: retreatPos });
        }
        return actions;
      }
    }

    if (tooClose) {
      const retreatPos = findRetreatPos(entity, target, state);
      if (retreatPos) {
        actions.push({ type: "move", entityId: entity.id, destination: retreatPos });
        tryAttack(entity, target, retreatPos, actions);
        return actions;
      }
    }

    if (tryAttack(entity, target, entity.position, actions)) return actions;

    const destination = pathfindMove(
      entity, target.position, state.grid, state.entities
    );
    if (destination) {
      actions.push({ type: "move", entityId: entity.id, destination });
      tryAttack(entity, target, destination, actions);
    }

    return actions;
  },
};

function findRetreatPos(entity: Entity, threat: Entity, state: GameState): Vec2 | null {
  const awayDir = normalize(sub(entity.position, threat.position));
  const retreatTarget = add(entity.position, scale(awayDir, entity.movementRemaining));

  const dest = pathfindMove(entity, retreatTarget, state.grid, state.entities);
  if (dest && distance(dest, threat.position) > distance(entity.position, threat.position)) {
    return dest;
  }

  for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = { x: awayDir.x * cos - awayDir.y * sin, y: awayDir.x * sin + awayDir.y * cos };
    const altTarget = add(entity.position, scale(rotated, entity.movementRemaining));
    const altDest = pathfindMove(entity, altTarget, state.grid, state.entities);
    if (altDest && distance(altDest, threat.position) > distance(entity.position, threat.position)) {
      return altDest;
    }
  }

  return null;
}

/** Behaves like rush, but locks onto whoever last damaged it until that target dies. */
export class ThreatStrategy implements AiStrategy {
  private threatTarget: string | null = null;

  notifyDamaged(byEntityId: string): void {
    this.threatTarget = byEntityId;
  }

  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const actions: PlayerAction[] = [];

    if (this.threatTarget && !state.entities.has(this.threatTarget)) {
      this.threatTarget = null;
    }

    const target = this.threatTarget
      ? state.entities.get(this.threatTarget) ?? closestEnemy(entity, state)
      : closestEnemy(entity, state);

    if (!target) return actions;

    if (tryAttack(entity, target, entity.position, actions)) return actions;

    const destination = pathfindMove(
      entity, target.position, state.grid, state.entities
    );
    if (destination) {
      actions.push({ type: "move", entityId: entity.id, destination });
      tryAttack(entity, target, destination, actions);
    }

    return actions;
  }
}

export function strategyForEntity(entity: Entity): AiStrategy {
  const type: AiStrategyType = entity.strategy ?? "rush";
  switch (type) {
    case "kite": return kiteStrategy;
    case "threat": return new ThreatStrategy();
    case "rush": return rushStrategy;
  }
}
