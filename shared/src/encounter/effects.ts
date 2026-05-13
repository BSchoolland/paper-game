import type { ActionResult, Entity, EntityEffect, GameEvent, StatusEffect, TeamId, UnitTemplate, Vec2, WeaponEffect } from "../core/types.js";
import { STATUS_META } from "../core/status-meta.js";
import { makeEntity } from "./entity-factory.js";
import { applyDamage } from "../combat/combat.js";
import { normalize, sub, add, scale, distance } from "../core/vec2.js";
import { isPositionWalkable, isWithinBounds, findWalkablePosition } from "../map/collision-grid.js";

let activeTemplateRegistry: Record<string, UnitTemplate> | null = null;

export function setTemplateRegistry(registry: Record<string, UnitTemplate>): void {
  activeTemplateRegistry = registry;
}

function getTemplate(key: string): UnitTemplate | undefined {
  return activeTemplateRegistry?.[key];
}

function nextSpawnId(state: ActionResult["state"]): { id: string; state: ActionResult["state"] } {
  const next = state.nextSpawnId + 1;
  return { id: `spawn-${next}`, state: { ...state, nextSpawnId: next } };
}

function entitiesOverlap(
  pos: Vec2,
  radius: number,
  entities: ReadonlyMap<string, Entity>,
  excludeId: string
): boolean {
  for (const e of entities.values()) {
    if (e.id === excludeId || e.dead) continue;
    if (distance(pos, e.position) < radius + e.collisionRadius) return true;
  }
  return false;
}

export function processEffects(result: ActionResult): ActionResult {
  let { state } = result;
  const events = [...result.events];

  for (const event of result.events) {
    if (event.type !== "attack") continue;

    const ability = event.ability;
    for (const hit of event.hits) {
      if (ability.knockback > 0) {
        const applied = knockbackTarget(hit.targetId, event.attackerPosition, ability.knockback, state);
        state = applied.state;
        events.push(...applied.events);
        // Knocked into a wall, an edge, or another body: pay the slam toll.
        if (applied.blocked && ability.wallSlamDamage && ability.wallSlamDamage > 0) {
          const target = state.entities.get(hit.targetId);
          if (target && !target.dead) {
            const slam = applyDamage(state, [target], ability.wallSlamDamage);
            state = slam.state;
            events.push({ type: "collision", entityId: target.id, at: target.position, damage: ability.wallSlamDamage, killed: slam.hits[0]!.killed });
          }
        }
      }
      if (ability.onHit) {
        for (const effect of ability.onHit) {
          const applied = applyWeaponEffect(effect, hit.targetId, event.attackerPosition, state);
          state = applied.state;
          events.push(...applied.events);
        }
      }
    }

    // Attacker repositioning: recoil shoves the attacker back along the reverse of the aim
    // line whether or not the swing connected; lungeThrough carries the attacker forward only
    // when it did. Both surface as ordinary "move" events, so the renderer animates and
    // previews them with no special-casing.
    const asMove = (entityId: string, from: Vec2, to: Vec2): GameEvent => ({ type: "move", entityId, from, to });
    if (ability.recoil && ability.recoil > 0) {
      const recoiled = slideEntity(event.attackerId, scale(event.aimDirection, -1), ability.recoil, asMove, state);
      state = recoiled.state;
      events.push(...recoiled.events);
    }
    if (ability.lungeThrough && ability.lungeThrough > 0 && event.hits.length > 0) {
      const lunged = slideEntity(event.attackerId, event.aimDirection, ability.lungeThrough, asMove, state);
      state = lunged.state;
      events.push(...lunged.events);
    }

    for (const hit of event.hits) {
      if (!hit.killed) continue;
      const dead = state.entities.get(hit.targetId);
      if (!dead?.effects) continue;
      const deathEffects = dead.effects.filter((e) => e.trigger === "onDeath");
      for (const effect of deathEffects) {
        const spawned = applyEntityEffect(effect, dead.position, dead.teamId, state);
        state = spawned.state;
        events.push(...spawned.events);
      }
    }
  }

  return { state, events };
}

function applyWeaponEffect(
  effect: WeaponEffect,
  targetId: string,
  attackerPos: Vec2,
  state: ActionResult["state"]
): { state: ActionResult["state"]; events: GameEvent[] } {
  switch (effect.type) {
    case "pull":
      return pullTarget(targetId, attackerPos, effect.distance, state);
    case "applyStatus":
      return applyStatusEffect(targetId, { type: effect.status, duration: effect.duration, value: effect.value }, state);
  }
}

type SlideResult = { state: ActionResult["state"]; events: GameEvent[]; blocked: boolean };

