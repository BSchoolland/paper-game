import { ShapeKind } from "../../../shared/src/core/types.js";
import type { AbilityDefinition, AttackAbility, UnitTemplate } from "../../../shared/src/index.js";
import { HERO_TEMPLATE } from "../loadout.js";

const MOVE: AbilityDefinition = {
  id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 130,
};

// ── Tank: mace + kite-shield ─────────────────────────────────────────────────

const TANK_ABILITIES: AbilityDefinition[] = [
  MOVE,
  { id: "mace-crush", name: "Crush", kind: "attack", cost: { red: 2 },
    shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 4 },
    damage: 30, knockback: 55, recoil: 30 },
  { id: "mace-overhead", name: "Overhead Strike", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Circle, radius: 55, range: 0 },
    damage: 18, knockback: 0 },
  { id: "mace-lunge", name: "Lunge", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Rectangle, length: 85, width: 20 },
    damage: 15, knockback: 35, lungeThrough: 95 },
  { id: "kite-shield-block", name: "Block", kind: "barrier", cost: { blue: 1 }, barrierHp: 25 },
  { id: "kite-shield-bash", name: "Shield Bash", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 4 },
    damage: 15, knockback: 50 },
  { id: "kite-shield-wall", name: "Shield Wall", kind: "barrier", cost: { blue: 2 }, barrierHp: 45 },
];

export const TANK_TEMPLATE: UnitTemplate = {
  abilities: TANK_ABILITIES, hp: 160, energy: { red: 2, blue: 2 }, collisionRadius: 16, className: "Tank",
  strategy: "smart",
};

// ── Fighter: existing hero template ──────────────────────────────────────────

export const FIGHTER_TEMPLATE: UnitTemplate = HERO_TEMPLATE;

// ── Ranged: bow + staff ──────────────────────────────────────────────────────

const RANGED_ABILITIES: AbilityDefinition[] = [
  MOVE,
  { id: "bow-shot", name: "Shot", kind: "attack", cost: { red: 2 },
    shape: { kind: ShapeKind.Point, range: 300 },
    damage: 20, knockback: 0, ignoreCoverRange: 40 },
  { id: "bow-piercing-arrow", name: "Piercing Arrow", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Rectangle, length: 220, width: 14 },
    damage: 14, knockback: 0 },
  { id: "staff-blast", name: "Arcane Blast", kind: "attack", cost: { red: 2 },
    shape: { kind: ShapeKind.Circle, radius: 60, range: 200 },
    damage: 25, knockback: 0 },
  { id: "staff-bolt", name: "Arcane Bolt", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Point, range: 200 },
    damage: 11, knockback: 0 },
  { id: "staff-push", name: "Arcane Push", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
    damage: 10, knockback: 65 },
];

export const RANGED_TEMPLATE: UnitTemplate = {
  abilities: RANGED_ABILITIES, hp: 120, energy: { red: 2, blue: 2 }, collisionRadius: 16, className: "Ranged",
  strategy: "smart",
};

// ── Boss: battle-axe + kite-shield, beefy ────────────────────────────────────

const BOSS_ABILITIES: AbilityDefinition[] = [
  { id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 110 },
  { id: "battle-axe-cleave", name: "Cleave", kind: "attack", cost: { red: 2 },
    shape: { kind: ShapeKind.Sector, radius: 85, halfAngle: Math.PI / 3 },
    damage: 45, knockback: 50 },
  { id: "battle-axe-hook", name: "Hook", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Rectangle, length: 90, width: 35 },
    damage: 14, knockback: 75 },
  { id: "battle-axe-rend", name: "Rend", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 2 },
    damage: 20, knockback: 0 },
  { id: "kite-shield-block", name: "Block", kind: "barrier", cost: { blue: 1 }, barrierHp: 15 },
  { id: "kite-shield-bash", name: "Shield Bash", kind: "attack", cost: { red: 1 },
    shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 4 },
    damage: 15, knockback: 50 },
];

export const BOSS_TEMPLATE: UnitTemplate = {
  abilities: BOSS_ABILITIES, hp: 300, energy: { red: 3, blue: 3 }, collisionRadius: 22, className: "Boss",
  strategy: "smart",
};

// ── Role lookup ──────────────────────────────────────────────────────────────

export function templateForRole(role: string): UnitTemplate {
  switch (role) {
    case "tank": return TANK_TEMPLATE;
    case "fighter": return FIGHTER_TEMPLATE;
    case "ranged": return RANGED_TEMPLATE;
    case "boss": return BOSS_TEMPLATE;
    default: return FIGHTER_TEMPLATE;
  }
}

// ── Random loadout generator ─────────────────────────────────────────────────

const ALL_WEAPON_ABILITIES: AttackAbility[] = buildAbilityPool();

