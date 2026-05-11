import { ShapeKind } from "./types.js";
import type { AbilityDefinition, AttackAbility, EntityEffect, MoveAbility, UnitTemplate } from "./types.js";

// --- Innate Abilities (always available) ---

export const INNATE_MOVE: MoveAbility = {
  id: "move",
  name: "Move",
  kind: "move",
  cost: { blue: 2 },
  variableCost: true,
  distance: 130,
};

export const INNATE_PUNCH: AttackAbility = {
  id: "punch",
  name: "Punch",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 4 },
  damage: 10,
  visual: { trailEffect: "slash", screenShake: 0.15 },
};

export const PLAYER_INNATE_ABILITIES: readonly AbilityDefinition[] = [INNATE_MOVE, INNATE_PUNCH];

// --- Weapon Abilities (granted by equipped items) ---

export const SHORT_SWORD_SLASH: AttackAbility = {
  id: "short-sword-slash",
  name: "Slash",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
  damage: 25,
  onHit: [{ type: "knockback", distance: 30 }],
  visual: { color: 0xc0c0c0, trailEffect: "slash", screenShake: 0.3 },
};

export const SHORT_SWORD_STAB: AttackAbility = {
  id: "short-sword-stab",
  name: "Stab",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 90, width: 12 },
  damage: 11,
  visual: { color: 0xc0c0c0, trailEffect: "thrust" },
};

export const SPEAR_THRUST: AttackAbility = {
  id: "spear-thrust",
  name: "Thrust",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 140, width: 20 },
  damage: 32,
  onHit: [{ type: "knockback", distance: 25 }],
  visual: { color: 0xa89070, trailEffect: "thrust", screenShake: 0.3 },
};

export const SPEAR_JAB: AttackAbility = {
  id: "spear-jab",
  name: "Shaft Strike",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
  damage: 10,
  onHit: [{ type: "knockback", distance: 45 }],
  visual: { color: 0xa89070, trailEffect: "slash", screenShake: 0.2 },
};

export const BOW_SHOT: AttackAbility = {
  id: "bow-shot",
  name: "Shot",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Point, range: 300 },
  damage: 20,
  ignoreCoverRange: 40,
  visual: { color: 0xd4a857, trailEffect: "projectile", screenShake: 0.15 },
};

export const BOW_VOLLEY: AttackAbility = {
  id: "bow-volley",
  name: "Volley",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 40, range: 250 },
  damage: 12,
  visual: { color: 0xd4a857, trailEffect: "projectile", screenShake: 0.1 },
};

// --- Enemy Abilities ---

export const GOBLIN_SPEAR_THRUST: AttackAbility = {
  id: "goblin-spear-thrust",
  name: "Spear Thrust",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 100, width: 18 },
  damage: 25,
  onHit: [{ type: "knockback", distance: 20 }],
  visual: { color: 0xa89070, trailEffect: "thrust", screenShake: 0.2 },
};

export const GOBLIN_BOW_SHOT: AttackAbility = {
  id: "goblin-bow-shot",
  name: "Bow Shot",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 260 },
  damage: 15,
  visual: { color: 0xd4a857, trailEffect: "projectile" },
};

export const SHIELD_BASH_ATTACK: AttackAbility = {
  id: "shield-bash",
  name: "Shield Bash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 4 },
  damage: 15,
  onHit: [{ type: "knockback", distance: 45 }],
  visual: { color: 0x8899aa, trailEffect: "slash", screenShake: 0.35 },
};

export const BRUTE_SLAM_ATTACK: AttackAbility = {
  id: "brute-slam",
  name: "Brute Slam",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 2 },
  damage: 40,
  onHit: [{ type: "knockback", distance: 50 }],
  visual: { color: 0x7a6040, trailEffect: "slash", screenShake: 0.6 },
};

export const GOLEM_SMASH_ATTACK: AttackAbility = {
  id: "golem-smash",
  name: "Golem Smash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 70, range: 60 },
  damage: 50,
  onHit: [{ type: "knockback", distance: 60 }],
  visual: { color: 0x8b7355, trailEffect: "explosion", screenShake: 0.8 },
};

