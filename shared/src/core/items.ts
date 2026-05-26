import { ShapeKind } from "./types.js";
import type { AbilityDefinition, AttackAbility, MoveAbility, UnitTemplate } from "./types.js";

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
  knockback: 0,
  visual: { trailEffect: "slash", screenShake: 0.15 },
};

export const PLAYER_INNATE_ABILITIES: readonly AbilityDefinition[] = [INNATE_MOVE, INNATE_PUNCH];



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
  readonly dimensionId: number;
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

// --- Unit & Enemy Templates ---

export const UNIT_TEMPLATES = {
  player: {
    abilities: PLAYER_INNATE_ABILITIES,
    hp: 120,
    energy: { red: 2, blue: 2 },
    energyBankFactor: 1,
    collisionRadius: 16,
    className: "Player",
    heightMeters: 2,
  },
} as const satisfies Record<string, UnitTemplate>;

