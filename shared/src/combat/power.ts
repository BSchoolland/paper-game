import { ShapeKind } from "../core/types.js";
import type { AttackAbility, CombatShapeDefinition } from "../core/types.js";

export function powerToMultiplier(power: number | undefined): number {
  if (power === undefined) return 1;
  const clamped = Math.max(0, Math.min(1, power));
  return 0.5 + clamped * 0.75;
}

function scaleShape(shape: CombatShapeDefinition, mult: number): CombatShapeDefinition {
  switch (shape.kind) {
    case ShapeKind.Sector:
      return { ...shape, radius: shape.radius * mult };
    case ShapeKind.Rectangle:
      return { ...shape, length: shape.length * mult };
    case ShapeKind.Circle:
      return { ...shape, radius: shape.radius * mult };
    case ShapeKind.Point:
      return shape;
  }
}

export function scaleAttack(ability: AttackAbility, mult: number): AttackAbility {
  if (mult === 1) return ability;
  return {
    ...ability,
    damage: Math.round(ability.damage * mult),
    knockback: ability.knockback * mult,
    shape: scaleShape(ability.shape, mult),
  };
}
