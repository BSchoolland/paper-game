import { ShapeKind } from "../core/types.js";
import type { AbilityDefinition, AiStrategyType, AttackAbility, Entity, GameState, MoveAbility, PlayerAction, Vec2, ZoneAbility } from "../core/types.js";
import { distance, sub, normalize, add, scale, length } from "../core/vec2.js";
import { pathfindMove } from "../map/pathfinding.js";
import { canAffordAbility } from "../combat/ability-cost.js";
import { abilityReady } from "../combat/kit.js";
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

// ---------------------------------------------------------------------------
// Kit selection. An entity is "kit-driven" when any of its abilities carries kit metadata;
// everything else keeps the historical single-attack behavior (first attack in the list).
// Resolver-enforced gates (cooldown, HP phases) live in combat/kit.ts; this layer adds the
// selection heuristics (`priority`, `minTargets`) on top.
// ---------------------------------------------------------------------------

function hasKit(entity: Entity): boolean {
  return entity.abilities.some(a => a.kit !== undefined);
}

function byPriorityDesc(a: AbilityDefinition, b: AbilityDefinition): number {
  return (b.kit?.priority ?? 0) - (a.kit?.priority ?? 0);
}

function usableKitAttacks(entity: Entity): AttackAbility[] {
  return entity.abilities
    .filter((a): a is AttackAbility =>
      a.kind === "attack" && canAffordAbility(entity, a) && abilityReady(entity, a))
    .sort(byPriorityDesc);
}

interface AttackChoice {
  readonly ability: AttackAbility;
  /** False = the shot is in range but doesn't reach the target (fired into cover for feedback). */
  readonly connects: boolean;
}

/**
 * Pick the attack to use against `target` from the current position, or null if nothing is in
 * range. Kit-driven entities scan usable attacks in priority order, preferring one that connects
 * and meets its `minTargets`; if none connects, the best in-range single-target option is fired
 * into cover (the historical "blocked shot as feedback" behavior). Non-kit entities keep the
 * exact legacy pick: the first attack in the list.
 */
function pickAttack(state: GameState, entity: Entity, target: Entity): AttackChoice | null {
  if (!hasKit(entity)) {
    const attack = getAttackAbility(entity);
    if (!attack || !canAffordAbility(entity, attack)) return null;
    const probe = probeAttack(state, entity, attack, target);
    return probe.inRange ? { ability: attack, connects: !probe.blocked } : null;
  }

  let intoCover: AttackAbility | null = null;
  for (const attack of usableKitAttacks(entity)) {
    const probe = probeAttack(state, entity, attack, target);
    if (!probe.inRange) continue;
    const minTargets = attack.kit?.minTargets ?? 1;
    if (!probe.blocked && probe.hits.length >= minTargets) return { ability: attack, connects: true };
    if (!intoCover && minTargets <= 1) intoCover = attack;
  }
  return intoCover ? { ability: intoCover, connects: false } : null;
}

/** Max reach among the attacks this entity could actually use right now (kit gates applied). */
function bestUsableRange(entity: Entity): number {
  const attacks = hasKit(entity)
    ? usableKitAttacks(entity)
    : entity.abilities.filter((a): a is AttackAbility => a.kind === "attack");
  let range = 0;
  for (const a of attacks) range = Math.max(range, getAttackRange(a));
  return range;
}

function mostWoundedAlly(entity: Entity, state: GameState): Entity {
  let best = entity;
  let bestFrac = (entity.hp + entity.barrier) / entity.maxHp;
  for (const other of state.entities.values()) {
    if (other.teamId !== entity.teamId || other.dead) continue;
    const frac = (other.hp + other.barrier) / other.maxHp;
    if (frac < bestFrac) {
      bestFrac = frac;
      best = other;
    }
  }
  return best;
}

function countInZone(state: GameState, entity: Entity, center: Vec2, radius: number): number {
  let count = 0;
  for (const other of state.entities.values()) {
    if (other.teamId === entity.teamId || other.dead) continue;
    if (distance(center, other.position) <= radius + other.collisionRadius) count++;
  }
  return count;
}

/**
 * One support cast per turn for kit-driven entities: the highest-priority usable zone/barrier
 * ability that itself carries a kit rule (opt-in — legacy enemies with authored-but-unused
 * zones don't suddenly start casting them). Hostile zones are lobbed at the target, friendly
 * ones at the most wounded living ally (self included).
 */
