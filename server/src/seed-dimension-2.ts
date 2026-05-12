import { ShapeKind } from "shared";
import type { AttackAbility, MoveAbility, SpriteSet, UnitTemplate, ItemDefinition } from "shared";
import type { StructureEntry } from "shared";
import { saveDimension, saveEnemyTemplates, saveItems, withStructureIndices } from "./db.js";

function enemySprites(name: string): SpriteSet {
  const base = `/api/sprites/enemies/dimension-2/${name}/${name}`;
  return {
    idle: `${base}-idle.webp`,
    attack: `${base}-attack.webp`,
    hit: `${base}-hit.webp`,
    move: `${base}-move.webp`,
  };
}

function makeMove(distance: number): MoveAbility {
  return { id: "move", name: "Move", kind: "move", cost: { blue: 1 }, distance };
}

// =============================================================================
// ENEMIES — The Gloom Hollows
// Mechanical identity: vulnerable, knockback from crystal bursts.
// =============================================================================

// --- Fodder ---

const CAVE_MITE_CRYSTAL_BITE: AttackAbility = {
  id: "cave-mite-crystal-bite",
  name: "Crystal Bite",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 45, halfAngle: Math.PI / 4 },
  damage: 7,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
  visual: { color: 0xc060b0, trailEffect: "slash", screenShake: 0.15 },
};

const SPORE_PUFFER_SPORE_BURST: AttackAbility = {
  id: "spore-puffer-spore-burst",
  name: "Spore Burst",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 200 },
  damage: 6,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
  visual: { color: 0x9b5de5, trailEffect: "projectile" },
};

const GRUB_CRAWLER_ACID_BITE: AttackAbility = {
  id: "grub-crawler-acid-bite",
  name: "Acid Bite",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 3 },
  damage: 9,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
  visual: { color: 0x6edeb8, trailEffect: "slash", screenShake: 0.15 },
};

const CRYSTAL_SCARAB_SHARD_SLAM: AttackAbility = {
  id: "crystal-scarab-shard-slam",
  name: "Shard Slam",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 3 },
  damage: 16,
  visual: { color: 0xe760c9, trailEffect: "slash", screenShake: 0.25 },
};

const CRYSTAL_SCARAB_SHELL_CRACK: AttackAbility = {
  id: "crystal-scarab-shell-crack",
  name: "Shell Crack",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 55, range: 0 },
  damage: 10,
  onHit: [{ type: "knockback", distance: 35 }],
  visual: { color: 0xe760c9, trailEffect: "explosion", screenShake: 0.3 },
};

// --- Standard ---

const GROTTO_SALAMANDER_VENOM_SNAP: AttackAbility = {
  id: "grotto-salamander-venom-snap",
  name: "Venom Snap",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 95, width: 20 },
  damage: 16,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.35 }],
  visual: { color: 0xc060b0, trailEffect: "thrust", screenShake: 0.25 },
};

const GROTTO_SALAMANDER_DISORIENTING_LICK: AttackAbility = {
  id: "grotto-salamander-disorienting-lick",
  name: "Disorienting Lick",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
  damage: 10,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
  visual: { color: 0x9b5de5, trailEffect: "splash", screenShake: 0.2 },
};

const PRISM_MOTH_PRISMATIC_DUST: AttackAbility = {
  id: "prism-moth-prismatic-dust",
  name: "Prismatic Dust",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 60, range: 170 },
  damage: 12,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 3, value: 0.4 }],
  visual: { color: 0xe760c9, trailEffect: "splash", screenShake: 0.2 },
};

const PRISM_MOTH_WING_SLASH: AttackAbility = {
  id: "prism-moth-wing-slash",
  name: "Wing Slash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 2 },
  damage: 8,
  visual: { color: 0x6edeb8, trailEffect: "slash", screenShake: 0.15 },
};

const FUNGAL_SHAMBLER_SPORE_SLAM: AttackAbility = {
  id: "fungal-shambler-spore-slam",
  name: "Spore Slam",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2 },
  damage: 16,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
  visual: { color: 0x6edeb8, trailEffect: "slash", screenShake: 0.35 },
};

const FUNGAL_SHAMBLER_CAP_BURST: AttackAbility = {
  id: "fungal-shambler-cap-burst",
  name: "Cap Burst",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 65, range: 0 },
  damage: 12,
  onHit: [{ type: "knockback", distance: 40 }],
  visual: { color: 0x9b5de5, trailEffect: "explosion", screenShake: 0.4 },
};

