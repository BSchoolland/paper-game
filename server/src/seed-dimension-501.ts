import { ShapeKind } from "shared";
import type { AttackAbility, MoveAbility, SpriteSet, UnitTemplate, ItemDefinition } from "shared";
import type { StructureEntry } from "shared";
import { saveDimension, saveEnemyTemplates, saveItems } from "./db.js";

function enemySprites(name: string): SpriteSet {
  const base = `/api/sprites/enemies/dimension-501/${name}/${name}`;
  return {
    idle: `${base}-idle.png`,
    attack: `${base}-attack.png`,
    hit: `${base}-hit.png`,
    move: `${base}-move.png`,
  };
}

function makeMove(distance: number): MoveAbility {
  return { id: "move", name: "Move", kind: "move", cost: { blue: 1 }, distance };
}

// =============================================================================
// ENEMIES — Clay Flats
// Mechanical identity: Grabs, roots, and attrition.
// =============================================================================

// --- Fodder ---

const DUST_RAT_BITE: AttackAbility = {
  id: "dust-rat-bite",
  name: "Bite",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 40, halfAngle: Math.PI / 4 },
  damage: 8,
  knockback: 0,
  visual: { color: 0x8a6d3b, trailEffect: "slash", screenShake: 0.1 },
};

const RIVER_SNAPPER_SNAP: AttackAbility = {
  id: "river-snapper-snap",
  name: "Snap",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 45, halfAngle: Math.PI / 5 },
  damage: 10,
  knockback: 0,
  visual: { color: 0x7a5c3a, trailEffect: "slash", screenShake: 0.15 },
};

const CLAY_CRAWLER_GRAB: AttackAbility = {
  id: "clay-crawler-grab",
  name: "Grab",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 35, halfAngle: Math.PI / 3 },
  damage: 6,
  knockback: 0,
  onHit: [{ type: "applyStatus", status: "rooted", duration: 1, value: 1 }],
  visual: { color: 0xc8955a, trailEffect: "slash", screenShake: 0.1 },
};

const SCRUB_HOUND_SNAP: AttackAbility = {
  id: "scrub-hound-snap",
  name: "Lunge Bite",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 60, width: 14 },
  damage: 9,
  knockback: 0,
  visual: { color: 0x8a6d3b, trailEffect: "thrust", screenShake: 0.15 },
};

// --- Standard ---

const GULLY_RAIDER_SLASH: AttackAbility = {
  id: "gully-raider-slash",
  name: "Short Slash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 3 },
  damage: 18,
  knockback: 0,
  visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.25 },
};

const GULLY_RAIDER_SHIELD_BASH: AttackAbility = {
  id: "gully-raider-shield-bash",
  name: "Shield Bash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 45, halfAngle: Math.PI / 4 },
  damage: 10,
  knockback: 30,
  visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.3 },
};

const MUD_SLINGER_LOB: AttackAbility = {
  id: "mud-slinger-lob",
  name: "Clay Lob",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 200 },
  damage: 12,
  knockback: 0,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 1 }],
  visual: { color: 0xc8955a, trailEffect: "projectile", screenShake: 0.2 },
};

const MUD_SLINGER_SCATTER: AttackAbility = {
  id: "mud-slinger-scatter",
  name: "Scatter Shot",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 50, range: 160 },
  damage: 8,
  knockback: 0,
  visual: { color: 0xc8955a, trailEffect: "explosion", screenShake: 0.2 },
};

const PACK_BRUTE_CLUB_SLAM: AttackAbility = {
  id: "pack-brute-club-slam",
  name: "Club Slam",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 3 },
  damage: 25,
  knockback: 20,
  visual: { color: 0x7a5c3a, trailEffect: "slash", screenShake: 0.4 },
};

const PACK_BRUTE_SHOVE: AttackAbility = {
  id: "pack-brute-shove",
  name: "Shove",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 2 },
  damage: 10,
  knockback: 45,
  visual: { color: 0x7a5c3a, trailEffect: "slash", screenShake: 0.3 },
};

