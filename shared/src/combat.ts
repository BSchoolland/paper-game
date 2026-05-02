import type { Entity, GameState, WeaponDefinition, Vec2 } from "./types.js";
import { entitiesInSector } from "./geometry.js";

export function resolveWeaponAttack(
  attacker: Entity,
  aimDirection: Vec2,
  entities: ReadonlyMap<string, Entity>,
  weapon: WeaponDefinition
): Entity[] {
  const shape = weapon.shape;

  switch (shape.kind) {
    case "sector": {
      const hits = entitiesInSector(
        attacker.position,
        aimDirection,
        shape.radius,
        shape.halfAngle,
        entities,
        attacker.id
      );
      return hits.filter((e) => e.teamId !== attacker.teamId);
    }
    default:
      return [];
  }
}

export function applyDamage(
  state: GameState,
  targets: Entity[],
  damage: number
): GameState {
  const entities = new Map(state.entities);
  for (const target of targets) {
    const newHp = target.hp - damage;
    if (newHp <= 0) {
      entities.delete(target.id);
    } else {
      entities.set(target.id, { ...target, hp: newHp });
    }
  }
  return { ...state, entities };
}