const GEODE_CRAB_CRYSTAL_CRUSH: AttackAbility = {
  id: "geode-crab-crystal-crush",
  name: "Crystal Crush",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
  damage: 40,
  visual: { color: 0xe760c9, trailEffect: "explosion", screenShake: 0.6 },
};

const GEODE_CRAB_SHARD_SPRAY: AttackAbility = {
  id: "geode-crab-shard-spray",
  name: "Shard Spray",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 2 },
  damage: 18,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
  visual: { color: 0xc060b0, trailEffect: "slash", screenShake: 0.3 },
};

// --- Elites ---

const HOLLOW_HIPPO_CRYSTAL_CHARGE: AttackAbility = {
  id: "hollow-hippo-crystal-charge",
  name: "Crystal Charge",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 120, width: 35 },
  damage: 35,
  onHit: [{ type: "knockback", distance: 60 }],
  visual: { color: 0xc060b0, trailEffect: "thrust", screenShake: 0.7 },
};

const HOLLOW_HIPPO_PRISM_STOMP: AttackAbility = {
  id: "hollow-hippo-prism-stomp",
  name: "Prism Stomp",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 75, range: 0 },
  damage: 20,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
  visual: { color: 0xe760c9, trailEffect: "explosion", screenShake: 0.5 },
};

const CRYSTAL_WEAVER_RESONANCE_FIELD: AttackAbility = {
  id: "crystal-weaver-resonance-field",
  name: "Resonance Field",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 70, range: 170 },
  damage: 15,
  onHit: [
    { type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 },
  ],
  visual: { color: 0x9b5de5, trailEffect: "splash", screenShake: 0.4 },
};

const CRYSTAL_WEAVER_FANG_STRIKE: AttackAbility = {
  id: "crystal-weaver-fang-strike",
  name: "Fang Strike",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 80, width: 16 },
  damage: 18,
  visual: { color: 0x9b5de5, trailEffect: "thrust", screenShake: 0.2 },
};

const MYCELIUM_HORROR_TENDRIL_LASH: AttackAbility = {
  id: "mycelium-horror-tendril-lash",
  name: "Tendril Lash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 110, width: 25 },
  damage: 22,
  onHit: [{ type: "knockback", distance: 45 }],
  visual: { color: 0x6edeb8, trailEffect: "thrust", screenShake: 0.35 },
};

const MYCELIUM_HORROR_MIND_SPORE: AttackAbility = {
  id: "mycelium-horror-mind-spore",
  name: "Mind Spore",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 80, range: 160 },
  damage: 10,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 3, value: 0.4 }],
  visual: { color: 0x9b5de5, trailEffect: "splash", screenShake: 0.3 },
};

const SHARD_SERPENT_CRYSTAL_FANG: AttackAbility = {
  id: "shard-serpent-crystal-fang",
  name: "Crystal Fang",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 90, width: 18 },
  damage: 22,
  onHit: [
    { type: "applyStatus", status: "bleeding", duration: 3, value: 4 },
    { type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 },
  ],
  visual: { color: 0x6edeb8, trailEffect: "thrust", screenShake: 0.3 },
};

const SHARD_SERPENT_TAIL_SWEEP: AttackAbility = {
  id: "shard-serpent-tail-sweep",
  name: "Tail Sweep",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 3 },
  damage: 14,
  visual: { color: 0x6edeb8, trailEffect: "slash", screenShake: 0.2 },
};

// --- Bosses ---

const GEMWARDEN_PRISM_STORM: AttackAbility = {
  id: "gemwarden-prism-storm",
  name: "Prism Storm",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 85, range: 180 },
  damage: 30,
  onHit: [
    { type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 },
  ],
  visual: { color: 0xe760c9, trailEffect: "splash", screenShake: 0.7 },
};

const GEMWARDEN_CRYSTAL_BOLT: AttackAbility = {
  id: "gemwarden-crystal-bolt",
  name: "Crystal Bolt",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 250 },
  damage: 22,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
  visual: { color: 0x9b5de5, trailEffect: "projectile", screenShake: 0.25 },
};

const GROTTO_TITAN_GEODE_SLAM: AttackAbility = {
  id: "grotto-titan-geode-slam",
  name: "Geode Slam",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 },
  damage: 60,
  onHit: [{ type: "knockback", distance: 55 }],
  visual: { color: 0x9b5de5, trailEffect: "explosion", screenShake: 0.9 },
};