const SNAPPER_RIDER_POLE_JAB: AttackAbility = {
  id: "snapper-rider-pole-jab",
  name: "Pole Jab",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 110, width: 14 },
  damage: 16,
  knockback: 0,
  visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.25 },
};

const SNAPPER_RIDER_MOUNT_SNAP: AttackAbility = {
  id: "snapper-rider-mount-snap",
  name: "Mount Snap",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
  damage: 14,
  knockback: 0,
  onHit: [{ type: "applyStatus", status: "rooted", duration: 1, value: 1 }],
  visual: { color: 0x7a5c3a, trailEffect: "slash", screenShake: 0.2 },
};

// --- Elites ---

const CLAY_GOLEM_SLAM: AttackAbility = {
  id: "clay-golem-slam",
  name: "Clay Slam",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 70, range: 0 },
  damage: 30,
  knockback: 0,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 1 }],
  visual: { color: 0xc8955a, trailEffect: "explosion", screenShake: 0.6 },
};

const CLAY_GOLEM_FIST: AttackAbility = {
  id: "clay-golem-fist",
  name: "Clay Fist",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
  damage: 22,
  knockback: 25,
  visual: { color: 0xc8955a, trailEffect: "slash", screenShake: 0.4 },
};

const GULLY_WITCH_MUD_CURSE: AttackAbility = {
  id: "gully-witch-mud-curse",
  name: "Mud Curse",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 220 },
  damage: 14,
  knockback: 0,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 3, value: 1 }],
  visual: { color: 0x5b4030, trailEffect: "projectile", screenShake: 0.2 },
};

const GULLY_WITCH_ROT_BLAST: AttackAbility = {
  id: "gully-witch-rot-blast",
  name: "Rot Blast",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 55, range: 180 },
  damage: 18,
  knockback: 0,
  visual: { color: 0x5b4030, trailEffect: "splash", screenShake: 0.3 },
};

const MULE_KICKER_KICK: AttackAbility = {
  id: "mule-kicker-kick",
  name: "Iron Kick",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 4 },
  damage: 35,
  knockback: 50,
  visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.5 },
};

const MULE_KICKER_HAYMAKER: AttackAbility = {
  id: "mule-kicker-haymaker",
  name: "Haymaker",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 3 },
  damage: 40,
  knockback: 30,
  visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.6 },
};

const DUST_HUSK_CLAW: AttackAbility = {
  id: "dust-husk-claw",
  name: "Dry Claw",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 3 },
  damage: 28,
  knockback: 0,
  visual: { color: 0xc8955a, trailEffect: "slash", screenShake: 0.3 },
};

const DUST_HUSK_LUNGE: AttackAbility = {
  id: "dust-husk-lunge",
  name: "Husk Lunge",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 90, width: 16 },
  damage: 22,
  knockback: 0,
  visual: { color: 0xc8955a, trailEffect: "thrust", screenShake: 0.35 },
};

// --- Bosses ---

const RIVER_BOSS_SURGE: AttackAbility = {
  id: "river-boss-surge",
  name: "Crushing Surge",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 120, width: 35 },
  damage: 45,
  knockback: 0,
  visual: { color: 0x7a5c3a, trailEffect: "thrust", screenShake: 0.7 },
};

const RIVER_BOSS_TAIL_SWEEP: AttackAbility = {
  id: "river-boss-tail-sweep",
  name: "Tail Sweep",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 85, halfAngle: Math.PI / 2 },
  damage: 25,
  knockback: 40,
  visual: { color: 0x7a5c3a, trailEffect: "slash", screenShake: 0.5 },
};

const CARAVAN_CAPTAIN_ORDER: AttackAbility = {
  id: "caravan-captain-order",
  name: "Rally Order",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 80, range: 0 },
  damage: 10,
  knockback: 0,
  visual: { color: 0xc8955a, trailEffect: "explosion", screenShake: 0.3 },
};

