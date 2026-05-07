import type { ActionResult, Entity, EntityEffect, GameEvent, TeamId, Vec2, WeaponEffect } from "../core/types.js";
import { ENEMY_TEMPLATES } from "../core/types.js";
import { makeEntity } from "./entity-factory.js";
import { normalize, sub, add, scale, distance } from "../core/vec2.js";
import { isPositionWalkable, isWithinBounds, findWalkablePosition } from "../map/collision-grid.js";

let spawnCounter = 0;

export function resetSpawnCounter() {
  spawnCounter = 0;
}

function nextSpawnId(): string {
  return `spawn-${++spawnCounter}`;
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

    const weapon = event.weapon;
    if (weapon.onHit) {
      for (const hit of event.hits) {
        for (const effect of weapon.onHit) {
          const applied = applyWeaponEffect(effect, hit.targetId, event.attackerPosition, state);
          state = applied.state;
          events.push(...applied.events);
        }
      }
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
    case "knockback":
      return knockbackTarget(targetId, attackerPos, effect.distance, state);
  }
}

function knockbackTarget(
  targetId: string,
  attackerPos: Vec2,
  maxDist: number,
  state: ActionResult["state"]
): { state: ActionResult["state"]; events: GameEvent[] } {
  const target = state.entities.get(targetId);
  if (!target) return { state, events: [] };

  const dir = normalize(sub(target.position, attackerPos));
  if (dir.x === 0 && dir.y === 0) return { state, events: [] };

  for (let d = maxDist; d > 0; d -= 5) {
    const dest = add(target.position, scale(dir, d));
    if (
      isPositionWalkable(state.grid, dest, target.collisionRadius) &&
      isWithinBounds(state.grid, dest, target.collisionRadius) &&
      !entitiesOverlap(dest, target.collisionRadius, state.entities, target.id)
    ) {
      const from = target.position;
      const entities = new Map(state.entities);
      entities.set(target.id, { ...target, position: dest });
      return {
        state: { ...state, entities },
        events: [{ type: "knockback", entityId: target.id, from, to: dest }],
      };
    }
  }

  return { state, events: [] };
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
  const template = (ENEMY_TEMPLATES as Record<string, (typeof ENEMY_TEMPLATES)[keyof typeof ENEMY_TEMPLATES]>)[templateKey];
  if (!template) return { state, events: [] };

  const entities = new Map(state.entities);
  const events: GameEvent[] = [];
  const angleStep = (Math.PI * 2) / count;

  for (let i = 0; i < count; i++) {
    const angle = angleStep * i + Math.PI / 4;
    const offset = template.collisionRadius * 2;
    const raw: Vec2 = {
      x: origin.x + Math.cos(angle) * offset,
      y: origin.y + Math.sin(angle) * offset,
    };
    const position = findWalkablePosition(state.grid, raw, template.collisionRadius);

    const id = nextSpawnId();
    const entity = makeEntity(id, template.className, position.x, position.y, teamId, template);
    entities.set(id, { ...entity, actionsRemaining: 0, movementRemaining: 0 });
    events.push({ type: "spawn", entityId: id, position, templateKey });
  }

  return { state: { ...state, entities }, events };
}