const GROTTO_TITAN_CRYSTAL_BURST: AttackAbility = {
  id: "grotto-titan-crystal-burst",
  name: "Crystal Burst",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 85, range: 0 },
  damage: 18,
  onHit: [{ type: "knockback", distance: 50 }],
  visual: { color: 0xe760c9, trailEffect: "explosion", screenShake: 0.6 },
};

const GROTTO_TITAN_PRISM_HORN: AttackAbility = {
  id: "grotto-titan-prism-horn",
  name: "Prism Horn",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 110, width: 30 },
  damage: 25,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
  visual: { color: 0xc060b0, trailEffect: "thrust", screenShake: 0.5 },
};

const THE_MYCELIUM_SPORE_NOVA: AttackAbility = {
  id: "the-mycelium-spore-nova",
  name: "Spore Nova",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 90, range: 170 },
  damage: 12,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 3, value: 0.4 }],
  visual: { color: 0x9b5de5, trailEffect: "splash", screenShake: 0.4 },
};

const THE_MYCELIUM_TENDRIL_WHIP: AttackAbility = {
  id: "the-mycelium-tendril-whip",
  name: "Tendril Whip",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 80, range: 0 },
  damage: 15,
  onHit: [{ type: "knockback", distance: 55 }],
  visual: { color: 0x6edeb8, trailEffect: "explosion", screenShake: 0.5 },
};

const THE_MYCELIUM_CONSUME: AttackAbility = {
  id: "the-mycelium-consume",
  name: "Consume",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Point, range: 240 },
  damage: 28,
  onHit: [{ type: "pull", distance: 90 }],
  visual: { color: 0xe760c9, trailEffect: "projectile", screenShake: 0.45 },
};

const CRYSTALBACK_REX_CRYSTAL_CHARGE: AttackAbility = {
  id: "crystalback-rex-crystal-charge",
  name: "Crystal Charge",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 120, width: 30 },
  damage: 65,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 4, value: 5 }],
  visual: { color: 0xc060b0, trailEffect: "thrust", screenShake: 0.9 },
};

const CRYSTALBACK_REX_SHARD_ROAR: AttackAbility = {
  id: "crystalback-rex-shard-roar",
  name: "Shard Roar",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 85, halfAngle: Math.PI / 2 },
  damage: 28,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
  visual: { color: 0xe760c9, trailEffect: "slash", screenShake: 0.5 },
};

// =============================================================================
// ENEMY TEMPLATES
// =============================================================================

