import type { AttackHit, Entity, GameState, GridState, WeaponDefinition, Vec2 } from "./types.js";
import { entitiesInShape } from "./geometry/index.js";

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
    const hit: AttackHit = killed
      ? {
          targetId: target.id, damage, killed,
          killedPosition: target.position,
          killedTeamId: target.teamId,
          killedEffects: target.effects,
        }
      : { targetId: target.id, damage, killed };
    hits.push(hit);
    if (killed) {
      entities.delete(target.id);
    } else {
      entities.set(target.id, { ...target, hp: newHp });
    }
  }
  return { state: { ...state, entities }, hits };
}
