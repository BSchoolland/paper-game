import type { AttackHit, Entity, GameState, GridState, WeaponDefinition, Vec2 } from "./types.js";
import { entitiesInSector, entitiesInRectangle, raycastToEntity } from "./geometry/index.js";

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
    case "rectangle": {
      const hits = entitiesInRectangle(
        attacker.position,
        aimDirection,
        shape.length,
        shape.width,
        entities,
        attacker.id
      );
      return hits.filter((e) => e.teamId !== attacker.teamId);
    }
    case "point": {
      const hit = raycastToEntity(
        attacker.position,
        aimDirection,
        shape.range,
        entities,
        grid,
        attacker.id,
        weapon.ignoreCoverRange
      );
      if (!hit) return [];
      const target = entities.get(hit.entityId);
      if (!target || target.teamId === attacker.teamId) return [];
      return [target];
    }
    case "circle":
      return [];
  }
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
      entities.delete(target.id);
    } else {
      entities.set(target.id, { ...target, hp: newHp });
    }
  }
  return { state: { ...state, entities }, hits };
}