const ENEMY_TEMPLATES: Record<string, UnitTemplate> = {
  "cave-mite": {
    abilities: [makeMove(150), CAVE_MITE_CRYSTAL_BITE],
    hp: 30,
    energy: { red: 1, blue: 1 },
    collisionRadius: 12,
    className: "Cave Mite",
    sprites: enemySprites("cave-mite"),
    heightMeters: 1.0,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "spore-puffer": {
    abilities: [makeMove(120), SPORE_PUFFER_SPORE_BURST],
    hp: 25,
    energy: { red: 1, blue: 2 },
    collisionRadius: 10,
    className: "Spore Puffer",
    sprites: enemySprites("spore-puffer"),
    heightMeters: 1.5,
    strategy: "kite",
    cost: 2,
    tags: ["ranged", "swarm"],
  },
  "grub-crawler": {
    abilities: [makeMove(130), GRUB_CRAWLER_ACID_BITE],
    hp: 40,
    energy: { red: 1, blue: 1 },
    collisionRadius: 14,
    className: "Grub Crawler",
    sprites: enemySprites("grub-crawler"),
    heightMeters: 1.5,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "crystal-scarab": {
    abilities: [makeMove(100), CRYSTAL_SCARAB_SHARD_SLAM, CRYSTAL_SCARAB_SHELL_CRACK],
    hp: 85,
    energy: { red: 1, blue: 1 },
    collisionRadius: 16,
    className: "Crystal Scarab",
    sprites: enemySprites("crystal-scarab"),
    heightMeters: 1.5,
    strategy: "rush",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "cave-mite", count: 2 } }],
    cost: 4,
    tags: ["melee"],
  },
  "grotto-salamander": {
    abilities: [makeMove(120), GROTTO_SALAMANDER_VENOM_SNAP, GROTTO_SALAMANDER_DISORIENTING_LICK],
    hp: 85,
    energy: { red: 1, blue: 1 },
    collisionRadius: 16,
    className: "Grotto Salamander",
    sprites: enemySprites("grotto-salamander"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 4,
    tags: ["melee"],
  },
  "prism-moth": {
    abilities: [makeMove(140), PRISM_MOTH_PRISMATIC_DUST, PRISM_MOTH_WING_SLASH],
    hp: 55,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Prism Moth",
    sprites: enemySprites("prism-moth"),
    heightMeters: 1.75,
    strategy: "kite",
    cost: 4,
    tags: ["ranged"],
  },
  "fungal-shambler": {
    abilities: [makeMove(80), FUNGAL_SHAMBLER_SPORE_SLAM, FUNGAL_SHAMBLER_CAP_BURST],
    hp: 110,
    energy: { red: 1, blue: 1 },
    collisionRadius: 18,
    className: "Fungal Shambler",
    sprites: enemySprites("fungal-shambler"),
    heightMeters: 2.5,
    strategy: "rush",
    cost: 5,
    tags: ["melee", "tank"],
  },
  "geode-crab": {
    abilities: [makeMove(130), GEODE_CRAB_CRYSTAL_CRUSH, GEODE_CRAB_SHARD_SPRAY],
    hp: 100,
    energy: { red: 2, blue: 1 },
    collisionRadius: 16,
    className: "Geode Crab",
    sprites: enemySprites("geode-crab"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 6,
    tags: ["melee", "elite"],
  },
  "hollow-hippo": {
    abilities: [makeMove(70), HOLLOW_HIPPO_CRYSTAL_CHARGE, HOLLOW_HIPPO_PRISM_STOMP],
    hp: 200,
    energy: { red: 2, blue: 1 },
    collisionRadius: 24,
    className: "Hollow Hippo",
    sprites: enemySprites("hollow-hippo"),
    heightMeters: 3.0,
    strategy: "threat",
    cost: 9,
    tags: ["melee", "tank", "elite"],
  },
  "crystal-weaver": {
    abilities: [makeMove(110), CRYSTAL_WEAVER_RESONANCE_FIELD, CRYSTAL_WEAVER_FANG_STRIKE],
    hp: 95,
    energy: { red: 2, blue: 2 },
    collisionRadius: 18,
    className: "Crystal Weaver",
    sprites: enemySprites("crystal-weaver"),
    heightMeters: 2.5,
    strategy: "kite",
    cost: 7,
    tags: ["ranged", "elite"],
  },
  "mycelium-horror": {
    abilities: [makeMove(60), MYCELIUM_HORROR_TENDRIL_LASH, MYCELIUM_HORROR_MIND_SPORE],
    hp: 140,
    energy: { red: 1, blue: 1 },
    collisionRadius: 20,
    className: "Mycelium Horror",
    sprites: enemySprites("mycelium-horror"),
    heightMeters: 3.0,
    strategy: "threat",
    cost: 8,
    tags: ["melee", "elite"],
  },
  "shard-serpent": {
    abilities: [makeMove(170), SHARD_SERPENT_CRYSTAL_FANG, SHARD_SERPENT_TAIL_SWEEP],
    hp: 85,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Shard Serpent",
    sprites: enemySprites("shard-serpent"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 6,
    tags: ["melee", "elite"],
  },
  "the-gemwarden": {
    abilities: [makeMove(80), GEMWARDEN_PRISM_STORM, GEMWARDEN_CRYSTAL_BOLT],
    hp: 240,
    energy: { red: 2, blue: 2 },
    collisionRadius: 18,
    className: "The Gemwarden",
    sprites: enemySprites("the-gemwarden"),
    heightMeters: 2.5,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "grotto-salamander", count: 2 } }],
    cost: 11,
    tags: ["ranged", "boss"],
  },
  "grotto-titan": {
    abilities: [makeMove(50), GROTTO_TITAN_GEODE_SLAM, GROTTO_TITAN_CRYSTAL_BURST, GROTTO_TITAN_PRISM_HORN],
    hp: 420,
    energy: { red: 2, blue: 1 },
    collisionRadius: 28,
    className: "Grotto Titan",
    sprites: enemySprites("grotto-titan"),
    heightMeters: 5.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "crystal-scarab", count: 2 } }],
    cost: 14,
    tags: ["melee", "tank", "boss"],
  },
  "the-mycelium": {
    abilities: [makeMove(30), THE_MYCELIUM_SPORE_NOVA, THE_MYCELIUM_TENDRIL_WHIP, THE_MYCELIUM_CONSUME],
    hp: 300,
    energy: { red: 2, blue: 1 },
    collisionRadius: 30,
    className: "The Mycelium",
    sprites: enemySprites("the-mycelium"),
    heightMeters: 4.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "fungal-shambler", count: 2 } }],
    cost: 12,
    tags: ["ranged", "tank", "boss"],
  },
  "crystalback-rex": {
    abilities: [makeMove(120), CRYSTALBACK_REX_CRYSTAL_CHARGE, CRYSTALBACK_REX_SHARD_ROAR],
    hp: 370,
    energy: { red: 2, blue: 1 },
    collisionRadius: 24,
    className: "Crystalback Rex",
    sprites: enemySprites("crystalback-rex"),
    heightMeters: 3.5,
    strategy: "rush",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "shard-serpent", count: 1 } }],
    cost: 13,
    tags: ["melee", "boss"],
  },
};

