import type { Entity, GameState, SwordStats, Vec2 } from "./types.js";
import { DEFAULT_SWORD } from "./types.js";
import { entitiesInSector } from "./geometry.js";

export function resolveSwordAttack(
  attacker: Entity,
  aimDirection: Vec2,
  entities: ReadonlyMap<string, Entity>,
  sword: SwordStats = DEFAULT_SWORD
): Entity[] {
  const hits = entitiesInSector(
    attacker.position,
    aimDirection,
    sword.radius,
    sword.halfAngle,
    entities,
    attacker.id
  );
  return hits.filter((e) => e.team !== attacker.team);
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
