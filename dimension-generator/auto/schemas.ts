import { z } from "./llm.js";

const sectorShape = z.object({ kind: z.literal("sector"), radius: z.number(), halfAngle: z.number() });
const rectangleShape = z.object({ kind: z.literal("rectangle"), length: z.number(), width: z.number() });
const circleShape = z.object({ kind: z.literal("circle"), radius: z.number(), range: z.number() });
const pointShape = z.object({ kind: z.literal("point"), range: z.number() });
export const combatShape = z.union([sectorShape, rectangleShape, circleShape, pointShape]);

export const weaponEffect = z.union([
  z.object({ type: z.literal("pull"), distance: z.number() }),
  z.object({ type: z.literal("applyStatus"), status: z.enum(["slowed", "winded", "suppressed", "rooted"]), duration: z.number(), value: z.number() }),
]);

export const kitRule = z.object({
  cooldown: z.number().optional().describe("Turns locked after use: 1=once per turn, 2=every other turn, 3=every third turn"),
  hpBelow: z.number().optional().describe("Phase gate: usable only at or below this HP fraction (0.5 = unlocks below half health)"),
  hpAbove: z.number().optional().describe("Phase gate: usable only above this HP fraction. Pair with an hpBelow twin on another ability to swap in an empowered version"),
  minTargets: z.number().optional().describe("AI only fires this if it would hit at least N players — save big AoEs for clumps"),
  priority: z.number().optional().describe("AI tries higher priority first; ties keep list order. Default 0"),
}).describe("Attack-kit gating for bosses/elites: cooldowns + HP phases turn multiple abilities into a learnable rotation. Omit entirely for simple enemies (a kit of one)");

export const attackAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("attack"),
  kit: kitRule.optional(),
  cost: z.object({ red: z.number().optional(), blue: z.number().optional() }),
  shape: combatShape,
  damage: z.number(),
  knockback: z.number(),
  recoil: z.number().optional(),
  lungeThrough: z.number().optional(),
  wallSlamDamage: z.number().optional(),
  onHit: z.array(weaponEffect).optional(),
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

const barrierAbility = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("barrier"),
  kit: kitRule.optional(),
  cost: z.object({ red: z.number().optional(), blue: z.number().optional() }),
  barrierHp: z.number(),
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
  kit: kitRule.optional().describe("Zones/barriers on kit enemies are only cast when they carry a kit rule"),
  cost: z.object({ red: z.number().optional(), blue: z.number().optional() }),
  range: z.number(),
  zone: zoneSpec,
});

export const abilityDef = z.union([attackAbility, moveAbility, barrierAbility, zoneAbility]);

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
});

export type EnemyTemplate = z.infer<typeof enemyTemplate>;

export const upsertEnemySchema = z.object({
  id: z.string().describe("Kebab-case key, e.g. 'sand-skitter'"),
  template: enemyTemplate,
});

export const weaponItemSchema = z.object({
  id: z.string().describe("Kebab-case, e.g. 'dune-cleaver'"),
  name: z.string(),
  description: z.string(),
  rarity: z.enum(["common", "uncommon", "rare"]),
  dimensionId: z.number(),
  slotCost: z.object({
    hand: z.number().describe("1 for one-handed, 2 for two-handed"),
  }),
  abilities: z.array(attackAbility).min(2).max(3).describe("2 abilities for common, 2-3 for uncommon+"),
  animSet: z.enum(["sword", "spear", "bow", "staff", "two-handed", "dual-wield"]),
});

export type WeaponItem = z.infer<typeof weaponItemSchema>;
