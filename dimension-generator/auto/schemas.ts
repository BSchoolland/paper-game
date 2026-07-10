import { z } from "./llm.js";

const sectorShape = z.object({ kind: z.literal("sector"), radius: z.number(), halfAngle: z.number() });
const rectangleShape = z.object({ kind: z.literal("rectangle"), length: z.number(), width: z.number() });
const circleShape = z.object({ kind: z.literal("circle"), radius: z.number(), range: z.number() });
const pointShape = z.object({ kind: z.literal("point"), range: z.number() });
export const combatShape = z.union([sectorShape, rectangleShape, circleShape, pointShape]);

export const weaponEffect = z.union([
  z.object({ type: z.literal("pull"), distance: z.number() }),
  z.object({ type: z.literal("applyStatus"), status: z.enum(["slowed", "winded", "suppressed", "rooted"]), duration: z.number(), value: z.number() }),
  z.object({ type: z.literal("swap") }).describe("Attacker and target trade places. Point-shape single-target abilities only."),
]);

export const damageRider = z.union([
  z.object({ when: z.literal("target-has-status"), status: z.enum(["slowed", "winded", "suppressed", "rooted"]), amount: z.number(), label: z.string().optional() }),
  z.object({ when: z.literal("target-below-hp"), pct: z.number().describe("0-1 fraction, e.g. 0.35"), amount: z.number(), label: z.string().optional() }),
  z.object({ when: z.literal("target-at-full-hp"), amount: z.number(), label: z.string().optional() }),
  z.object({ when: z.literal("target-near-wall"), within: z.number().describe("px from a wall"), amount: z.number(), label: z.string().optional() }),
]);

const energyCost = z.object({ red: z.number().optional(), blue: z.number().optional() });

export const attackAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("attack"),
  cost: energyCost,
  shape: combatShape,
  damage: z.number(),
  knockback: z.number(),
  recoil: z.number().optional(),
  lungeThrough: z.number().optional(),
  wallSlamDamage: z.number().optional(),
  onHit: z.array(weaponEffect).optional(),
  riders: z.array(damageRider).optional().describe("Conditional bonus damage — the tool for set-up/payoff kits"),
  onKill: energyCost.optional().describe("Energy refunded to the attacker per kill"),
  uses: z.number().optional().describe("Per-encounter charges; omit for unlimited"),
  visual: z.object({
    color: z.number().optional().describe("Hex number like 0xd4a533"),
    trailEffect: z.enum(["slash", "thrust", "projectile", "explosion", "splash"]).optional(),
    screenShake: z.number().optional(),
  }).optional(),
});

const moveAbility = z.object({
  id: z.literal("move"),
  name: z.literal("Move"),
  kind: z.literal("move"),
  cost: z.object({ blue: z.number() }),
  distance: z.number(),
});

/** A granted movement ability (blink or extra dash) — unlike the innate `move`, id is free-form. */
export const grantedMoveAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("move"),
  cost: energyCost,
  distance: z.number(),
  mode: z.enum(["walk", "blink"]).optional().describe("blink teleports over walls/bodies to a standable spot"),
  uses: z.number().optional(),
});

const barrierAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("barrier"),
  cost: energyCost,
  barrierHp: z.number(),
  uses: z.number().optional(),
});

const zoneSpec = z.object({
  effect: z.enum(["damage", "heal", "addBarrier", "drainRed", "drainBlue", "cover", "wall"]),
  radius: z.number(),
  duration: z.number(),
  magnitude: z.number(),
  color: z.number(),
  pattern: z.enum(["spikes", "pulse", "shield", "drain", "lattice", "solid"]).optional(),
});

const zoneAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("zone"),
  cost: energyCost,
  range: z.number(),
  zone: zoneSpec,
  uses: z.number().optional(),
});

export const summonAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("summon"),
  cost: energyCost,
  templateKey: z.string().describe("Must exist in the template registry — a dimension enemy key or an ITEM_SUMMON_TEMPLATES key"),
  count: z.number(),
  range: z.number(),
  uses: z.number().optional(),
});

export const convertAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("convert"),
  cost: energyCost.describe("What is paid"),
  gain: energyCost.describe("What is credited (clamped to the bank cap)"),
  uses: z.number().optional(),
});

export const restoreAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("restore"),
  cost: energyCost,
  hp: z.number().optional(),
  red: z.number().optional(),
  blue: z.number().optional(),
  uses: z.number().optional(),
});