function kitSupportAction(entity: Entity, target: Entity, state: GameState): PlayerAction | null {
  if (!hasKit(entity)) return null;
  const supports = entity.abilities
    .filter((a): a is Extract<AbilityDefinition, { kind: "zone" | "barrier" }> =>
      (a.kind === "zone" || a.kind === "barrier") && a.kit !== undefined
      && canAffordAbility(entity, a) && abilityReady(entity, a))
    .sort(byPriorityDesc);

  for (const ability of supports) {
    if (ability.kind === "barrier") {
      return { type: "ability", entityId: entity.id, abilityId: ability.id };
    }
    const aim = zoneAim(entity, ability, target, state);
    if (aim) return { type: "ability", entityId: entity.id, abilityId: ability.id, aimDirection: aim };
  }
  return null;
}

function zoneAim(entity: Entity, ability: ZoneAbility, target: Entity, state: GameState): Vec2 | null {
  if (ability.zone.effect === "wall") {
    // Walls can't be stamped on top of an entity, so drop the disc just past the target —
    // cutting off the escape lane. The resolver validates placement; an illegal drop is skipped.
    const toTarget = sub(target.position, entity.position);
    const dist = length(toTarget);
    if (dist < 0.01) return null;
    const overshoot = dist + ability.zone.radius + target.collisionRadius + 8;
    if (overshoot > ability.range) return null;
    return scale(normalize(toTarget), overshoot);
  }

  const friendly = ability.zone.effect === "heal" || ability.zone.effect === "addBarrier";
  const anchor = friendly ? mostWoundedAlly(entity, state) : target;
  const aim = sub(anchor.position, entity.position);
  // Anchor is (nearly) self: a unit-length aim drops the zone on our own feet.
  const resolvedAim = length(aim) < 0.01 ? normalize(sub(target.position, entity.position)) : aim;

  if (!friendly) {
    const center = add(entity.position, scale(normalize(resolvedAim), Math.min(length(resolvedAim), ability.range)));
    if (countInZone(state, entity, center, ability.zone.radius) < (ability.kit?.minTargets ?? 1)) return null;
  }
  return resolvedAim;
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
 *  makes cover feel impactful); otherwise close the distance and attack from where we land.
 *  Kit-driven entities may additionally open with one support cast (zone/barrier). */
function pursue(entity: Entity, target: Entity, state: GameState): PlayerAction[] {
  const actions: PlayerAction[] = [];
  let working = state;
  let self = entity;

  const support = kitSupportAction(self, target, working);
  if (support) {
    const afterSupport = apply(working, support);
    if (afterSupport) {
      actions.push(support);
      working = afterSupport;
      self = working.entities.get(entity.id)!;
    }
  }

  const choice = pickAttack(working, self, target);
  if (choice) {
    actions.push(aimAt(self, choice.ability, target));
    return actions;
  }

  const moveAbility = getMoveAbility(self);
  if (!moveAbility || !canAffordAbility(self, moveAbility)) return actions;

  const moveDistance = getEffectiveDistance(self, moveAbility.distance);
  const destination = pathfindMove(self, target.position, working.grid, working.entities, moveDistance);
  if (!destination) return actions;

  const move: PlayerAction = { type: "ability", entityId: self.id, abilityId: moveAbility.id, destination };
  const afterMove = apply(working, move);
  if (!afterMove) return actions;

  actions.push(move);
  const movedSelf = afterMove.entities.get(entity.id);
  const movedTarget = afterMove.entities.get(target.id);
  if (movedSelf && movedTarget && !movedTarget.dead) {
    const afterMoveChoice = pickAttack(afterMove, movedSelf, movedTarget);
    if (afterMoveChoice) actions.push(aimAt(movedSelf, afterMoveChoice.ability, movedTarget));
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

    if (!getAttackAbility(entity)) return [];

    const dist = distance(entity.position, target.position);
    const preferredMin = bestKiteRange(entity) * 0.5;
    if (dist < preferredMin) {
      const actions: PlayerAction[] = [];
      let working = state;
      const choice = pickAttack(working, entity, target);
      if (choice) {
        const shot = aimAt(entity, choice.ability, target);
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

/** The "stay this far away" yardstick for kiting: the first attack's reach (legacy), or for
 *  kit-driven entities the longest reach they can actually use right now. */
function bestKiteRange(entity: Entity): number {
  if (!hasKit(entity)) return getAttackRange(getAttackAbility(entity)!);
  const usable = bestUsableRange(entity);
  if (usable > 0) return usable;
  let any = 0;
  for (const a of entity.abilities) if (a.kind === "attack") any = Math.max(any, getAttackRange(a));
  return any;
}

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
