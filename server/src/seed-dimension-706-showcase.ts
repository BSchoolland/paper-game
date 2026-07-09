/**
 * The loot-overhaul showcase roster for dimension 706 (Verdant Colossus): eleven hand-authored
 * items exercising every new verb across the full rarity ladder, following the "rarity buys
 * rules" contract — commons get a spatial twist, rares get internal synergy, epics change a
 * rule, the legendary is a build-around. Re-upserted on every boot like the other static seeds.
 *
 * Sprites reuse the dimension's existing generated art (the sprite field is a filename in
 * public/sprites/items/dimension-706/) — showcase items have no art of their own yet.
 */
import { ShapeKind } from "shared";
import type { AttackAbility, BarrierAbility, ConvertAbility, ItemDefinition, MoveAbility, RestoreAbility, SummonAbility } from "shared";
import { saveItems, loadDimension } from "./db.js";

const GREEN = 0x4e8c3a;
const STORM = 0x7b68ee;
const STONE = 0x9a8f7a;
const EMBER = 0xd4a533;

const ITEMS: Record<string, ItemDefinition> = {
  // ---- common: a solid stick with one spatial twist ----
  "d706-vinewalker-machete": {
    type: "weapon",
    id: "d706-vinewalker-machete",
    name: "Vinewalker Machete",
    description: "A trail-cutter's blade. It wants you moving forward.",
    rarity: "common",
    sprite: "machete",
    dimensionId: 706,
    slotCost: { hand: 1 },
    animSet: "sword",
    abilities: [
      {
        id: "d706-vinewalker-slash", name: "Clearing Slash", kind: "attack", cost: { red: 2 },
        shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
        damage: 32, knockback: 0,
        visual: { color: GREEN, trailEffect: "slash", screenShake: 0.3 },
      } satisfies AttackAbility,
      {
        id: "d706-vinewalker-press", name: "Press On", kind: "attack", cost: { red: 1 },
        shape: { kind: ShapeKind.Rectangle, length: 95, width: 18 },
        damage: 16, knockback: 0, lungeThrough: 45,
        visual: { color: GREEN, trailEffect: "thrust", screenShake: 0.2 },
      } satisfies AttackAbility,
    ],
  },

  // ---- uncommon: spatial control kit ----
  "d706-wardens-pike": {
    type: "weapon",
    id: "d706-wardens-pike",
    name: "Warden's Pike",
    description: "Keeps the jungle — and everything in it — at pole's length.",
    rarity: "uncommon",
    sprite: "siege-pike",
    dimensionId: 706,
    slotCost: { hand: 2 },
    animSet: "spear",
    abilities: [
      {
        id: "d706-pike-thrust", name: "Long Thrust", kind: "attack", cost: { red: 2 },
        shape: { kind: ShapeKind.Rectangle, length: 135, width: 14 },
        damage: 30, knockback: 0,
        visual: { color: STONE, trailEffect: "thrust", screenShake: 0.3 },
      } satisfies AttackAbility,
      {
        id: "d706-pike-hook", name: "Hooked Haul", kind: "attack", cost: { red: 1 },
        shape: { kind: ShapeKind.Point, range: 140 },
        damage: 8, knockback: 0, onHit: [{ type: "pull", distance: 60 }],
        visual: { color: STONE, trailEffect: "projectile" },
      } satisfies AttackAbility,
      {
        id: "d706-pike-fend", name: "Fend Off", kind: "attack", cost: { red: 1 },
        shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2.5 },
        damage: 12, knockback: 55, recoil: 30,
        visual: { color: STONE, trailEffect: "slash", screenShake: 0.25 },
      } satisfies AttackAbility,
    ],
  },

  // ---- rare: internal synergy (set up, then punish) ----
  "d706-sentinels-riposte": {
    type: "weapon",
    id: "d706-sentinels-riposte",
    name: "Sentinel's Riposte",
    description: "A golem-forged saber that rewards the patient cut.",
    rarity: "rare",
    sprite: "sentinel-blade",
    dimensionId: 706,
    slotCost: { hand: 1 },
    animSet: "sword",
    abilities: [
      {
        id: "d706-riposte-guardbreak", name: "Guardbreak", kind: "attack", cost: { red: 2 },
        shape: { kind: ShapeKind.Sector, radius: 85, halfAngle: Math.PI / 3 },
        damage: 24, knockback: 0,
        onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.4 }],
        visual: { color: 0xb0c4de, trailEffect: "slash", screenShake: 0.3 },
      } satisfies AttackAbility,
      {
        id: "d706-riposte-punish", name: "Punish", kind: "attack", cost: { red: 1 },
        shape: { kind: ShapeKind.Point, range: 95 },
        damage: 16, knockback: 0,
        riders: [{ when: "target-has-status", status: "slowed", amount: 16, label: "PUNISHED" }],
        visual: { color: 0xb0c4de, trailEffect: "thrust", screenShake: 0.35 },
      } satisfies AttackAbility,
      {
        id: "d706-riposte-backstep", name: "Backstep Cut", kind: "attack", cost: { red: 1 },
        shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
        damage: 14, knockback: 0, recoil: 45,
        visual: { color: 0xb0c4de, trailEffect: "slash", screenShake: 0.2 },
      } satisfies AttackAbility,
    ],
  },

  // ---- rare: hunter kit (root, then cull) ----
  "d706-rootbinder-bow": {
    type: "weapon",
    id: "d706-rootbinder-bow",
    name: "Rootbinder Bow",
    description: "Its arrows sprout on impact. The jungle holds what it catches.",
    rarity: "rare",
    sprite: "ironwood-bow",
    dimensionId: 706,
    slotCost: { hand: 2 },
    animSet: "bow",
    abilities: [
      {
        id: "d706-rootbinder-snare", name: "Root Arrow", kind: "attack", cost: { red: 2 },
        shape: { kind: ShapeKind.Point, range: 230 },
        damage: 14, knockback: 0,
        onHit: [{ type: "applyStatus", status: "rooted", duration: 1, value: 1 }],
        visual: { color: GREEN, trailEffect: "projectile", screenShake: 0.2 },
      } satisfies AttackAbility,
      {
        id: "d706-rootbinder-cull", name: "Cull the Bound", kind: "attack", cost: { red: 2 },
        shape: { kind: ShapeKind.Rectangle, length: 210, width: 16 },
        damage: 20, knockback: 0,
        riders: [{ when: "target-has-status", status: "rooted", amount: 18, label: "CULLED" }],
        visual: { color: GREEN, trailEffect: "projectile", screenShake: 0.3 },
      } satisfies AttackAbility,
    ],
  },

  // ---- epic: rule-changers (a weapon that moves you, and moves them) ----
  "d706-ziggurat-stormcaller": {
    type: "weapon",
    id: "d706-ziggurat-stormcaller",
    name: "Ziggurat Stormcaller",
    description: "The spire-priests didn't walk between towers. Neither do you.",
    rarity: "epic",
    sprite: "sorcerers-staff",
    dimensionId: 706,
    slotCost: { hand: 2 },
    animSet: "staff",
    abilities: [
      {
        id: "d706-storm-bolt", name: "Stormbolt", kind: "attack", cost: { red: 2 },
        shape: { kind: ShapeKind.Point, range: 220 },
        damage: 26, knockback: 0,
        visual: { color: STORM, trailEffect: "projectile", screenShake: 0.3 },
      } satisfies AttackAbility,
      {
        id: "d706-storm-step", name: "Thunderstep", kind: "move", cost: { blue: 2 },
        distance: 130, mode: "blink",
      } satisfies MoveAbility,
      {
        id: "d706-storm-transposition", name: "Transposition", kind: "attack", cost: { red: 1 },
        shape: { kind: ShapeKind.Point, range: 160 },
        damage: 6, knockback: 0, onHit: [{ type: "swap" }],
        visual: { color: STORM, trailEffect: "projectile", screenShake: 0.25 },
      } satisfies AttackAbility,
    ],
  },

  // ---- legendary: the build-around ----
  "d706-heart-of-the-colossus": {
    type: "weapon",
    id: "d706-heart-of-the-colossus",
    name: "Heart of the Colossus",
    description: "A construction golem's core, hafted. It remembers how to demolish — and it does not tire.",
    rarity: "legendary",
    sprite: "stone-maul",
    dimensionId: 706,
    slotCost: { hand: 2 },
    animSet: "two-handed",
    passives: [{ type: "maxHp", amount: 25 }],
    abilities: [
      {
        id: "d706-colossus-smash", name: "Demolishing Blow", kind: "attack", cost: { red: 3 },
        shape: { kind: ShapeKind.Sector, radius: 95, halfAngle: Math.PI / 3 },
        damage: 42, knockback: 70, wallSlamDamage: 22, onKill: { red: 2 },
        riders: [{ when: "target-near-wall", within: 45, amount: 12, label: "CRUSHED" }],
        visual: { color: STONE, trailEffect: "explosion", screenShake: 0.6 },
      } satisfies AttackAbility,
      {
        id: "d706-colossus-toll", name: "Seismic Toll", kind: "attack", cost: { red: 2 },
        shape: { kind: ShapeKind.Circle, radius: 110, range: 20 },
        damage: 18, knockback: 40,
        visual: { color: STONE, trailEffect: "splash", screenShake: 0.5 },
      } satisfies AttackAbility,
      {
        id: "d706-colossus-tireless", name: "Tireless Engine", kind: "convert", cost: { blue: 2 },
        gain: { red: 1 },
      } satisfies ConvertAbility,
    ],
  },

  // ---- shield ----
  "d706-bulwark-of-vines": {
    type: "shield",
    id: "d706-bulwark-of-vines",
    name: "Bulwark of Vines",
    description: "Living wood over a golem plate. It grows back between fights.",
    rarity: "uncommon",
    sprite: "sledgehammer",
    dimensionId: 706,
    slotCost: { hand: 1 },
    passives: [{ type: "maxHp", amount: 15 }],
    abilities: [
      {
        id: "d706-bulwark-brace", name: "Brace", kind: "barrier", cost: { blue: 2 }, barrierHp: 35,
      } satisfies BarrierAbility,
    ],
  },

  // ---- accessories: rules, not stat sticks ----
  "d706-verdant-idol": {
    type: "accessory",
    id: "d706-verdant-idol",
    name: "Verdant Idol",
    description: "Moss creeps from it toward every wound nearby.",
    rarity: "rare",
    sprite: "stone-staff",
    dimensionId: 706,
    slotCost: { accessory: 1 },
    passives: [
      { type: "aura", aura: { effect: "heal", radius: 90, magnitude: 4, color: GREEN, pattern: "pulse", affects: "allies" } },
    ],
  },
  "d706-quarry-sigil": {
    type: "accessory",
    id: "d706-quarry-sigil",
    name: "Quarry Sigil",
    description: "The old foremen's mark: finish a job, catch your breath.",
    rarity: "uncommon",
    sprite: "chisel-blade",
    dimensionId: 706,
    slotCost: { accessory: 1 },
    passives: [
      { type: "onKillEnergy", blue: 1 },
      { type: "maxHp", amount: 5 },
    ],
  },

  // ---- consumables: per-encounter charges ----
  "d706-sapling-heart": {
    type: "consumable",
    id: "d706-sapling-heart",
    name: "Sapling Heart",
    description: "Plant it anywhere with a pulse of red. Something loyal grows.",
    rarity: "uncommon",
    sprite: "rail-spike",
    dimensionId: 706,
    slotCost: { utility: 1 },
    abilities: [
      {
        id: "d706-sapling-call", name: "Plant Sapling", kind: "summon", cost: { red: 1 },
        templateKey: "item-sapling-warden", count: 1, range: 110, uses: 1,
      } satisfies SummonAbility,
    ],
  },
  "d706-stoneblood-draught": {
    type: "consumable",
    id: "d706-stoneblood-draught",
    name: "Stoneblood Draught",
    description: "Golem coolant, drinkable. Barely.",
    rarity: "common",
    sprite: "masons-pick",
    dimensionId: 706,
    slotCost: { utility: 1 },
    abilities: [
      {
        id: "d706-stoneblood-drink", name: "Drink", kind: "restore", cost: {},
        hp: 45, uses: 1,
      } satisfies RestoreAbility,
    ],
  },
};

export function seedDimension706Showcase(): void {
  // The 706 dimension row is generated content that lives only in DBs where the generator ran —
  // don't orphan showcase items into DBs that don't have the dimension.
  if (!loadDimension(706)) {
    console.log("[seed] dimension 706 absent — skipping loot-overhaul showcase items");
    return;
  }
  saveItems(706, ITEMS);
}
