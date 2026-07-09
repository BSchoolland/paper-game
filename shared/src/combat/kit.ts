import type { AbilityDefinition, Entity } from "../core/types.js";

/**
 * Resolver-enforced kit gates: cooldown and HP-phase windows. Affordability is separate
 * (`canAffordAbility`) — an ability must pass both to be cast.
 */
export function abilityReady(entity: Entity, ability: AbilityDefinition): boolean {
  if ((entity.cooldowns?.[ability.id] ?? 0) > 0) return false;
  const kit = ability.kit;
  if (!kit) return true;
  const hpFrac = entity.hp / entity.maxHp;
  if (kit.hpBelow !== undefined && hpFrac > kit.hpBelow) return false;
  if (kit.hpAbove !== undefined && hpFrac <= kit.hpAbove) return false;
  return true;
}

/** Stamp the ability's cooldown onto the entity after a successful cast. Identity-preserving
 *  when the ability has no cooldown. */
export function withCooldownStamped(entity: Entity, ability: AbilityDefinition): Entity {
  const cooldown = ability.kit?.cooldown;
  if (!cooldown) return entity;
  return { ...entity, cooldowns: { ...entity.cooldowns, [ability.id]: cooldown } };
}

/** Tick every pending cooldown down one turn, dropping expired entries. Identity-preserving
 *  when the entity has none pending. */
export function withCooldownsTicked(entity: Entity): Entity {
  const cooldowns = entity.cooldowns;
  if (!cooldowns) return entity;
  const remaining: Record<string, number> = {};
  let any = false;
  for (const [id, turns] of Object.entries(cooldowns)) {
    if (turns > 1) {
      remaining[id] = turns - 1;
      any = true;
    }
  }
  return { ...entity, cooldowns: any ? remaining : undefined };
}