// =============================================================================
// STRUCTURES — The Gloom Hollows
// =============================================================================

function dim2Sprite(folder: string, name: string): string {
  return `sprites/map-objects/dimension-2/${folder}/${name}.webp`;
}

const DIMENSION_2_STRUCTURES: StructureEntry[] = withStructureIndices([
  // Decorations (plants)
  { name: "mushroom-cluster-pink", cost: 2, scale: 0.4, spritePath: dim2Sprite("plants", "mushroom-cluster-pink") },
  { name: "mushroom-cluster-teal", cost: 2, scale: 0.4, spritePath: dim2Sprite("plants", "mushroom-cluster-teal") },
  { name: "shelf-fungi", cost: 2, scale: 0.4, spritePath: dim2Sprite("plants", "shelf-fungi") },
  { name: "crystal-cluster-small", cost: 2, scale: 0.35, spritePath: dim2Sprite("plants", "crystal-cluster-small") },
  { name: "crystal-cluster-medium", cost: 2, scale: 0.35, spritePath: dim2Sprite("plants", "crystal-cluster-medium") },
  { name: "crystal-cluster-large", cost: 3, scale: 0.4, spritePath: dim2Sprite("plants", "crystal-cluster-large") },
  { name: "glowing-puddle", cost: 1, scale: 0.3, spritePath: dim2Sprite("plants", "glowing-puddle") },
  // Decorations (rocks)
  { name: "stalagmite-cluster", cost: 3, scale: 0.4, spritePath: dim2Sprite("rocks", "stalagmite-cluster") },
  { name: "stalagmite-small", cost: 1, scale: 0.25, spritePath: dim2Sprite("rocks", "stalagmite-small") },
  { name: "stalagmite-tall", cost: 2, scale: 0.35, spritePath: dim2Sprite("rocks", "stalagmite-tall") },
  { name: "geode-boulder", cost: 3, scale: 0.4, spritePath: dim2Sprite("rocks", "geode-boulder") },
  { name: "cracked-boulder", cost: 2, scale: 0.35, spritePath: dim2Sprite("rocks", "cracked-boulder") },
  { name: "crystal-rubble", cost: 2, scale: 0.35, spritePath: dim2Sprite("rocks", "crystal-rubble") },
  // Walls
  { name: "stone-block-small", cost: 2, scale: 0.25, spritePath: dim2Sprite("walls", "stone-block-small") },
  { name: "stone-block-medium", cost: 2, scale: 0.25, spritePath: dim2Sprite("walls", "stone-block-medium") },
  { name: "cave-wall-long", cost: 3, scale: 0.3, spritePath: dim2Sprite("walls", "cave-wall-long") },
  { name: "stone-brick-small", cost: 2, scale: 0.25, spritePath: dim2Sprite("walls", "stone-brick-small") },
  { name: "stone-brick-medium", cost: 2, scale: 0.25, spritePath: dim2Sprite("walls", "stone-brick-medium") },
  { name: "crystal-pillar", cost: 3, scale: 0.3, spritePath: dim2Sprite("walls", "crystal-pillar") },
  { name: "wall-l-shape", cost: 3, scale: 0.3, spritePath: dim2Sprite("walls", "wall-l-shape") },
  { name: "wall-t-junction", cost: 3, scale: 0.3, spritePath: dim2Sprite("walls", "wall-t-junction") },
  { name: "wall-u-shape", cost: 3, scale: 0.3, spritePath: dim2Sprite("walls", "wall-u-shape") },
  { name: "wall-enclosure", cost: 4, scale: 0.35, spritePath: dim2Sprite("walls", "wall-enclosure") },
  { name: "wall-enclosure-large", cost: 4, scale: 0.35, spritePath: dim2Sprite("walls", "wall-enclosure-large") },
  { name: "ruins-rubble", cost: 2, scale: 0.35, spritePath: dim2Sprite("walls", "ruins-rubble") },
  { name: "crystal-gate", cost: 4, scale: 0.35, spritePath: dim2Sprite("walls", "crystal-gate") },
  { name: "crystal-obelisk", cost: 3, scale: 0.3, spritePath: dim2Sprite("walls", "crystal-obelisk") },
]);