const CARAVAN_CAPTAIN_WHIP: AttackAbility = {
  id: "caravan-captain-whip",
  name: "Drover Whip",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 100, width: 14 },
  damage: 20,
  knockback: 0,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 1 }],
  visual: { color: 0x7a5c3a, trailEffect: "thrust", screenShake: 0.25 },
};

const BIG_CLAY_GOLEM_GROUND_POUND: AttackAbility = {
  id: "big-clay-golem-ground-pound",
  name: "Ground Pound",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 90, range: 0 },
  damage: 40,
  knockback: 0,
  onHit: [{ type: "applyStatus", status: "rooted", duration: 2, value: 1 }],
  visual: { color: 0xc8955a, trailEffect: "explosion", screenShake: 0.8 },
};

const BIG_CLAY_GOLEM_ARM_SWEEP: AttackAbility = {
  id: "big-clay-golem-arm-sweep",
  name: "Arm Sweep",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: (2 * Math.PI) / 3 },
  damage: 30,
  knockback: 35,
  visual: { color: 0xc8955a, trailEffect: "slash", screenShake: 0.6 },
};

const BONE_MULE_CHARGE: AttackAbility = {
  id: "bone-mule-charge",
  name: "Dead Charge",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 140, width: 28 },
  damage: 50,
  knockback: 60,
  visual: { color: 0xd0c8b0, trailEffect: "thrust", screenShake: 0.8 },
};

const BONE_MULE_CHAIN_LASH: AttackAbility = {
  id: "bone-mule-chain-lash",
  name: "Chain Lash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 2 },
  damage: 22,
  knockback: 30,
  visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.4 },
};

// =============================================================================
// ENEMY TEMPLATES
// =============================================================================

