import { ShapeKind } from "../core/types.js";
import type { AttackAbility, CombatShapeDefinition } from "../core/types.js";
import { DEFENSE_POLICY, type DefenseTier } from "./defense.js";

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

export function defenseTierFromPower(power: number): DefenseTier {
  if (power >= 0.99) return "perfect";
  if (power >= 0.4) return "decent";
  return "none";
}

/** The tier→damage mapping lives in the defense policy (combat/defense.ts) with the rest
 *  of the block rules. */
export function defenseTierToMultiplier(tier: DefenseTier): number {
  return DEFENSE_POLICY.damageMult[tier];
}

export function defenseToMultiplier(power: number): number {
  return defenseTierToMultiplier(defenseTierFromPower(power));
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
