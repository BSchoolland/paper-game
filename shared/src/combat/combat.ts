import type { AimDirection, AttackAbility, AttackHit, CombatShapeDefinition, Entity, GameState, GridState, StatusEffectType } from "../core/types.js";
import { entitiesInShape } from "../geometry/index.js";

export interface DamageResult {
  readonly state: GameState;
  readonly hits: readonly AttackHit[];
}

export function resolveWeaponAttack(
  attacker: Entity,
  aimDirection: AimDirection,
  entities: ReadonlyMap<string, Entity>,
  ability: Pick<AttackAbility, "shape" | "ignoreCoverRange">,
  grid: GridState
): Entity[] {
  const hits = entitiesInShape(
    attacker.position,
    aimDirection,
    ability.shape,
    entities,
    grid,
    attacker.id,
    ability.ignoreCoverRange
  );
  return hits.filter((e) => e.teamId !== attacker.teamId);
}

function hasStatus(entity: Entity, type: StatusEffectType): boolean {
  return entity.statusEffects?.some(s => s.type === type) ?? false;
}

function getStatusValue(entity: Entity, type: StatusEffectType): number {
  return entity.statusEffects?.find(s => s.type === type)?.value ?? 0;
}

export function applyDamage(
  state: GameState,
  targets: Entity[],
  damage: number,
  attackerId?: string
): DamageResult {
  const entities = new Map(state.entities);
  const attacker = attackerId ? state.entities.get(attackerId) : undefined;
  const weakMultiplier = attacker && hasStatus(attacker, "weak")
    ? 1 - getStatusValue(attacker, "weak")
    : 1;

  const hits: AttackHit[] = [];
  for (const target of targets) {
    let effectiveDamage = Math.round(damage * weakMultiplier);
    if (hasStatus(target, "vulnerable")) {
      effectiveDamage = Math.round(effectiveDamage * (1 + getStatusValue(target, "vulnerable")));
    }
    const barrierAbsorbed = Math.min(target.barrier, effectiveDamage);
    const remainingDamage = effectiveDamage - barrierAbsorbed;
    const newBarrier = target.barrier - barrierAbsorbed;
    const newHp = target.hp - remainingDamage;
    const killed = newHp <= 0;
    hits.push({ targetId: target.id, damage: effectiveDamage, killed });
    if (killed) {
      entities.set(target.id, { ...target, hp: 0, barrier: 0, dead: true });
    } else {
      entities.set(target.id, { ...target, hp: newHp, barrier: newBarrier });
    }
  }
  return { state: { ...state, entities }, hits };
}
