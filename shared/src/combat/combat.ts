import type { AttackHit, Entity, GameState, GridState, WeaponDefinition, Vec2 } from "../core/types.js";
import { entitiesInShape } from "../geometry/index.js";

export interface DamageResult {
  readonly state: GameState;
  readonly hits: readonly AttackHit[];
}

export function resolveWeaponAttack(
  attacker: Entity,
  aimDirection: Vec2,
  entities: ReadonlyMap<string, Entity>,
  weapon: WeaponDefinition,
  grid: GridState
): Entity[] {
  const hits = entitiesInShape(
    attacker.position,
    aimDirection,
    weapon.shape,
    entities,
    grid,
    attacker.id,
    weapon.ignoreCoverRange
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
    const newHp = target.hp - damage;
    const killed = newHp <= 0;
    hits.push({ targetId: target.id, damage, killed });
    if (killed) {
      entities.set(target.id, { ...target, hp: 0, dead: true });
    } else {
      entities.set(target.id, { ...target, hp: newHp });
    }
  }
  return { state: { ...state, entities }, hits };
}
