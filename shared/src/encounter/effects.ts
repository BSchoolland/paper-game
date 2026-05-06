import type { ActionResult, EntityEffect, GameEvent, TeamId, Vec2 } from "../core/types.js";
import { ENEMY_TEMPLATES } from "../core/types.js";
import { makeEntity } from "./entity-factory.js";

let spawnCounter = 0;

export function resetSpawnCounter() {
  spawnCounter = 0;
}

function nextSpawnId(): string {
  return `spawn-${++spawnCounter}`;
}

export function processEffects(result: ActionResult): ActionResult {
  let { state } = result;
  const events = [...result.events];

  for (const event of result.events) {
    if (event.type !== "attack") continue;
    for (const hit of event.hits) {
      if (!hit.killed) continue;
      const dead = state.entities.get(hit.targetId);
      if (!dead?.effects) continue;
      const deathEffects = dead.effects.filter((e) => e.trigger === "onDeath");
      for (const effect of deathEffects) {
        const spawned = applyEffect(effect, dead.position, dead.teamId, state);
        state = spawned.state;
        events.push(...spawned.events);
      }
    }
  }

  return { state, events };
}

function applyEffect(
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
    const position: Vec2 = {
      x: origin.x + Math.cos(angle) * offset,
      y: origin.y + Math.sin(angle) * offset,
    };

    const id = nextSpawnId();
    const entity = makeEntity(id, template.className, position.x, position.y, teamId, template);
    entities.set(id, { ...entity, actionsRemaining: 0, movementRemaining: 0 });
    events.push({ type: "spawn", entityId: id, position, templateKey });
  }

  return { state: { ...state, entities }, events };
}