// =============================================================================
// ITEMS — The Gloom Hollows
// =============================================================================

const DIMENSION_2_ITEMS: Record<string, ItemDefinition> = {
  "crystal-shard-blade": {
    type: "weapon",
    id: "crystal-shard-blade",
    name: "Crystal Shard Blade",
    description: "A long shard of magenta crystal. The edge hums with resonance that scrambles your senses on contact.",
    rarity: "common",
    sprite: "crystal-shard-blade",
    dimensionId: 2,
    slotCost: { hand: 1 },
    abilities: [{
      id: "crystal-slash",
      name: "Crystal Slash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 3 },
      damage: 20,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
      visual: { color: 0xe760c9, trailEffect: "slash", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "crystal-jab",
      name: "Crystal Jab",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 75, width: 12 },
      damage: 12,
      visual: { color: 0xe760c9, trailEffect: "thrust" },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "stalactite-spear": {
    type: "weapon",
    id: "stalactite-spear",
    name: "Stalactite Spear",
    description: "A broken stalactite sharpened to a point. The phosphorescent slime it drips weakens whatever it pierces.",
    rarity: "common",
    sprite: "stalactite-spear",
    dimensionId: 2,
    slotCost: { hand: 1 },
    abilities: [{
      id: "stalactite-thrust",
      name: "Stalactite Thrust",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 125, width: 18 },
      damage: 24,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
      visual: { color: 0x6edeb8, trailEffect: "thrust", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "stalactite-sweep",
      name: "Shaft Sweep",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
      damage: 10,
      visual: { color: 0x6edeb8, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "spear",
  },

  "fungal-mace": {
    type: "weapon",
    id: "fungal-mace",
    name: "Fungal Mace",
    description: "A dense petrified mushroom cap on a stout handle. Each impact releases a cloud of disorienting spores.",
    rarity: "uncommon",
    sprite: "fungal-mace",
    dimensionId: 2,
    slotCost: { hand: 1 },
    abilities: [{
      id: "fungal-smash",
      name: "Fungal Smash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2 },
      damage: 24,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 3, value: 0.4 }],
      visual: { color: 0x9b5de5, trailEffect: "slash", screenShake: 0.4 },
    } satisfies AttackAbility, {
      id: "spore-cloud-swing",
      name: "Spore Cloud",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Circle, radius: 55, range: 0 },
      damage: 14,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
      visual: { color: 0x9b5de5, trailEffect: "explosion", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "fungal-bash",
      name: "Fungal Bash",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 60, width: 14 },
      damage: 12,
      visual: { color: 0x9b5de5, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "geode-knuckles": {
    type: "weapon",
    id: "geode-knuckles",
    name: "Geode Knuckles",
    description: "Cracked geode halves strapped over the fists. The crystalline edges expose weaknesses in anything they hit.",
    rarity: "uncommon",
    sprite: "geode-knuckles",
    dimensionId: 2,
    slotCost: { hand: 1 },
    abilities: [{
      id: "geode-uppercut",
      name: "Geode Uppercut",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
      damage: 28,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
      visual: { color: 0x9b5de5, trailEffect: "slash", screenShake: 0.4 },
    } satisfies AttackAbility, {
      id: "geode-flurry",
      name: "Geode Flurry",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 3 },
      damage: 14,
      onHit: [{ type: "knockback", distance: 25 }],
      visual: { color: 0xe760c9, trailEffect: "slash", screenShake: 0.25 },
    } satisfies AttackAbility, {
      id: "geode-cross",
      name: "Crystal Cross",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 55, width: 14 },
      damage: 12,
      visual: { color: 0x9b5de5, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "sword",
  },
};

// --- Seed ---

export function seedDimension2(): void {
  saveDimension(2, "The Gloom Hollows", DIMENSION_2_STRUCTURES, "sprites/map-objects/dimension-2/backgrounds/background-gloom-hollows.png", "sprites/map-decorations/dimension-2");
  saveEnemyTemplates(2, ENEMY_TEMPLATES);
  saveItems(2, DIMENSION_2_ITEMS);
}
