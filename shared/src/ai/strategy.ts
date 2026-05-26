import { ShapeKind } from "../core/types.js";
import type { AiStrategyType, AttackAbility, Entity, GameState, MoveAbility, PlayerAction, Vec2 } from "../core/types.js";
import { distance, sub, normalize, add, scale } from "../core/vec2.js";
import { pathfindMove } from "../map/pathfinding.js";
import { canAffordAbility } from "../combat/ability-cost.js";
import { getEffectiveDistance } from "../combat/status-modifiers.js";
import { resolveAction } from "../combat/turn-resolver.js";
import { resolveWeaponAttack } from "../combat/combat.js";

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

/**
 * The AI never trusts a prediction it can't verify. Every candidate action is run through the
 * real resolver against the working state; `apply` returns the resulting state, or `null` if the
 * resolver rejected it (unaffordable, out of range, into a wall, ...). Strategies thread that
 * state forward so a follow-up action is planned against where the entity actually ended up.
 */
function apply(state: GameState, action: PlayerAction): GameState | null {
  const result = resolveAction(state, action);
  return result.state === state ? null : result.state;
}

function aimAt(attacker: Entity, ability: AttackAbility, target: Entity): PlayerAction {
  return {
    type: "ability",
    entityId: attacker.id,
    abilityId: ability.id,
    aimDirection: sub(target.position, attacker.position),
  };
}

interface AttackProbe {
  readonly inRange: boolean;
  readonly blocked: boolean;
  readonly hits: Entity[];
}

function probeAttack(state: GameState, attacker: Entity, ability: AttackAbility, target: Entity): AttackProbe {
  const d = distance(attacker.position, target.position);
  if (d > getAttackRange(ability) + target.collisionRadius) {
    return { inRange: false, blocked: false, hits: [] };
  }
  const aim = sub(target.position, attacker.position);
  if (aim.x === 0 && aim.y === 0) return { inRange: true, blocked: false, hits: [] };
  const hits = resolveWeaponAttack(attacker, aim, state.entities, ability, state.grid);
  const connects = hits.some(e => e.id === target.id);
  return { inRange: true, blocked: !connects, hits };
}

/** Attack `target` now if in range (even into cover — the blocked shot is visual feedback that
 *  makes cover feel impactful); otherwise close the distance and attack from where we land. */
function pursue(entity: Entity, target: Entity, state: GameState): PlayerAction[] {
  const attack = getAttackAbility(entity);
  if (attack && canAffordAbility(entity, attack) && probeAttack(state, entity, attack, target).inRange) {
    return [aimAt(entity, attack, target)];
  }

  const moveAbility = getMoveAbility(entity);
  if (!moveAbility || !canAffordAbility(entity, moveAbility)) return [];

  const moveDistance = getEffectiveDistance(entity, moveAbility.distance);
  const destination = pathfindMove(entity, target.position, state.grid, state.entities, moveDistance);
  if (!destination) return [];

  const move: PlayerAction = { type: "ability", entityId: entity.id, abilityId: moveAbility.id, destination };
  const afterMove = apply(state, move);
  if (!afterMove) return [];

  const actions: PlayerAction[] = [move];
  const movedSelf = afterMove.entities.get(entity.id);
  const movedTarget = afterMove.entities.get(target.id);
  const attackAfter = movedSelf ? getAttackAbility(movedSelf) : null;
  if (movedSelf && movedTarget && !movedTarget.dead && attackAfter
      && canAffordAbility(movedSelf, attackAfter)
      && probeAttack(afterMove, movedSelf, attackAfter, movedTarget).inRange) {
    actions.push(aimAt(movedSelf, attackAfter, movedTarget));
  }
  return actions;
}

export const rushStrategy: AiStrategy = {
  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const target = closestEnemy(entity, state);
    return target ? pursue(entity, target, state) : [];
  },
};

export const kiteStrategy: AiStrategy = {
  planActions(entity: Entity, state: GameState): PlayerAction[] {
    const target = closestEnemy(entity, state);
    if (!target) return [];

    const attackAbility = getAttackAbility(entity);
    if (!attackAbility) return [];

    const dist = distance(entity.position, target.position);
    const preferredMin = getAttackRange(attackAbility) * 0.5;
    if (dist < preferredMin) {
      const actions: PlayerAction[] = [];
      let working = state;
      if (canAffordAbility(entity, attackAbility)
          && probeAttack(working, entity, attackAbility, target).inRange) {
        const shot = aimAt(entity, attackAbility, target);
        actions.push(shot);
        working = apply(working, shot) ?? working;
      }
      const self = working.entities.get(entity.id) ?? entity;
      const retreat = findRetreatPos(self, target, working);
      const moveAbility = getMoveAbility(self);
      if (retreat && moveAbility) {
        actions.push({ type: "ability", entityId: self.id, abilityId: moveAbility.id, destination: retreat });
      }
      if (actions.length > 0) return actions;
    }

    return pursue(entity, target, state);
  },
};

function findRetreatPos(entity: Entity, threat: Entity, state: GameState): Vec2 | null {
  const moveAbility = getMoveAbility(entity);
  if (!moveAbility || !canAffordAbility(entity, moveAbility)) return null;
  const moveDistance = getEffectiveDistance(entity, moveAbility.distance);

  const awayDir = normalize(sub(entity.position, threat.position));
  const retreatTarget = add(entity.position, scale(awayDir, moveDistance));

  const dest = pathfindMove(entity, retreatTarget, state.grid, state.entities, moveDistance);
  if (dest && distance(dest, threat.position) > distance(entity.position, threat.position)) {
    return dest;
  }

  for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = { x: awayDir.x * cos - awayDir.y * sin, y: awayDir.x * sin + awayDir.y * cos };
    const altTarget = add(entity.position, scale(rotated, moveDistance));
    const altDest = pathfindMove(entity, altTarget, state.grid, state.entities, moveDistance);
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
    if (this.threatTarget) {
      const tracked = state.entities.get(this.threatTarget);
      if (!tracked || tracked.dead) this.threatTarget = null;
    }

    const target = (this.threatTarget ? state.entities.get(this.threatTarget) : null) ?? closestEnemy(entity, state);
    return target ? pursue(entity, target, state) : [];
  }
}

export function strategyForEntity(entity: Entity): AiStrategy {
  const type: AiStrategyType = entity.strategy ?? "rush";
  switch (type) {
    case "kite": return kiteStrategy;
    case "threat": return new ThreatStrategy();
    case "rush": return rushStrategy;
    // "smart" entities are meant to be driven by a HeroController. Sovereign-backed
    // strategies ("crazy"/"crafty"/"genius") are dispatched in ai-runner.ts before this
    // function is reached. If scripted AI ends up running one (rollout fallback, etc.),
    // behave as a basic rusher.
    case "smart":
    case "crazy":
    case "crafty":
    case "genius":
      return rushStrategy;
  }
}
