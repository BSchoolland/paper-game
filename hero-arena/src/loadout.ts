import { ShapeKind } from "../../shared/src/core/types.js";
import type { AbilityDefinition, UnitTemplate } from "../../shared/src/index.js";

/**
 * The fixed hero kit every entry fights with — a *normal* World-0 (Greenlands) adventurer: 120 HP,
 * 2 red + 2 blue energy/turn (each banks to 4), collision radius 16. Loadout: a two-handed
 * greatsword (the broadsword's three moves), a round shield (block + bash), and a long-range
 * precision bow shot. Move costs blue, attacks cost red — so most turns you can reposition *and*
 * swing. Both sides field this same hero; it's a brains contest, not a gear contest.
 *
 *   move                    — 130px, 2 blue (1 blue if you travel ≤65px)               [variableCost]
 *   greatsword-sweep        — 30 dmg, 90px / 90° sector, knockback 30                    2 red
 *   greatsword-halfsword    — 42 dmg, 115×18 rect, no knockback (your big single-target hit) 2 red
 *   greatsword-pommel       — 12 dmg, 50px / 45° sector, knockback 60                     1 red
 *   shield-block            — +10 barrier (a turn-1 buffer)                               1 blue
 *   shield-bash             — 12 dmg, 55px / 45° sector, knockback 40                     1 red
 *   precision-shot          — 20 dmg, point target at 300px, sees 40px past cover         2 red
 */
const HERO_ABILITIES: AbilityDefinition[] = [
  { id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 130 },

  // greatsword (the World-0 broadsword's moveset)
  { id: "greatsword-sweep", name: "Greatsword Sweep", kind: "attack", cost: { red: 2 }, damage: 30, knockback: 30,
    shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 2 } },
  { id: "greatsword-halfsword", name: "Half-sword Thrust", kind: "attack", cost: { red: 2 }, damage: 42, knockback: 0,
    shape: { kind: ShapeKind.Rectangle, length: 115, width: 18 } },
  { id: "greatsword-pommel", name: "Pommel Strike", kind: "attack", cost: { red: 1 }, damage: 12, knockback: 60,
    shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 4 } },

  // round shield
  { id: "shield-block", name: "Block", kind: "barrier", cost: { blue: 1 }, barrierHp: 10 },
  { id: "shield-bash", name: "Shield Bash", kind: "attack", cost: { red: 1 }, damage: 12, knockback: 40,
    shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 } },

  // long-range precision shot
  { id: "precision-shot", name: "Precision Shot", kind: "attack", cost: { red: 2 }, damage: 20, knockback: 0,
    shape: { kind: ShapeKind.Point, range: 300 }, ignoreCoverRange: 40 },
];

export const HERO_TEMPLATE: UnitTemplate = {
  abilities: HERO_ABILITIES,
  hp: 120,
  energy: { red: 2, blue: 2 },
  collisionRadius: 16,
  className: "Hero",
  // `strategy` is irrelevant — the arena overrides the hero with its registered HeroController.
};
