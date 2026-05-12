import type { EntityCombat, StatusEffectType } from "../core/types.js";

export function hasStatus(entity: Pick<EntityCombat, "statusEffects">, type: StatusEffectType): boolean {
  return entity.statusEffects?.some(s => s.type === type) ?? false;
}

export function getStatusValue(entity: Pick<EntityCombat, "statusEffects">, type: StatusEffectType): number {
  return entity.statusEffects?.find(s => s.type === type)?.value ?? 0;
}

export function getEffectiveDamage(
  baseDamage: number,
  attacker: Pick<EntityCombat, "statusEffects"> | undefined,
  target: Pick<EntityCombat, "statusEffects">
): number {
  let damage = baseDamage;
  if (attacker && hasStatus(attacker, "weak")) {
    damage *= 1 - getStatusValue(attacker, "weak");
  }
  if (hasStatus(target, "vulnerable")) {
    damage *= 1 + getStatusValue(target, "vulnerable");
  }
  return Math.round(damage);
}

export function getEffectiveDistance(entity: Pick<EntityCombat, "statusEffects">, baseDistance: number): number {
  if (hasStatus(entity, "slowed")) {
    return baseDistance * (1 - getStatusValue(entity, "slowed"));
  }
  return baseDistance;
}
