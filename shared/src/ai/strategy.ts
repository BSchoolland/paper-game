import { ShapeKind } from "../core/types.js";
import type { AiStrategyType, AttackAbility, Entity, GameState, MoveAbility, PlayerAction, Vec2 } from "../core/types.js";
import { distance, sub, normalize, add, scale } from "../core/vec2.js";
import { pathfindMove } from "../map/pathfinding.js";
import { canAffordAbility } from "../combat/ability-cost.js";

export interface AiStrategy {
  planActions(entity: Entity, state: GameState): PlayerAction[];
}

function closestEnemy(entity: Entity, state: GameState): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const other of state.entities.values()) {
    if (other.teamId === entity.teamId || other.dead) continue;
    const d = distance(entity.position, other.position);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

function getMoveAbility(entity: Entity): MoveAbility | null {
  const a = entity.abilities.find(a => a.kind === "move");
  return a ? a as MoveAbility : null;
}

function getAttackAbility(entity: Entity): AttackAbility | null {
  const a = entity.abilities.find(a => a.kind === "attack");
  return a ? a as AttackAbility : null;
}

function getAttackRange(ability: AttackAbility): number {
  const shape = ability.shape;
  switch (shape.kind) {
    case ShapeKind.Point: return shape.range;
    case ShapeKind.Sector: return shape.radius;
    case ShapeKind.Rectangle: return shape.length;
    case ShapeKind.Circle: return shape.range + shape.radius;
  }
}


function tryAttack(
  entity: Entity,
  target: Entity,
  fromPos: Vec2,
  actions: PlayerAction[]
): boolean {
  const ability = getAttackAbility(entity);
  if (!ability || !canAffordAbility(entity, ability)) return false;
  const attackRange = getAttackRange(ability);
  if (distance(fromPos, target.position) <= attackRange + target.collisionRadius) {
    const dir = sub(target.position, fromPos);
    actions.push({ type: "ability", entityId: entity.id, abilityId: ability.id, aimDirection: dir });
    return true;
  }
  return false;
}

function tryMove(
  entity: Entity,
  target: Vec2,
  state: GameState,
  actions: PlayerAction[]
): Vec2 | null {
  const moveAbility = getMoveAbility(entity);
  if (!moveAbility || !canAffordAbility(entity, moveAbility)) return null;
  const destination = pathfindMove(entity, target, state.grid, state.entities, moveAbility.distance);
  if (destination) {
    actions.push({ type: "ability", entityId: entity.id, abilityId: moveAbility.id, destination });
    return destination;
  }
  return null;
}

export const rushStrategy: AiStrategy = {
  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const actions: PlayerAction[] = [];
    const target = closestEnemy(entity, state);
    if (!target) return actions;

    if (tryAttack(entity, target, entity.position, actions)) return actions;

    const movedTo = tryMove(entity, target.position, state, actions);
    if (movedTo) {
      tryAttack(entity, target, movedTo, actions);
    }

    return actions;
  },
};

export const kiteStrategy: AiStrategy = {
  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const actions: PlayerAction[] = [];
    const target = closestEnemy(entity, state);
    if (!target) return actions;

    const attackAbility = getAttackAbility(entity);
    if (!attackAbility) return actions;

    const dist = distance(entity.position, target.position);
    const attackRange = getAttackRange(attackAbility);
    const preferredMin = attackRange * 0.5;
    const tooClose = dist < preferredMin;

    if (tooClose) {
      tryAttack(entity, target, entity.position, actions);
      const retreatPos = findRetreatPos(entity, target, state);
      if (retreatPos) {
        actions.push({ type: "ability", entityId: entity.id, abilityId: "move", destination: retreatPos });
      }
      if (actions.length > 0) return actions;
    }

    if (tryAttack(entity, target, entity.position, actions)) return actions;

    const movedTo = tryMove(entity, target.position, state, actions);
    if (movedTo) {
      tryAttack(entity, target, movedTo, actions);
    }

    return actions;
  },
};

function findRetreatPos(entity: Entity, threat: Entity, state: GameState): Vec2 | null {
  const moveAbility = getMoveAbility(entity);
  if (!moveAbility || !canAffordAbility(entity, moveAbility)) return null;

  const awayDir = normalize(sub(entity.position, threat.position));
  const retreatTarget = add(entity.position, scale(awayDir, moveAbility.distance));

  const dest = pathfindMove(entity, retreatTarget, state.grid, state.entities, moveAbility.distance);
  if (dest && distance(dest, threat.position) > distance(entity.position, threat.position)) {
    return dest;
  }

  for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = { x: awayDir.x * cos - awayDir.y * sin, y: awayDir.x * sin + awayDir.y * cos };
    const altTarget = add(entity.position, scale(rotated, moveAbility.distance));
    const altDest = pathfindMove(entity, altTarget, state.grid, state.entities, moveAbility.distance);
    if (altDest && distance(altDest, threat.position) > distance(entity.position, threat.position)) {
      return altDest;
    }
  }

  return null;
}

export class ThreatStrategy implements AiStrategy {
  private threatTarget: string | null = null;

  notifyDamaged(byEntityId: string): void {
    this.threatTarget = byEntityId;
  }

  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const actions: PlayerAction[] = [];

    if (this.threatTarget) {
      const tracked = state.entities.get(this.threatTarget);
      if (!tracked || tracked.dead) this.threatTarget = null;
    }

    const target = this.threatTarget
      ? state.entities.get(this.threatTarget) ?? closestEnemy(entity, state)
      : closestEnemy(entity, state);

    if (!target) return actions;

    if (tryAttack(entity, target, entity.position, actions)) return actions;

    const movedTo = tryMove(entity, target.position, state, actions);
    if (movedTo) {
      tryAttack(entity, target, movedTo, actions);
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
