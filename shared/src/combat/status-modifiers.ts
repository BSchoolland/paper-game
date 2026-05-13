import type { EntityCombat, StatusEffectType } from "../core/types.js";
import { STATUS_META, type EnergyPoolName } from "../core/status-meta.js";

export function hasStatus(entity: Pick<EntityCombat, "statusEffects">, type: StatusEffectType): boolean {
  return entity.statusEffects?.some(s => s.type === type) ?? false;
}

export function getStatusValue(entity: Pick<EntityCombat, "statusEffects">, type: StatusEffectType): number {
  return entity.statusEffects?.find(s => s.type === type)?.value ?? 0;
}

export function getEffectiveDistance(entity: Pick<EntityCombat, "statusEffects">, baseDistance: number): number {
  if (hasStatus(entity, "rooted")) return 0;
  if (hasStatus(entity, "slowed")) {
    return baseDistance * (1 - getStatusValue(entity, "slowed"));
  }
  return baseDistance;
}

/**
 * Start-of-turn regen for a banked energy pool after status penalties (Winded → blue,
 * Suppressed → red). Never goes below 0.
 */
export function getEffectiveRegen(
  entity: Pick<EntityCombat, "statusEffects">,
  pool: EnergyPoolName,
  baseRegen: number
): number {
  let penalty = 0;
  for (const s of entity.statusEffects ?? []) {
    if (STATUS_META[s.type].regenPenalty === pool) penalty += s.value;
  }
  return Math.max(0, baseRegen - penalty);
}