export const SLIME_SPIT_ATTACK: AttackAbility = {
  id: "slime-spit",
  name: "Slime Spit",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 180 },
  damage: 12,
  visual: { color: 0x5cb85c, trailEffect: "projectile" },
};

export const SLIME_LASH_ATTACK: AttackAbility = {
  id: "slime-lash",
  name: "Slime Lash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 3 },
  damage: 20,
  onHit: [{ type: "knockback", distance: 20 }],
  visual: { color: 0x5cb85c, trailEffect: "splash", screenShake: 0.2 },
};

export const SLIME_WAVE_ATTACK: AttackAbility = {
  id: "slime-wave",
  name: "Slime Wave",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 80, range: 50 },
  damage: 35,
  onHit: [{ type: "knockback", distance: 35 }],
  visual: { color: 0x5cb85c, trailEffect: "splash", screenShake: 0.5 },
};

export function makeMove(distance: number): MoveAbility {
  return { id: "move", name: "Move", kind: "move", cost: { blue: 1 }, distance };
}

export type ItemRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type ItemType = "weapon" | "shield" | "consumable" | "accessory";

export type SlotType = "hand" | "hat" | "utility" | "accessory";

export type SlotCost = Partial<Record<SlotType, number>>;

export type AnimSet = "sword" | "spear" | "bow" | "staff" | "two-handed" | "dual-wield";

interface ItemBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rarity: ItemRarity;
  readonly sprite: string;
  readonly slotCost: SlotCost;
  readonly visualScale?: number;
  readonly abilities?: readonly AbilityDefinition[];
}

export interface WeaponItem extends ItemBase {
  readonly type: "weapon";
  readonly abilities: readonly AbilityDefinition[];
  readonly animSet: AnimSet;
}

export interface ShieldItem extends ItemBase {
  readonly type: "shield";
  readonly abilities: readonly AbilityDefinition[];
}

export interface ConsumableItem extends ItemBase {
  readonly type: "consumable";
  readonly effect: ConsumableEffect;
}

export interface AccessoryItem extends ItemBase {
  readonly type: "accessory";
  readonly statBonus: Partial<StatBonus>;
}

export type ConsumableEffect =
  | { kind: "heal"; amount: number }
  | { kind: "damage"; amount: number; radius: number };

export interface StatBonus {
  readonly hp: number;
  readonly movementBudget: number;
  readonly damage: number;
}

export type ItemDefinition = WeaponItem | ShieldItem | ConsumableItem | AccessoryItem;