const ENEMY_TEMPLATES: Record<string, UnitTemplate> = {
  // --- Fodder ---
  "dust-rat": {
    abilities: [makeMove(160), DUST_RAT_BITE],
    hp: 30,
    energy: { red: 1, blue: 1 },
    collisionRadius: 11,
    className: "Dust Rat",
    sprites: enemySprites("dust-rat"),
    heightMeters: 0.8,
    strategy: "rush",
    cost: 1,
    tags: ["melee", "swarm"],
  },
  "river-snapper": {
    abilities: [makeMove(100), RIVER_SNAPPER_SNAP],
    hp: 40,
    energy: { red: 1, blue: 1 },
    collisionRadius: 13,
    className: "River Snapper",
    sprites: enemySprites("river-snapper"),
    heightMeters: 1.0,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "clay-crawler": {
    abilities: [makeMove(80), CLAY_CRAWLER_GRAB],
    hp: 35,
    energy: { red: 1, blue: 1 },
    collisionRadius: 14,
    className: "Clay Crawler",
    sprites: enemySprites("clay-crawler"),
    heightMeters: 0.8,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "scrub-hound": {
    abilities: [makeMove(180), SCRUB_HOUND_SNAP],
    hp: 30,
    energy: { red: 1, blue: 2 },
    collisionRadius: 12,
    className: "Scrub Hound",
    sprites: enemySprites("scrub-hound"),
    heightMeters: 1.2,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },

  // --- Standard ---
  "gully-raider": {
    abilities: [makeMove(120), GULLY_RAIDER_SLASH, GULLY_RAIDER_SHIELD_BASH],
    hp: 85,
    energy: { red: 1, blue: 1 },
    collisionRadius: 14,
    className: "Gully Raider",
    sprites: enemySprites("gully-raider"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 4,
    tags: ["melee"],
  },
  "mud-slinger": {
    abilities: [makeMove(130), MUD_SLINGER_LOB, MUD_SLINGER_SCATTER],
    hp: 60,
    energy: { red: 1, blue: 2 },
    collisionRadius: 13,
    className: "Mud Slinger",
    sprites: enemySprites("mud-slinger"),
    heightMeters: 1.8,
    strategy: "kite",
    cost: 4,
    tags: ["ranged"],
  },
  "pack-brute": {
    abilities: [makeMove(80), PACK_BRUTE_CLUB_SLAM, PACK_BRUTE_SHOVE],
    hp: 110,
    energy: { red: 1, blue: 1 },
    collisionRadius: 18,
    className: "Pack Brute",
    sprites: enemySprites("pack-brute"),
    heightMeters: 2.5,
    strategy: "rush",
    cost: 5,
    tags: ["melee", "tank"],
  },
  "snapper-rider": {
    abilities: [makeMove(110), SNAPPER_RIDER_POLE_JAB, SNAPPER_RIDER_MOUNT_SNAP],
    hp: 75,
    energy: { red: 1, blue: 2 },
    collisionRadius: 18,
    className: "Snapper Rider",
    sprites: enemySprites("snapper-rider"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 5,
    tags: ["melee"],
  },

  // --- Elites ---
  "clay-golem": {
    abilities: [makeMove(60), CLAY_GOLEM_SLAM, CLAY_GOLEM_FIST],
    hp: 200,
    energy: { red: 1, blue: 1 },
    collisionRadius: 22,
    className: "Clay Golem",
    sprites: enemySprites("clay-golem"),
    heightMeters: 3.0,
    strategy: "threat",
    cost: 8,
    tags: ["melee", "tank", "elite"],
  },
  "gully-witch": {
    abilities: [makeMove(110), GULLY_WITCH_MUD_CURSE, GULLY_WITCH_ROT_BLAST],
    hp: 80,
    energy: { red: 1, blue: 2 },
    collisionRadius: 13,
    className: "Gully Witch",
    sprites: enemySprites("gully-witch"),
    heightMeters: 1.8,
    strategy: "kite",
    cost: 7,
    tags: ["ranged", "elite"],
  },
  "mule-kicker": {
    abilities: [makeMove(130), MULE_KICKER_KICK, MULE_KICKER_HAYMAKER],
    hp: 120,
    energy: { red: 2, blue: 1 },
    collisionRadius: 16,
    className: "Mule Kicker",
    sprites: enemySprites("mule-kicker"),
    heightMeters: 2.2,
    strategy: "rush",
    cost: 7,
    tags: ["melee", "elite"],
  },
  "dust-husk": {
    abilities: [makeMove(170), DUST_HUSK_CLAW, DUST_HUSK_LUNGE],
    hp: 70,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Dust Husk",
    sprites: enemySprites("dust-husk"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 6,
    tags: ["melee", "elite"],
  },

  // --- Bosses ---
  "river-boss": {
    abilities: [makeMove(70), RIVER_BOSS_SURGE, RIVER_BOSS_TAIL_SWEEP],
    hp: 350,
    energy: { red: 2, blue: 1 },
    collisionRadius: 30,
    className: "River Boss",
    sprites: enemySprites("river-boss"),
    heightMeters: 4.0,
    strategy: "threat",
    cost: 12,
    tags: ["melee", "boss"],
  },
  "caravan-captain": {
    abilities: [makeMove(90), CARAVAN_CAPTAIN_ORDER, CARAVAN_CAPTAIN_WHIP],
    hp: 250,
    energy: { red: 2, blue: 1 },
    collisionRadius: 20,
    className: "Caravan Captain",
    sprites: enemySprites("caravan-captain"),
    heightMeters: 2.5,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "gully-raider", count: 2 } }],
    cost: 11,
    tags: ["melee", "boss"],
  },
  "big-clay-golem": {
    abilities: [makeMove(50), BIG_CLAY_GOLEM_GROUND_POUND, BIG_CLAY_GOLEM_ARM_SWEEP],
    hp: 400,
    energy: { red: 2, blue: 1 },
    collisionRadius: 28,
    className: "Big Clay Golem",
    sprites: enemySprites("big-clay-golem"),
    heightMeters: 5.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "clay-crawler", count: 3 } }],
    cost: 14,
    tags: ["melee", "tank", "boss"],
  },
  "bone-mule": {
    abilities: [makeMove(140), BONE_MULE_CHARGE, BONE_MULE_CHAIN_LASH],
    hp: 280,
    energy: { red: 2, blue: 2 },
    collisionRadius: 22,
    className: "Bone Mule",
    sprites: enemySprites("bone-mule"),
    heightMeters: 3.5,
    strategy: "rush",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "dust-rat", count: 3 } }],
    cost: 12,
    tags: ["melee", "boss"],
  },
};

