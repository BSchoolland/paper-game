import type { AimDirection, AttackAbility, AttackHit, CombatShapeDefinition, Entity, GameState, GridState } from "../core/types.js";
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

export function applyDamage(
  state: GameState,
  targets: Entity[],
  damage: number
): DamageResult {
  const entities = new Map(state.entities);
  const hits: AttackHit[] = [];
  for (const target of targets) {
    const barrierAbsorbed = Math.min(target.barrier, damage);
    const remainingDamage = damage - barrierAbsorbed;
    const newBarrier = target.barrier - barrierAbsorbed;
    const newHp = target.hp - remainingDamage;
    const killed = newHp <= 0;
    hits.push({ targetId: target.id, damage, killed });
    if (killed) {
      entities.set(target.id, { ...target, hp: 0, barrier: 0, dead: true });
    } else {
      entities.set(target.id, { ...target, hp: newHp, barrier: newBarrier });
    }
  }
  return { state: { ...state, entities }, hits };
}