export const abilityDef = z.union([attackAbility, moveAbility, barrierAbility, zoneAbility, summonAbility, convertAbility, restoreAbility]);

/** Abilities an ITEM may grant (the innate `move` literal is excluded; granted moves are free-form). */
export const itemAbility = z.union([attackAbility, grantedMoveAbility, barrierAbility, zoneAbility, summonAbility, convertAbility, restoreAbility]);

export const auraSpec = z.object({
  effect: z.enum(["damage", "heal", "addBarrier", "drainRed", "drainBlue"]),
  radius: z.number(),
  magnitude: z.number().describe("Applies EVERY turn-start (both teams' flips) — keep small"),
  color: z.number(),
  pattern: z.enum(["spikes", "pulse", "shield", "drain", "lattice", "solid"]).optional(),
  affects: z.enum(["allies", "enemies"]).describe("allies includes the owner"),
});

export const passiveEffect = z.union([
  z.object({ type: z.literal("aura"), aura: auraSpec }),
  z.object({ type: z.literal("onKillEnergy"), red: z.number().optional(), blue: z.number().optional() }),
  z.object({ type: z.literal("maxHp"), amount: z.number() }),
  z.object({ type: z.literal("regen"), red: z.number().optional(), blue: z.number().optional() }),
]);

export const entityEffect = z.object({
  trigger: z.literal("onDeath"),
  action: z.object({
    type: z.literal("spawn"),
    templateKey: z.string().describe("Key of another enemy in this dimension to spawn on death"),
    count: z.number(),
  }),
});

export const enemyTemplate = z.object({
  abilities: z.array(abilityDef).describe("First ability MUST be a move. Then 1-3 attack/barrier/zone abilities."),
  hp: z.number(),
  energy: z.object({ red: z.number(), blue: z.number() }),
  collisionRadius: z.number().describe("Hitbox radius in pixels. 10-14 small, 14-20 medium, 20-30 large"),
  className: z.string().describe("Display name"),
  heightMeters: z.number().describe("1.0=tiny, 2.0=player-sized, 3.0+=large, 5.0=colossal"),
  strategy: z.enum(["rush", "kite", "threat"]).describe("rush=melee charger, kite=ranged stay-away, threat=boss/tank focus priority target"),
  cost: z.number().describe("Budget cost: 1-2=fodder, 3-5=standard, 6-9=elite, 10-15=boss"),
  tags: z.array(z.enum(["melee", "ranged", "tank", "swarm", "elite", "boss"])),
  effects: z.array(entityEffect).optional(),
  passives: z.array(passiveEffect).optional(),
});

export type EnemyTemplate = z.infer<typeof enemyTemplate>;

export const upsertEnemySchema = z.object({
  id: z.string().describe("Kebab-case key, e.g. 'sand-skitter'"),
  template: enemyTemplate,
});

const itemRarity = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);

const itemBase = {
  id: z.string().describe("Kebab-case, e.g. 'dune-cleaver'"),
  name: z.string(),
  description: z.string(),
  rarity: itemRarity,
  dimensionId: z.number(),
  passives: z.array(passiveEffect).optional(),
};

export const weaponItemSchema = z.object({
  ...itemBase,
  slotCost: z.object({
    hand: z.number().describe("1 for one-handed, 2 for two-handed"),
  }),
  abilities: z.array(itemAbility).min(2).max(3).describe("2 abilities for common, 2-3 for uncommon+"),
  animSet: z.enum(["sword", "spear", "bow", "staff", "two-handed", "dual-wield"]),
});

export const shieldItemSchema = z.object({
  ...itemBase,
  slotCost: z.object({ hand: z.number() }),
  abilities: z.array(itemAbility).min(1).max(2),
});

export const accessoryItemSchema = z.object({
  ...itemBase,
  slotCost: z.object({ accessory: z.number() }),
  passives: z.array(passiveEffect).min(1).describe("Accessories carry rules — at least one passive"),
  abilities: z.array(itemAbility).max(1).optional(),
});

export const consumableItemSchema = z.object({
  ...itemBase,
  slotCost: z.object({ utility: z.number() }),
  abilities: z.array(itemAbility).min(1).max(1).describe("One charged ability — it MUST declare uses (usually 1)"),
});

export const ITEM_SCHEMAS = {
  weapon: weaponItemSchema,
  shield: shieldItemSchema,
  accessory: accessoryItemSchema,
  consumable: consumableItemSchema,
} as const;

export type ItemType = keyof typeof ITEM_SCHEMAS;

export type WeaponItem = z.infer<typeof weaponItemSchema>;
