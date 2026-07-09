import type { AttackAbility, MoveAbility, UnitTemplate } from "../core/types.js";
import { ShapeKind } from "../core/types.js";

const SUMMON_MOVE: MoveAbility = { id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 110 };

const SAPLING_LASH: AttackAbility = {
  id: "summon-sapling-lash", name: "Thorn Lash", kind: "attack", cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
  damage: 10, knockback: 0,
  visual: { color: 0x4e8c3a, trailEffect: "slash", screenShake: 0.15 },
};

/**
 * Templates player items may summon. Kept apart from dimension enemy registries — these are
 * item content, not encounter content, so the encounter generator can never roster them as
 * foes. Merge over the dimension registry wherever setTemplateRegistry is called.
 */
export const ITEM_SUMMON_TEMPLATES: Record<string, UnitTemplate> = {
  "item-sapling-warden": {
    className: "Sapling Warden",
    hp: 35,
    energy: { red: 1, blue: 2 },
    energyBankFactor: 1,
    collisionRadius: 12,
    heightMeters: 1.2,
    strategy: "rush",
    abilities: [SUMMON_MOVE, SAPLING_LASH],
  },
};