export const ITEMS: Record<string, ItemDefinition> = {
  // ---- Row 0: swords, spear, axe ----
  "short-sword": {
    type: "weapon",
    id: "short-sword",
    name: "Short Sword",
    description: "A light blade suited for quick strikes.",
    rarity: "common",
    sprite: "short-sword",
    slotCost: { hand: 1 },
    abilities: [SHORT_SWORD_SLASH, SHORT_SWORD_STAB],
    animSet: "sword",
    visualScale: 2.0,
  },
  "long-sword": {
    type: "weapon",
    id: "long-sword",
    name: "Long Sword",
    description: "A versatile blade with good reach and damage.",
    rarity: "uncommon",
    sprite: "long-sword",
    slotCost: { hand: 1 },
    abilities: [{
      id: "long-sword-slash",
      name: "Long Slash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 100, halfAngle: Math.PI / 3 },
      damage: 35,
      onHit: [{ type: "knockback", distance: 35 }],
      visual: { color: 0xc0c0c0, trailEffect: "slash", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "long-sword-halfsword",
      name: "Half-sword",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 65, width: 22 },
      damage: 20,
      visual: { color: 0xc0c0c0, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility, {
      id: "long-sword-crosscut",
      name: "Cross-cut",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 2 },
      damage: 14,
      visual: { color: 0xc0c0c0, trailEffect: "slash", screenShake: 0.15 },
    } satisfies AttackAbility],
    animSet: "sword",
  },
  "spear": {
    type: "weapon",
    id: "spear",
    name: "Spear",
    description: "A long polearm with superior reach.",
    rarity: "common",
    sprite: "spear",
    slotCost: { hand: 1 },
    abilities: [SPEAR_THRUST, SPEAR_JAB],
    animSet: "spear",
  },
  "axe": {
    type: "weapon",
    id: "axe",
    name: "Axe",
    description: "A brutal chopping weapon that hits hard.",
    rarity: "common",
    sprite: "axe",
    slotCost: { hand: 1 },
    abilities: [{
      id: "axe-chop",
      name: "Chop",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 6 },
      damage: 40,
      onHit: [{ type: "knockback", distance: 40 }],
      visual: { color: 0x9a8060, trailEffect: "slash", screenShake: 0.45 },
    } satisfies AttackAbility, {
      id: "axe-hack",
      name: "Hack",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2 },
      damage: 16,
      visual: { color: 0x9a8060, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "sword",
    visualScale: 4,
  },

  // ---- Row 1: bow, broadsword, battle-axe, mace ----
  "bow": {
    type: "weapon",
    id: "bow",
    name: "Bow",
    description: "A ranged weapon that fires arrows at distant targets.",
    rarity: "common",
    sprite: "bow",
    slotCost: { hand: 2 },
    abilities: [BOW_SHOT, {
      id: "bow-piercing-arrow",
      name: "Piercing Arrow",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 220, width: 14 },
      damage: 14,
      visual: { color: 0xd4a857, trailEffect: "projectile", screenShake: 0.1 },
    } satisfies AttackAbility],
    animSet: "bow",
  },
  "broadsword": {
    type: "weapon",
    id: "broadsword",
    name: "Broadsword",
    description: "A heavy blade with a wide sweeping arc.",
    rarity: "uncommon",
    sprite: "broadsword",
    slotCost: { hand: 1 },
    abilities: [{
      id: "broadsword-sweep",
      name: "Sweep",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 2 },
      damage: 30,
      onHit: [{ type: "knockback", distance: 30 }],
      visual: { color: 0xb0b0b0, trailEffect: "slash", screenShake: 0.5 },
    } satisfies AttackAbility, {
      id: "broadsword-halfsword",
      name: "Half-sword",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 115, width: 18 },
      damage: 42,
      visual: { color: 0xb0b0b0, trailEffect: "thrust", screenShake: 0.4 },
    } satisfies AttackAbility, {
      id: "broadsword-pommel-strike",
      name: "Pommel Strike",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 4 },
      damage: 12,
      onHit: [{ type: "knockback", distance: 60 }],
      visual: { color: 0xb0b0b0, trailEffect: "slash", screenShake: 0.3 },
    } satisfies AttackAbility],
    animSet: "two-handed",
  },
  "battle-axe": {
    type: "weapon",
    id: "battle-axe",
    name: "Battle Axe",
    description: "A massive axe that cleaves through armor.",
    rarity: "rare",
    sprite: "battle-axe",
    slotCost: { hand: 2 },
    abilities: [{
      id: "battle-axe-cleave",
      name: "Cleave",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 85, halfAngle: Math.PI / 3 },
      damage: 45,
      onHit: [{ type: "knockback", distance: 50 }],
      visual: { color: 0x8a7050, trailEffect: "slash", screenShake: 0.6 },
    } satisfies AttackAbility, {
      id: "battle-axe-hook",
      name: "Hook",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 90, width: 35 },
      damage: 14,
      onHit: [{ type: "knockback", distance: 75 }],
      visual: { color: 0x8a7050, trailEffect: "slash", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "battle-axe-rend",
      name: "Rend",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 2 },
      damage: 20,
      visual: { color: 0x8a7050, trailEffect: "slash", screenShake: 0.3 },
    } satisfies AttackAbility],
    animSet: "two-handed",
  },
  "mace": {
    type: "weapon",
    id: "mace",
    name: "Mace",
    description: "A spiked bludgeon that delivers crushing blows.",
    rarity: "uncommon",
    sprite: "mace",
    slotCost: { hand: 1 },
    abilities: [{
      id: "mace-crush",
      name: "Crush",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 4 },
      damage: 30,
      onHit: [{ type: "knockback", distance: 55 }],
      visual: { color: 0x707070, trailEffect: "explosion", screenShake: 0.5 },
    } satisfies AttackAbility, {
      id: "mace-overhead",
      name: "Overhead Strike",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Circle, radius: 55, range: 0 },
      damage: 18,
      visual: { color: 0x707070, trailEffect: "explosion", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "mace-lunge",
      name: "Lunge",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 85, width: 20 },
      damage: 15,
      onHit: [{ type: "knockback", distance: 35 }],
      visual: { color: 0x707070, trailEffect: "thrust", screenShake: 0.25 },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  // ---- Row 2: shields, quiver ----
  "round-shield": {
    type: "shield",
    id: "round-shield",
    name: "Round Shield",
    description: "A simple wooden shield that blocks incoming damage.",
    rarity: "common",
    sprite: "round-shield",
    slotCost: { hand: 1 },
    abilities: [{
      id: "round-shield-block",
      name: "Block",
      kind: "barrier",
      cost: { blue: 1 },
      barrierHp: 10,
    }, {
      id: "round-shield-bash",
      name: "Shield Bash",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
      damage: 12,
      onHit: [{ type: "knockback", distance: 40 }],
      visual: { color: 0x8899aa, trailEffect: "slash", screenShake: 0.3 },
    } satisfies AttackAbility],
  },
  "kite-shield": {
    type: "shield",
    id: "kite-shield",
    name: "Kite Shield",
    description: "A sturdy metal shield offering strong protection.",
    rarity: "uncommon",
    sprite: "kite-shield",
    slotCost: { hand: 1 },
    abilities: [{
      id: "kite-shield-block",
      name: "Block",
      kind: "barrier",
      cost: { blue: 1 },
      barrierHp: 15,
    }, {
      id: "kite-shield-bash",
      name: "Shield Bash",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 4 },
      damage: 15,
      onHit: [{ type: "knockback", distance: 50 }],
      visual: { color: 0x8899aa, trailEffect: "slash", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "kite-shield-wall",
      name: "Shield Wall",
      kind: "barrier",
      cost: { blue: 2 },
      barrierHp: 30,
    }],
  },
  "buckler": {
    type: "shield",
    id: "buckler",
    name: "Buckler",
    description: "A small, light shield for parrying attacks.",
    rarity: "common",
    sprite: "buckler",
    slotCost: { hand: 1 },
    abilities: [{
      id: "buckler-block",
      name: "Block",
      kind: "barrier",
      cost: { blue: 1 },
      barrierHp: 5,
    }, {
      id: "buckler-punch",
      name: "Deflect Punch",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 45, halfAngle: Math.PI / 4 },
      damage: 8,
      onHit: [{ type: "knockback", distance: 35 }],
      visual: { color: 0x8899aa, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility],
  },
  "quiver": {
    type: "accessory",
    id: "quiver",
    name: "Quiver",
    description: "A leather quiver that improves ranged accuracy.",
    rarity: "common",
    sprite: "quiver",
    slotCost: { accessory: 1 },
    statBonus: { damage: 5 },
  },

  // ---- Row 3: staff, spellbook, potion, bomb ----
  "staff": {
    type: "weapon",
    id: "staff",
    name: "Staff",
    description: "A magical staff that channels arcane energy.",
    rarity: "rare",
    sprite: "staff",
    slotCost: { hand: 1, utility: 1 },
    abilities: [{
      id: "staff-blast",
      name: "Arcane Blast",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Circle, radius: 60, range: 200 },
      damage: 25,
      visual: { color: 0x7b68ee, trailEffect: "explosion", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "staff-bolt",
      name: "Arcane Bolt",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Point, range: 200 },
      damage: 11,
      visual: { color: 0x7b68ee, trailEffect: "projectile" },
    } satisfies AttackAbility, {
      id: "staff-push",
      name: "Arcane Push",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
      damage: 10,
      onHit: [{ type: "knockback", distance: 65 }],
      visual: { color: 0x7b68ee, trailEffect: "explosion", screenShake: 0.25 },
    } satisfies AttackAbility],
    animSet: "staff",
  },
  "spellbook": {
    type: "accessory",
    id: "spellbook",
    name: "Spellbook",
    description: "An ancient tome that bolsters the wielder's power.",
    rarity: "rare",
    sprite: "spellbook",
    slotCost: { accessory: 1 },
    statBonus: { damage: 10 },
  },
  "potion": {
    type: "consumable",
    id: "potion",
    name: "Health Potion",
    description: "A red brew that restores health when consumed.",
    rarity: "common",
    sprite: "potion",
    slotCost: { utility: 1 },
    effect: { kind: "heal", amount: 50 },
  },
  "bomb": {
    type: "consumable",
    id: "bomb",
    name: "Bomb",
    description: "An explosive device that damages all nearby enemies.",
    rarity: "uncommon",
    sprite: "bomb",
    slotCost: { utility: 1 },
    effect: { kind: "damage", amount: 40, radius: 80 },
  },
};

