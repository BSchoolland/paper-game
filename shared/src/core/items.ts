import { SHORT_SWORD_SLASH, SHORT_SWORD_STAB, SPEAR_THRUST, SPEAR_JAB, BOW_SHOT, BOW_SNAP_SHOT } from "./types.js";
import type { AbilityDefinition, AttackAbility } from "./types.js";

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
      shape: { kind: "sector", radius: 100, halfAngle: Math.PI / 3 },
      damage: 35,
      onHit: [{ type: "knockback", distance: 35 }],
    } satisfies AttackAbility, {
      id: "long-sword-thrust",
      name: "Thrust",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: "rectangle", length: 90, width: 18 },
      damage: 20,
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
      shape: { kind: "sector", radius: 75, halfAngle: Math.PI / 4 },
      damage: 35,
      onHit: [{ type: "knockback", distance: 40 }],
    } satisfies AttackAbility, {
      id: "axe-hack",
      name: "Hack",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: "sector", radius: 65, halfAngle: Math.PI / 6 },
      damage: 20,
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
    abilities: [BOW_SHOT, BOW_SNAP_SHOT],
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
      shape: { kind: "sector", radius: 90, halfAngle: Math.PI / 2 },
      damage: 40,
      onHit: [{ type: "knockback", distance: 35 }],
    } satisfies AttackAbility, {
      id: "broadsword-pommel-strike",
      name: "Pommel Strike",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: "sector", radius: 60, halfAngle: Math.PI / 4 },
      damage: 18,
      onHit: [{ type: "knockback", distance: 25 }],
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
      shape: { kind: "sector", radius: 85, halfAngle: Math.PI / 3 },
      damage: 45,
      onHit: [{ type: "knockback", distance: 50 }],
    } satisfies AttackAbility, {
      id: "battle-axe-hook",
      name: "Hook",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: "sector", radius: 70, halfAngle: Math.PI / 5 },
      damage: 22,
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
      shape: { kind: "sector", radius: 70, halfAngle: Math.PI / 4 },
      damage: 30,
      onHit: [{ type: "knockback", distance: 55 }],
    } satisfies AttackAbility, {
      id: "mace-swing",
      name: "Swing",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: "sector", radius: 60, halfAngle: Math.PI / 3 },
      damage: 15,
      onHit: [{ type: "knockback", distance: 35 }],
    } satisfies AttackAbility],
    animSet: "sword",
  },

  // ---- Row 2: shields, quiver ----
  "round-shield": {
    type: "shield",
    id: "round-shield",
    name: "Round Shield",
    description: "A simple wooden shield that blocks some damage.",
    rarity: "common",
    sprite: "round-shield",
    slotCost: { hand: 1 },
    abilities: [{
      id: "round-shield-block",
      name: "Block",
      kind: "buff",
      cost: { blue: 1 },
      effect: { type: "block", damageReduction: 10 },
    }],
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
      kind: "buff",
      cost: { blue: 1 },
      effect: { type: "block", damageReduction: 15 },
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
      name: "Parry",
      kind: "buff",
      cost: { blue: 1 },
      effect: { type: "block", damageReduction: 5 },
    }],
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
      shape: { kind: "circle", radius: 60, range: 200 },
      damage: 25,
    } satisfies AttackAbility, {
      id: "staff-bolt",
      name: "Arcane Bolt",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: "point", range: 160 },
      damage: 12,
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