// =============================================================================
// STRUCTURES — Clay Flats
// =============================================================================

const STRUCTURE_COUNT = 45;

function buildDim501Structures(): StructureEntry[] {
  const entries: StructureEntry[] = [];
  for (let i = 0; i < STRUCTURE_COUNT; i++) {
    const id = String(i).padStart(2, "0");
    const t = STRUCTURE_COUNT > 1 ? i / (STRUCTURE_COUNT - 1) : 0;
    entries.push({
      name: `structure-${id}`,
      index: i,
      cost: t < 0.33 ? 1 : t < 0.66 ? 2 : 3,
      scale: 0.25 + t * 0.15,
      spritePath: `sprites/map-objects/dimension-501/sprite-${id}.png`,
    });
  }
  return entries;
}

const DIMENSION_501_STRUCTURES = buildDim501Structures();

// =============================================================================
// ITEMS — Clay Flats (weapons only)
// =============================================================================

const DIMENSION_501_ITEMS: Record<string, ItemDefinition> = {
  "d501-short-sword": {
    type: "weapon",
    id: "d501-short-sword",
    name: "Short Sword",
    description: "A plain iron blade, short enough to draw fast in a gully.",
    rarity: "common",
    sprite: "short-sword",
    dimensionId: 501,
    slotCost: { hand: 1 },
    abilities: [{
      id: "d501-short-sword-slash",
      name: "Slash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
      damage: 20,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.25 },
    } satisfies AttackAbility, {
      id: "d501-short-sword-stab",
      name: "Stab",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 60, width: 12 },
      damage: 12,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.15 },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "d501-long-knife": {
    type: "weapon",
    id: "d501-long-knife",
    name: "Long Knife",
    description: "A heavy belt knife that doubles as a short slashing blade.",
    rarity: "common",
    sprite: "long-knife",
    dimensionId: 501,
    slotCost: { hand: 1 },
    abilities: [{
      id: "d501-long-knife-cut",
      name: "Cut",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 4 },
      damage: 14,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility, {
      id: "d501-long-knife-gut",
      name: "Gut",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 50, width: 10 },
      damage: 22,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.3 },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "d501-spear": {
    type: "weapon",
    id: "d501-spear",
    name: "Spear",
    description: "A fire-hardened shaft tipped with a flat iron head.",
    rarity: "common",
    sprite: "spear",
    dimensionId: 501,
    slotCost: { hand: 1 },
    abilities: [{
      id: "d501-spear-thrust",
      name: "Thrust",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 120, width: 14 },
      damage: 20,
      knockback: 0,
      visual: { color: 0x7a5c3a, trailEffect: "thrust", screenShake: 0.25 },
    } satisfies AttackAbility, {
      id: "d501-spear-sweep",
      name: "Shaft Sweep",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
      damage: 10,
      knockback: 0,
      visual: { color: 0x7a5c3a, trailEffect: "slash", screenShake: 0.15 },
    } satisfies AttackAbility],
    animSet: "spear",
  },

  "d501-sling": {
    type: "weapon",
    id: "d501-sling",
    name: "Sling",
    description: "A braided leather strap; hurls clay shot at range.",
    rarity: "common",
    sprite: "sling",
    dimensionId: 501,
    slotCost: { hand: 1 },
    abilities: [{
      id: "d501-sling-shot",
      name: "Clay Shot",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Point, range: 260 },
      damage: 18,
      knockback: 0,
      visual: { color: 0xc8955a, trailEffect: "projectile", screenShake: 0.2 },
    } satisfies AttackAbility, {
      id: "d501-sling-snap",
      name: "Snap Shot",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Point, range: 220 },
      damage: 10,
      knockback: 0,
      visual: { color: 0xc8955a, trailEffect: "projectile" },
    } satisfies AttackAbility],
    animSet: "bow",
  },

  "d501-drover-staff": {
    type: "weapon",
    id: "d501-drover-staff",
    name: "Drover Staff",
    description: "A thick walking staff used to push pack animals and crack skulls.",
    rarity: "common",
    sprite: "drover-staff",
    dimensionId: 501,
    slotCost: { hand: 2 },
    abilities: [{
      id: "d501-drover-staff-crack",
      name: "Skull Crack",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 3 },
      damage: 22,
      knockback: 30,
      visual: { color: 0x7a5c3a, trailEffect: "slash", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "d501-drover-staff-prod",
      name: "Prod",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 90, width: 14 },
      damage: 10,
      knockback: 25,
      visual: { color: 0x7a5c3a, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "staff",
  },

  "d501-mattock": {
    type: "weapon",
    id: "d501-mattock",
    name: "Mattock",
    description: "A heavy pick-hoe that hits hard and breaks clay armor.",
    rarity: "common",
    sprite: "mattock",
    dimensionId: 501,
    slotCost: { hand: 2 },
    abilities: [{
      id: "d501-mattock-overhead",
      name: "Overhead Smash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 4 },
      damage: 30,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.5 },
    } satisfies AttackAbility, {
      id: "d501-mattock-hook",
      name: "Hook Pull",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 70, width: 14 },
      damage: 12,
      knockback: 0,
      onHit: [{ type: "pull", distance: 30 }],
      visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.25 },
    } satisfies AttackAbility],
    animSet: "two-handed",
  },

  "d501-broad-axe": {
    type: "weapon",
    id: "d501-broad-axe",
    name: "Broad Axe",
    description: "A wide-bladed chopping axe balanced for big overhead swings.",
    rarity: "uncommon",
    sprite: "broad-axe",
    dimensionId: 501,
    slotCost: { hand: 2 },
    abilities: [{
      id: "d501-broad-axe-cleave",
      name: "Cleave",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 2 },
      damage: 32,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.5 },
    } satisfies AttackAbility, {
      id: "d501-broad-axe-chop",
      name: "Chop",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 65, width: 18 },
      damage: 18,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "d501-broad-axe-backswing",
      name: "Backswing",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
      damage: 14,
      knockback: 20,
      visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "two-handed",
  },

  "d501-prod-lance": {
    type: "weapon",
    id: "d501-prod-lance",
    name: "Prod Lance",
    description: "A long iron-tipped pole; extra reach, good against mounted enemies.",
    rarity: "uncommon",
    sprite: "prod-lance",
    dimensionId: 501,
    slotCost: { hand: 1 },
    abilities: [{
      id: "d501-prod-lance-thrust",
      name: "Long Thrust",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 140, width: 14 },
      damage: 24,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "d501-prod-lance-sweep",
      name: "Pole Sweep",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
      damage: 12,
      knockback: 25,
      visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility, {
      id: "d501-prod-lance-brace",
      name: "Brace",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 110, width: 12 },
      damage: 18,
      knockback: 0,
      visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.15 },
    } satisfies AttackAbility],
    animSet: "spear",
  },
};

// --- Seed ---

export function seedDimension501(): void {
  saveDimension(501, "Clay Flats", DIMENSION_501_STRUCTURES, "sprites/map-objects/dimension-501/background.png", "sprites/map-decorations/dimension-501");
  saveEnemyTemplates(501, ENEMY_TEMPLATES);
  saveItems(501, DIMENSION_501_ITEMS);
}