// --- Unit & Enemy Templates ---

export const UNIT_TEMPLATES = {
  player: {
    abilities: PLAYER_INNATE_ABILITIES,
    hp: 120,
    energy: { red: 2, blue: 2 },
    collisionRadius: 16,
    className: "Player",
    heightMeters: 2,
  },
} as const satisfies Record<string, UnitTemplate>;

export const ENEMY_TEMPLATES = {
  "goblin-spear": {
    abilities: [makeMove(150), GOBLIN_SPEAR_THRUST],
    hp: 80,
    energy: { red: 1, blue: 1 },
    collisionRadius: 14,
    className: "Goblin Spearman",
    spriteType: "goblin-spear",
    heightMeters: 1.5,
    strategy: "rush",
    cost: 3,
    tags: ["melee"],
  },
  "goblin-archer": {
    abilities: [makeMove(140), GOBLIN_BOW_SHOT],
    hp: 55,
    energy: { red: 1, blue: 2 },
    collisionRadius: 12,
    className: "Goblin Archer",
    spriteType: "goblin-archer",
    heightMeters: 1.5,
    strategy: "kite",
    cost: 3,
    tags: ["ranged"],
  },
  "goblin-shield": {
    abilities: [makeMove(110), SHIELD_BASH_ATTACK],
    hp: 110,
    energy: { red: 1, blue: 2 },
    collisionRadius: 16,
    className: "Goblin Shield",
    spriteType: "goblin-shield",
    heightMeters: 1.5,
    strategy: "rush",
    cost: 4,
    tags: ["melee", "tank"],
  },
  "goblin-brute": {
    abilities: [makeMove(90), BRUTE_SLAM_ATTACK],
    hp: 160,
    energy: { red: 1, blue: 1 },
    collisionRadius: 20,
    className: "Goblin Brute",
    spriteType: "goblin-brute",
    heightMeters: 1.75,
    strategy: "rush",
    cost: 6,
    tags: ["melee", "elite"],
  },
  "stone-golem": {
    abilities: [makeMove(70), GOLEM_SMASH_ATTACK],
    hp: 250,
    energy: { red: 1, blue: 1 },
    collisionRadius: 22,
    className: "Stone Golem",
    spriteType: "stone-golem",
    heightMeters: 3,
    strategy: "threat",
    cost: 10,
    tags: ["melee", "tank", "boss"],
  },
  "slime": {
    abilities: [makeMove(120), SLIME_SPIT_ATTACK],
    hp: 40,
    energy: { red: 1, blue: 2 },
    collisionRadius: 12,
    className: "Slime",
    spriteType: "slime",
    heightMeters: 1.5,
    strategy: "kite",
    cost: 1,
    tags: ["ranged", "swarm"],
  },
  "big-slime": {
    abilities: [makeMove(100), SLIME_LASH_ATTACK],
    hp: 90,
    energy: { red: 1, blue: 2 },
    collisionRadius: 18,
    className: "Big Slime",
    spriteType: "slime",
    heightMeters: 3,
    strategy: "rush",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "slime", count: 2 } }],
    cost: 6,
    tags: ["melee", "tank", "elite"],
  },
  "massive-slime": {
    abilities: [makeMove(70), SLIME_WAVE_ATTACK],
    hp: 200,
    energy: { red: 1, blue: 1 },
    collisionRadius: 28,
    className: "Massive Slime",
    spriteType: "slime",
    heightMeters: 6,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "big-slime", count: 2 } }],
    cost: 14,
    tags: ["melee", "tank", "boss"],
  },
} as const satisfies Record<string, UnitTemplate>;