/**
 * Slide an entity along `direction` as far as it can go, up to `maxDist`, stepping inward in
 * 5-unit increments until it finds a spot that's walkable, in-bounds, and not overlapping
 * anyone. The single primitive behind knockback, pull, recoil, and lunge — callers supply the
 * direction and which event to emit for the move that lands. `blocked` is true when the entity
 * couldn't travel the full `maxDist` (it slammed into a wall, an edge, or another entity).
 */
function slideEntity(
  entityId: string,
  direction: Vec2,
  maxDist: number,
  makeEvent: (entityId: string, from: Vec2, to: Vec2) => GameEvent,
  state: ActionResult["state"]
): SlideResult {
  const entity = state.entities.get(entityId);
  if (!entity) return { state, events: [], blocked: false };

  const dir = normalize(direction);
  if (dir.x === 0 && dir.y === 0) return { state, events: [], blocked: false };

  let full = true;
  for (let d = maxDist; d > 0; d -= 5) {
    const dest = add(entity.position, scale(dir, d));
    if (
      isPositionWalkable(state.grid, dest, entity.collisionRadius) &&
      isWithinBounds(state.grid, dest, entity.collisionRadius) &&
      !entitiesOverlap(dest, entity.collisionRadius, state.entities, entity.id)
    ) {
      const from = entity.position;
      const entities = new Map(state.entities);
      entities.set(entity.id, { ...entity, position: dest });
      return { state: { ...state, entities }, events: [makeEvent(entity.id, from, dest)], blocked: !full };
    }
    full = false;
  }

  return { state, events: [], blocked: true };
}

function knockbackTarget(
  targetId: string,
  attackerPos: Vec2,
  maxDist: number,
  state: ActionResult["state"]
): SlideResult {
  const target = state.entities.get(targetId);
  if (!target) return { state, events: [], blocked: false };
  return slideEntity(targetId, sub(target.position, attackerPos), maxDist,
    (entityId, from, to) => ({ type: "knockback", entityId, from, to }), state);
}

function pullTarget(
  targetId: string,
  attackerPos: Vec2,
  maxDist: number,
  state: ActionResult["state"]
): SlideResult {
  const target = state.entities.get(targetId);
  if (!target) return { state, events: [], blocked: false };
  return slideEntity(targetId, sub(attackerPos, target.position), maxDist,
    (entityId, from, to) => ({ type: "pull", entityId, from, to }), state);
}

function applyStatusEffect(
  targetId: string,
  status: StatusEffect,
  state: ActionResult["state"]
): { state: ActionResult["state"]; events: GameEvent[] } {
  const target = state.entities.get(targetId);
  if (!target || target.dead) return { state, events: [] };

  const existing = target.statusEffects ?? [];
  const withoutSameType = existing.filter(s => s.type !== status.type);
  const merged = [...withoutSameType, status];

  const entities = new Map(state.entities);
  entities.set(targetId, { ...target, statusEffects: merged });
  return {
    state: { ...state, entities },
    events: [{ type: "statusApplied", entityId: targetId, status }],
  };
}

function applyEntityEffect(
  effect: EntityEffect,
  position: Vec2,
  teamId: TeamId,
  state: ActionResult["state"]
): { state: ActionResult["state"]; events: GameEvent[] } {
  switch (effect.action.type) {
    case "spawn":
      return spawnEntities(
        effect.action.templateKey,
        effect.action.count,
        position,
        teamId,
        state
      );
  }
}

function spawnEntities(
  templateKey: string,
  count: number,
  origin: Vec2,
  teamId: TeamId,
  state: ActionResult["state"]
): { state: ActionResult["state"]; events: GameEvent[] } {
  const template = getTemplate(templateKey);
  if (!template) return { state, events: [] };

  const entities = new Map(state.entities);
  const events: GameEvent[] = [];
  const angleStep = (Math.PI * 2) / count;

  let currentState = state;
  for (let i = 0; i < count; i++) {
    const angle = angleStep * i + Math.PI / 4;
    const offset = template.collisionRadius * 2;
    const raw: Vec2 = {
      x: origin.x + Math.cos(angle) * offset,
      y: origin.y + Math.sin(angle) * offset,
    };
    const position = findWalkablePosition(currentState.grid, raw, template.collisionRadius);

    const spawn = nextSpawnId(currentState);
    currentState = spawn.state;
    const entity = makeEntity(spawn.id, template.className, position.x, position.y, teamId, template);
    entities.set(spawn.id, { ...entity, energy: { ...entity.energy, red: 0, blue: 0 } });
    events.push({ type: "spawn", entityId: spawn.id, position, templateKey });
  }

  return { state: { ...currentState, entities }, events };
}

export function describeWeaponEffect(effect: WeaponEffect): string {
  switch (effect.type) {
    case "pull":
      return `pull (${effect.distance})`;
    case "applyStatus": {
      const meta = STATUS_META[effect.status];
      return `${meta.label}: ${meta.describe(effect.value)} (${effect.duration}t)`;
    }
  }
}