function buildAbilityPool(): AttackAbility[] {
  const pool: AttackAbility[] = [];
  const seen = new Set<string>();

  const add = (a: AbilityDefinition) => {
    if (a.kind === "attack" && !seen.has(a.id)) {
      seen.add(a.id);
      pool.push(a);
    }
  };

  // Dim-0 weapons
  for (const ab of TANK_ABILITIES) add(ab);
  for (const ab of RANGED_ABILITIES) add(ab);
  for (const ab of HERO_TEMPLATE.abilities) add(ab);

  // Additional dim-0 weapons not in archetypes
  const extraDim0: AttackAbility[] = [
    { id: "short-sword-slash", name: "Slash", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 }, damage: 25, knockback: 30 },
    { id: "short-sword-stab", name: "Stab", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 90, width: 12 }, damage: 11, knockback: 0 },
    { id: "long-sword-slash", name: "Long Slash", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 100, halfAngle: Math.PI / 3 }, damage: 35, knockback: 35 },
    { id: "long-sword-crosscut", name: "Cross-cut", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 2 }, damage: 14, knockback: 0 },
    { id: "spear-thrust", name: "Thrust", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 140, width: 20 }, damage: 32, knockback: 25 },
    { id: "spear-shaft", name: "Shaft Strike", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 }, damage: 10, knockback: 45 },
    { id: "axe-chop", name: "Chop", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 6 }, damage: 40, knockback: 40 },
    { id: "axe-hack", name: "Hack", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2 }, damage: 16, knockback: 0 },
  ];
  for (const a of extraDim0) add(a);

  // Dim-1 weapons (The Shallows — pulls, slows)
  const dim1: AttackAbility[] = [
    { id: "coral-slash", name: "Coral Slash", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 3 }, damage: 22, knockback: 0 },
    { id: "coral-jab", name: "Coral Jab", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 75, width: 12 }, damage: 10, knockback: 0,
      onHit: [{ type: "applyStatus", status: "suppressed", duration: 2, value: 1 }] },
    { id: "harpoon-thrust", name: "Harpoon Thrust", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 130, width: 18 }, damage: 25, knockback: 0,
      onHit: [{ type: "pull", distance: 50 }] },
    { id: "urchin-swing", name: "Venomous Swing", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 2 }, damage: 22, knockback: 0 },
    { id: "chain-whip", name: "Chain Whip", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 90, width: 10 }, damage: 10, knockback: 0,
      onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.3 }] },
    { id: "crusher-grip", name: "Crusher Grip", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 4 }, damage: 22, knockback: 0,
      onHit: [{ type: "pull", distance: 50 }] },
  ];
  for (const a of dim1) add(a);

  // Dim-2 weapons (Gloom Hollows — knockback)
  const dim2: AttackAbility[] = [
    { id: "crystal-slash", name: "Crystal Slash", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 3 }, damage: 20, knockback: 0 },
    { id: "stalactite-thrust", name: "Stalactite Thrust", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 125, width: 18 }, damage: 24, knockback: 0 },
    { id: "fungal-smash", name: "Fungal Smash", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2 }, damage: 24, knockback: 0 },
    { id: "geode-uppercut", name: "Geode Uppercut", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 }, damage: 28, knockback: 0 },
    { id: "geode-flurry", name: "Geode Flurry", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 3 }, damage: 14, knockback: 25 },
  ];
  for (const a of dim2) add(a);

  // Dim-3 weapons (Gilt Barrens — ambush, pure damage)
  const dim3: AttackAbility[] = [
    { id: "dune-slash", name: "Desert Slash", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 3 }, damage: 24, knockback: 0 },
    { id: "scorpion-sting", name: "Scorpion Sting", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 120, width: 16 }, damage: 22, knockback: 0 },
    { id: "flint-shot", name: "Flint Shot", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Point, range: 280 }, damage: 20, knockback: 0 },
    { id: "rapid-shot", name: "Rapid Shot", kind: "attack", cost: { red: 1 },
      shape: { kind: ShapeKind.Point, range: 240 }, damage: 10, knockback: 0 },
    { id: "double-slash", name: "Double Slash", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2 }, damage: 26, knockback: 0 },
    { id: "heat-shimmer", name: "Heat Shimmer", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Circle, radius: 70, range: 200 }, damage: 18, knockback: 0 },
    { id: "fang-strike", name: "Fang Strike", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 65, width: 12 }, damage: 20, knockback: 0 },
    { id: "searing-thrust", name: "Searing Thrust", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 130, width: 18 }, damage: 28, knockback: 0 },
    { id: "reaping-arc", name: "Reaping Arc", kind: "attack", cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: (240 / 360) * Math.PI }, damage: 38, knockback: 0 },
  ];
  for (const a of dim3) add(a);

  return pool;
}

function lcg(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 0x100000000; };
}

function isMelee(a: AttackAbility): boolean {
  const s = a.shape;
  if (s.kind === ShapeKind.Point) return false;
  if (s.kind === ShapeKind.Circle && s.range > 100) return false;
  return true;
}

function isRanged(a: AttackAbility): boolean {
  const s = a.shape;
  if (s.kind === ShapeKind.Point) return true;
  if (s.kind === ShapeKind.Circle && s.range > 100) return true;
  return false;
}

export function generateRandomLoadout(loadoutSeed: number): { template: UnitTemplate; abilities: AbilityDefinition[] } {
  const rng = lcg(loadoutSeed);
  const pool = [...ALL_WEAPON_ABILITIES];

  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const count = 3 + Math.floor(rng() * 3); // 3-5 abilities
  const picked: AttackAbility[] = [];
  let hasMelee = false, hasRanged = false;

  for (const a of pool) {
    if (picked.length >= count && hasMelee && hasRanged) break;
    if (picked.length >= count + 2) break; // hard cap
    picked.push(a);
    if (isMelee(a)) hasMelee = true;
    if (isRanged(a)) hasRanged = true;
  }

  // Ensure at least one melee if missing
  if (!hasMelee) {
    const m = pool.find(a => isMelee(a) && !picked.includes(a));
    if (m) picked.push(m);
  }
  // Ensure at least one ranged if missing
  if (!hasRanged) {
    const r = pool.find(a => isRanged(a) && !picked.includes(a));
    if (r) picked.push(r);
  }

  const abilities: AbilityDefinition[] = [
    { id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 130 },
    ...picked,
  ];

  return {
    abilities,
    template: { abilities, hp: 120, energy: { red: 2, blue: 2 }, collisionRadius: 16, className: "Solo" },
  };
}
