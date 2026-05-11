import { ShapeKind } from "shared";
import type { AttackAbility, MoveAbility, SpriteSet, UnitTemplate, ItemDefinition } from "shared";
import type { StructureEntry } from "shared";
import { saveDimension, saveEnemyTemplates, saveItems } from "./db.js";

function enemySprites(name: string): SpriteSet {
  const base = `/api/sprites/enemies/dimension-1/${name}/${name}`;
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
// ENEMIES — The Shallows
// Mechanical identity: pulls, poison, slow, bleed. Less knockback than dim 0.
// =============================================================================

// --- Fodder & Standard ---

const MUD_CRAB_SNIP: AttackAbility = {
  id: "mud-crab-snip",
  name: "Snip",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 40, halfAngle: Math.PI / 4 },
  damage: 8,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xa07050, trailEffect: "slash", screenShake: 0.15 },
};

const DART_FISH_VENOM_DART: AttackAbility = {
  id: "dart-fish-venom-dart",
  name: "Venom Dart",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 220 },
  damage: 8,
  onHit: [{ type: "applyStatus", status: "poisoned", duration: 3, value: 3 }],
  visual: { color: 0x6ee5b0, trailEffect: "projectile" },
};

const TIDE_SKIMMER_DRIFT: AttackAbility = {
  id: "tide-skimmer-drift",
  name: "Wake Drift",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 2 },
  damage: 6,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.4 }],
  visual: { color: 0x88c4d8, trailEffect: "splash", screenShake: 0.15 },
};

const SNAPPING_CRAB_GRIP: AttackAbility = {
  id: "snapping-crab-grip",
  name: "Crusher Grip",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 110, width: 22 },
  damage: 22,
  onHit: [{ type: "pull", distance: 50 }],
  visual: { color: 0xb87333, trailEffect: "thrust", screenShake: 0.3 },
};

const SNAPPING_CRAB_SNAP: AttackAbility = {
  id: "snapping-crab-snap",
  name: "Claw Snap",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 3 },
  damage: 14,
  visual: { color: 0xb87333, trailEffect: "slash", screenShake: 0.2 },
};

// --- Standard Tier (continued) + Elites ---

const SPITTING_URCHIN_SPINE_SHOT: AttackAbility = {
  id: "spitting-urchin-spine-shot",
  name: "Spine Shot",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 240 },
  damage: 14,
  onHit: [{ type: "applyStatus", status: "poisoned", duration: 3, value: 5 }],
  visual: { color: 0x6ee5b0, trailEffect: "projectile", screenShake: 0.15 },
};

const SPITTING_URCHIN_SPINE_BURST: AttackAbility = {
  id: "spitting-urchin-spine-burst",
  name: "Spine Burst",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 70, range: 0 },
  damage: 28,
  visual: { color: 0x6ee5b0, trailEffect: "explosion", screenShake: 0.4 },
};

const TIDAL_LURKER_CORAL_THRUST: AttackAbility = {
  id: "tidal-lurker-coral-thrust",
  name: "Coral Thrust",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 105, width: 18 },
  damage: 18,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
  visual: { color: 0xc06848, trailEffect: "thrust", screenShake: 0.25 },
};

const TIDAL_LURKER_TAIL_WHIP: AttackAbility = {
  id: "tidal-lurker-tail-whip",
  name: "Tail Whip",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
  damage: 10,
  onHit: [{ type: "knockback", distance: 45 }],
  visual: { color: 0x809060, trailEffect: "slash", screenShake: 0.2 },
};

const JELLYBELL_VENOM_BOLT: AttackAbility = {
  id: "jellybell-venom-bolt",
  name: "Venom Bolt",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 230 },
  damage: 15,
  onHit: [{ type: "applyStatus", status: "poisoned", duration: 3, value: 4 }],
  visual: { color: 0x35e3a9, trailEffect: "projectile", screenShake: 0.15 },
};

const JELLYBELL_TENTACLE_LASH: AttackAbility = {
  id: "jellybell-tentacle-lash",
  name: "Tentacle Lash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 90, width: 25 },
  damage: 12,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.4 }],
  visual: { color: 0x35e3a9, trailEffect: "splash", screenShake: 0.2 },
};

const MANTIS_SHRIMP_SMASH: AttackAbility = {
  id: "mantis-shrimp-smash",
  name: "Smash",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 80, width: 18 },
  damage: 55,
  onHit: [{ type: "knockback", distance: 30 }],
  visual: { color: 0xd45c2e, trailEffect: "explosion", screenShake: 0.7 },
};

const MANTIS_SHRIMP_FLURRY: AttackAbility = {
  id: "mantis-shrimp-flurry",
  name: "Flurry",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 3 },
  damage: 22,
  visual: { color: 0xd45c2e, trailEffect: "slash", screenShake: 0.3 },
};

const ABYSSAL_ANGLER_LURE_DRAG: AttackAbility = {
  id: "abyssal-angler-lure-drag",
  name: "Lure Drag",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 280 },
  damage: 4,
  onHit: [{ type: "pull", distance: 90 }],
  visual: { color: 0x6ee5b0, trailEffect: "projectile", screenShake: 0.2 },
};

const ABYSSAL_ANGLER_BITE: AttackAbility = {
  id: "abyssal-angler-bite",
  name: "Abyssal Bite",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 4 },
  damage: 45,
  visual: { color: 0x404040, trailEffect: "slash", screenShake: 0.6 },
};

const REEF_GUARDIAN_TURRET_SLAM: AttackAbility = {
  id: "reef-guardian-turret-slam",
  name: "Turret Slam",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 2 },
  damage: 30,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.4 }],
  visual: { color: 0x8b7355, trailEffect: "slash", screenShake: 0.5 },
};

const REEF_GUARDIAN_SHELL_SURGE: AttackAbility = {
  id: "reef-guardian-shell-surge",
  name: "Shell Surge",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 80, range: 0 },
  damage: 15,
  onHit: [{ type: "knockback", distance: 50 }],
  visual: { color: 0x8b7355, trailEffect: "explosion", screenShake: 0.6 },
};

const REEF_GUARDIAN_CLAW_SWEEP: AttackAbility = {
  id: "reef-guardian-claw-sweep",
  name: "Claw Sweep",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: (2 * Math.PI) / 3 },
  damage: 18,
  onHit: [{ type: "knockback", distance: 35 }],
  visual: { color: 0x8b7355, trailEffect: "slash", screenShake: 0.4 },
};

const SIREN_DRIFTER_TENTACLE_RAIN: AttackAbility = {
  id: "siren-drifter-tentacle-rain",
  name: "Tentacle Rain",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 70, range: 180 },
  damage: 18,
  onHit: [
    { type: "applyStatus", status: "poisoned", duration: 3, value: 4 },
    { type: "applyStatus", status: "slowed", duration: 2, value: 0.3 },
  ],
  visual: { color: 0xb088e0, trailEffect: "splash", screenShake: 0.45 },
};

const SIREN_DRIFTER_DRAG_TENDRIL: AttackAbility = {
  id: "siren-drifter-drag-tendril",
  name: "Drag Tendril",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 220 },
  damage: 2,
  onHit: [{ type: "pull", distance: 75 }],
  visual: { color: 0xb088e0, trailEffect: "projectile", screenShake: 0.15 },
};

const BRACKISH_STALKER_CONSTRICT: AttackAbility = {
  id: "brackish-stalker-constrict",
  name: "Constrict",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 100, width: 22 },
  damage: 25,
  onHit: [
    { type: "applyStatus", status: "bleeding", duration: 3, value: 4 },
    { type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 },
  ],
  visual: { color: 0x4488cc, trailEffect: "thrust", screenShake: 0.35 },
};

const BRACKISH_STALKER_STRIKE: AttackAbility = {
  id: "brackish-stalker-strike",
  name: "Slither Strike",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 3 },
  damage: 12,
  visual: { color: 0x4488cc, trailEffect: "slash", screenShake: 0.2 },
};

// --- Bosses ---

const TIDECALLER_TIDAL_WAVE: AttackAbility = {
  id: "tidecaller-tidal-wave",
  name: "Tidal Wave",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 90, range: 180 },
  damage: 35,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.4 }],
  visual: { color: 0x35e3a9, trailEffect: "splash", screenShake: 0.7 },
};

const TIDECALLER_CORAL_BOLT: AttackAbility = {
  id: "tidecaller-coral-bolt",
  name: "Coral Bolt",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 250 },
  damage: 20,
  onHit: [{ type: "applyStatus", status: "poisoned", duration: 3, value: 4 }],
  visual: { color: 0xc06848, trailEffect: "projectile", screenShake: 0.25 },
};

const IRON_CLAW_CRUSH: AttackAbility = {
  id: "iron-claw-crush",
  name: "Iron Crush",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 85, halfAngle: Math.PI / 3 },
  damage: 65,
  onHit: [{ type: "knockback", distance: 50 }],
  visual: { color: 0x7a6040, trailEffect: "explosion", screenShake: 0.9 },
};

const IRON_CLAW_CAGE_DRAG: AttackAbility = {
  id: "iron-claw-cage-drag",
  name: "Cage Drag",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 130, width: 30 },
  damage: 12,
  onHit: [{ type: "pull", distance: 80 }],
  visual: { color: 0x8b7355, trailEffect: "thrust", screenShake: 0.4 },
};

const IRON_CLAW_FORTRESS_SURGE: AttackAbility = {
  id: "iron-claw-fortress-surge",
  name: "Fortress Surge",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 90, range: 0 },
  damage: 15,
  onHit: [{ type: "knockback", distance: 60 }],
  visual: { color: 0x8b7355, trailEffect: "explosion", screenShake: 0.6 },
};

const BLOOM_SPORE_CLOUD: AttackAbility = {
  id: "the-bloom-spore-cloud",
  name: "Spore Cloud",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 85, range: 180 },
  damage: 10,
  onHit: [{ type: "applyStatus", status: "poisoned", duration: 3, value: 5 }],
  visual: { color: 0xb088e0, trailEffect: "splash", screenShake: 0.35 },
};

const BLOOM_TENDRIL_FIELD: AttackAbility = {
  id: "the-bloom-tendril-field",
  name: "Tendril Field",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 85, range: 150 },
  damage: 8,
  onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.5 }],
  visual: { color: 0x35e3a9, trailEffect: "splash", screenShake: 0.3 },
};

const BLOOM_CONSUME: AttackAbility = {
  id: "the-bloom-consume",
  name: "Consume",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Point, range: 250 },
  damage: 25,
  onHit: [{ type: "pull", distance: 100 }],
  visual: { color: 0xb088e0, trailEffect: "projectile", screenShake: 0.45 },
};

const RIVERJAW_DEATH_ROLL: AttackAbility = {
  id: "riverjaw-death-roll",
  name: "Death Roll",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 110, width: 28 },
  damage: 70,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 4, value: 5 }],
  visual: { color: 0x556844, trailEffect: "slash", screenShake: 0.9 },
};

const RIVERJAW_TAIL_SWEEP: AttackAbility = {
  id: "riverjaw-tail-sweep",
  name: "Tail Sweep",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 2 },
  damage: 30,
  onHit: [{ type: "knockback", distance: 50 }],
  visual: { color: 0x556844, trailEffect: "slash", screenShake: 0.5 },
};

const ENEMY_TEMPLATES: Record<string, UnitTemplate> = {
  "mud-crab": {
    abilities: [makeMove(150), MUD_CRAB_SNIP],
    hp: 35,
    energy: { red: 1, blue: 1 },
    collisionRadius: 12,
    className: "Mud Crab",
    sprites: enemySprites("mud-crab"),
    heightMeters: 1.5,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "dart-fish": {
    abilities: [makeMove(140), DART_FISH_VENOM_DART],
    hp: 30,
    energy: { red: 1, blue: 2 },
    collisionRadius: 10,
    className: "Dart Fish",
    sprites: enemySprites("dart-fish"),
    heightMeters: 1.0,
    strategy: "kite",
    cost: 2,
    tags: ["ranged", "swarm"],
  },
  "tide-skimmer": {
    abilities: [makeMove(160), TIDE_SKIMMER_DRIFT],
    hp: 40,
    energy: { red: 1, blue: 1 },
    collisionRadius: 14,
    className: "Tide Skimmer",
    sprites: enemySprites("tide-skimmer"),
    heightMeters: 1.5,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "snapping-crab": {
    abilities: [makeMove(110), SNAPPING_CRAB_GRIP, SNAPPING_CRAB_SNAP],
    hp: 90,
    energy: { red: 1, blue: 1 },
    collisionRadius: 16,
    className: "Snapping Crab",
    sprites: enemySprites("snapping-crab"),
    heightMeters: 1.75,
    strategy: "rush",
    cost: 4,
    tags: ["melee"],
  },
  "spitting-urchin": {
    abilities: [makeMove(70), SPITTING_URCHIN_SPINE_SHOT, SPITTING_URCHIN_SPINE_BURST],
    hp: 80,
    energy: { red: 1, blue: 1 },
    collisionRadius: 16,
    className: "Spitting Urchin",
    sprites: enemySprites("spitting-urchin"),
    heightMeters: 1.75,
    strategy: "kite",
    cost: 4,
    tags: ["ranged"],
  },
  "tidal-lurker": {
    abilities: [makeMove(120), TIDAL_LURKER_CORAL_THRUST, TIDAL_LURKER_TAIL_WHIP],
    hp: 80,
    energy: { red: 1, blue: 1 },
    collisionRadius: 14,
    className: "Tidal Lurker",
    sprites: enemySprites("tidal-lurker"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 4,
    tags: ["melee"],
  },
  "jellybell": {
    abilities: [makeMove(130), JELLYBELL_VENOM_BOLT, JELLYBELL_TENTACLE_LASH],
    hp: 50,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Jellybell",
    sprites: enemySprites("jellybell"),
    heightMeters: 1.75,
    strategy: "kite",
    cost: 4,
    tags: ["ranged"],
  },
  "mantis-shrimp": {
    abilities: [makeMove(140), MANTIS_SHRIMP_SMASH, MANTIS_SHRIMP_FLURRY],
    hp: 120,
    energy: { red: 2, blue: 1 },
    collisionRadius: 16,
    className: "Mantis Shrimp",
    sprites: enemySprites("mantis-shrimp"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 7,
    tags: ["melee", "elite"],
  },
  "abyssal-angler": {
    abilities: [makeMove(80), ABYSSAL_ANGLER_LURE_DRAG, ABYSSAL_ANGLER_BITE],
    hp: 130,
    energy: { red: 2, blue: 1 },
    collisionRadius: 20,
    className: "Abyssal Angler",
    sprites: enemySprites("abyssal-angler"),
    heightMeters: 2.5,
    strategy: "threat",
    cost: 7,
    tags: ["melee", "elite"],
  },
  "reef-guardian": {
    abilities: [makeMove(60), REEF_GUARDIAN_TURRET_SLAM, REEF_GUARDIAN_SHELL_SURGE, REEF_GUARDIAN_CLAW_SWEEP],
    hp: 200,
    energy: { red: 1, blue: 1 },
    collisionRadius: 22,
    className: "Reef Guardian",
    sprites: enemySprites("reef-guardian"),
    heightMeters: 3.0,
    strategy: "threat",
    cost: 9,
    tags: ["melee", "tank", "elite"],
  },
  "siren-drifter": {
    abilities: [makeMove(110), SIREN_DRIFTER_TENTACLE_RAIN, SIREN_DRIFTER_DRAG_TENDRIL],
    hp: 90,
    energy: { red: 2, blue: 2 },
    collisionRadius: 18,
    className: "Siren Drifter",
    sprites: enemySprites("siren-drifter"),
    heightMeters: 2.5,
    strategy: "kite",
    cost: 7,
    tags: ["ranged", "elite"],
  },
  "brackish-stalker": {
    abilities: [makeMove(160), BRACKISH_STALKER_CONSTRICT, BRACKISH_STALKER_STRIKE],
    hp: 90,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Brackish Stalker",
    sprites: enemySprites("brackish-stalker"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 6,
    tags: ["melee", "elite"],
  },
  "tidecaller": {
    abilities: [makeMove(80), TIDECALLER_TIDAL_WAVE, TIDECALLER_CORAL_BOLT],
    hp: 220,
    energy: { red: 2, blue: 2 },
    collisionRadius: 18,
    className: "Tidecaller",
    sprites: enemySprites("tidecaller"),
    heightMeters: 2.5,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "tidal-lurker", count: 2 } }],
    cost: 11,
    tags: ["ranged", "boss"],
  },
  "iron-claw": {
    abilities: [makeMove(50), IRON_CLAW_CRUSH, IRON_CLAW_CAGE_DRAG, IRON_CLAW_FORTRESS_SURGE],
    hp: 400,
    energy: { red: 2, blue: 1 },
    collisionRadius: 28,
    className: "The Iron Claw",
    sprites: enemySprites("iron-claw"),
    heightMeters: 5.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "snapping-crab", count: 2 } }],
    cost: 14,
    tags: ["melee", "tank", "boss"],
  },
  "the-bloom": {
    abilities: [makeMove(30), BLOOM_SPORE_CLOUD, BLOOM_TENDRIL_FIELD, BLOOM_CONSUME],
    hp: 280,
    energy: { red: 2, blue: 1 },
    collisionRadius: 30,
    className: "The Bloom",
    sprites: enemySprites("the-bloom"),
    heightMeters: 4.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "jellybell", count: 2 } }],
    cost: 12,
    tags: ["ranged", "tank", "boss"],
  },
  "riverjaw": {
    abilities: [makeMove(120), RIVERJAW_DEATH_ROLL, RIVERJAW_TAIL_SWEEP],
    hp: 350,
    energy: { red: 2, blue: 1 },
    collisionRadius: 24,
    className: "Riverjaw",
    sprites: enemySprites("riverjaw"),
    heightMeters: 3.0,
    strategy: "rush",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "brackish-stalker", count: 1 } }],
    cost: 13,
    tags: ["melee", "boss"],
  },
};

// --- Dimension 1 Structures ---

function dim1Sprite(folder: string, name: string): string {
  return `sprites/map-objects/dimension-1/${folder}/${name}.webp`;
}

const DIMENSION_1_STRUCTURES: StructureEntry[] = [
  // Decorations
  { name: "coral-small", category: "decoration", cost: 1, scale: 0.35, spritePath: dim1Sprite("plants", "coral-small") },
  { name: "coral-medium", category: "decoration", cost: 2, scale: 0.4, spritePath: dim1Sprite("plants", "coral-medium") },
  { name: "coral-tube", category: "decoration", cost: 3, scale: 0.45, spritePath: dim1Sprite("plants", "coral-tube") },
  { name: "coral-brain", category: "decoration", cost: 2, scale: 0.4, spritePath: dim1Sprite("plants", "coral-brain") },
  { name: "coral-fan", category: "decoration", cost: 2, scale: 0.4, spritePath: dim1Sprite("plants", "coral-fan") },
  { name: "kelp-tall", category: "decoration", cost: 2, scale: 0.4, spritePath: dim1Sprite("plants", "kelp-tall") },
  { name: "reed-cluster", category: "decoration", cost: 2, scale: 0.4, spritePath: dim1Sprite("plants", "reed-cluster") },
  { name: "algae-glow", category: "decoration", cost: 1, scale: 0.3, spritePath: dim1Sprite("plants", "algae-glow") },
  { name: "tidepool-small", category: "decoration", cost: 1, scale: 0.35, spritePath: dim1Sprite("plants", "tidepool-small") },
  { name: "tidepool-large", category: "decoration", cost: 3, scale: 0.45, spritePath: dim1Sprite("plants", "tidepool-large") },
  { name: "shell-pile", category: "decoration", cost: 1, scale: 0.3, spritePath: dim1Sprite("plants", "shell-pile") },
  { name: "driftwood", category: "decoration", cost: 2, scale: 0.35, spritePath: dim1Sprite("plants", "driftwood") },
  { name: "barnacle-rock", category: "decoration", cost: 2, scale: 0.35, spritePath: dim1Sprite("plants", "barnacle-rock") },
  { name: "tidal-crystal", category: "decoration", cost: 2, scale: 0.3, spritePath: dim1Sprite("rocks", "tidal-crystal") },
  // Walls
  { name: "sandstone-block", category: "wall", cost: 2, scale: 0.25, spritePath: dim1Sprite("walls", "sandstone-block") },
  { name: "sandstone-brick", category: "wall", cost: 2, scale: 0.25, spritePath: dim1Sprite("walls", "sandstone-brick") },
  { name: "sandstone-pillar", category: "wall", cost: 3, scale: 0.3, spritePath: dim1Sprite("walls", "sandstone-pillar") },
  { name: "coral-wall-corner", category: "wall", cost: 3, scale: 0.3, spritePath: dim1Sprite("walls", "coral-wall-corner") },
  { name: "coral-wall-medium", category: "wall", cost: 2, scale: 0.3, spritePath: dim1Sprite("walls", "coral-wall-medium") },
  { name: "coral-wall-long", category: "wall", cost: 3, scale: 0.3, spritePath: dim1Sprite("walls", "coral-wall-long") },
  { name: "wall-l-shape", category: "wall", cost: 3, scale: 0.3, spritePath: dim1Sprite("walls", "wall-l-shape") },
  { name: "wall-corner", category: "wall", cost: 3, scale: 0.3, spritePath: dim1Sprite("walls", "wall-corner") },
  { name: "wall-t-junction", category: "wall", cost: 3, scale: 0.3, spritePath: dim1Sprite("walls", "wall-t-junction") },
  { name: "wall-u-shape", category: "wall", cost: 3, scale: 0.3, spritePath: dim1Sprite("walls", "wall-u-shape") },
  { name: "wall-enclosure", category: "wall", cost: 4, scale: 0.35, spritePath: dim1Sprite("walls", "wall-enclosure") },
  { name: "ruins-rubble", category: "decoration", cost: 2, scale: 0.35, spritePath: dim1Sprite("walls", "ruins-rubble") },
  { name: "turret-ruin", category: "wall", cost: 4, scale: 0.35, spritePath: dim1Sprite("walls", "turret-ruin") },
  { name: "wooden-gate", category: "wall", cost: 2, scale: 0.3, spritePath: dim1Sprite("walls", "wooden-gate") },
];

// =============================================================================
// ITEMS — The Shallows
// =============================================================================

const DIMENSION_1_ITEMS: Record<string, ItemDefinition> = {
  // --- Melee Weapons ---

  "coral-blade": {
    type: "weapon",
    id: "coral-blade",
    name: "Coral Blade",
    description: "A jagged shard of pink coral lashed to a driftwood grip. The edge cuts and the cuts won't close.",
    rarity: "common",
    sprite: "coral-blade",
    dimensionId: 1,
    slotCost: { hand: 1 },
    abilities: [{
      id: "coral-slash",
      name: "Coral Slash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 3 },
      damage: 22,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 3 }],
      visual: { color: 0xe0a090, trailEffect: "slash", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "coral-jab",
      name: "Coral Jab",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 75, width: 12 },
      damage: 10,
      visual: { color: 0xe0a090, trailEffect: "thrust" },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "barbed-harpoon": {
    type: "weapon",
    id: "barbed-harpoon",
    name: "Barbed Harpoon",
    description: "A long fishing harpoon with hooked barbs. They go in easy and bring whatever they catch back with them.",
    rarity: "common",
    sprite: "barbed-harpoon",
    dimensionId: 1,
    slotCost: { hand: 1 },
    abilities: [{
      id: "harpoon-thrust",
      name: "Harpoon Thrust",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 130, width: 18 },
      damage: 25,
      onHit: [{ type: "pull", distance: 50 }],
      visual: { color: 0xa89070, trailEffect: "thrust", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "harpoon-shaft-strike",
      name: "Shaft Strike",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
      damage: 12,
      visual: { color: 0xa89070, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "spear",
  },

  "urchin-flail": {
    type: "weapon",
    id: "urchin-flail",
    name: "Urchin Flail",
    description: "A spiked urchin shell on a chain. Every swing seeds the wound with venom.",
    rarity: "uncommon",
    sprite: "urchin-flail",
    dimensionId: 1,
    slotCost: { hand: 1 },
    abilities: [{
      id: "urchin-venomous-swing",
      name: "Venomous Swing",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 2 },
      damage: 22,
      onHit: [{ type: "applyStatus", status: "poisoned", duration: 3, value: 4 }],
      visual: { color: 0x6ee5b0, trailEffect: "slash", screenShake: 0.4 },
    } satisfies AttackAbility, {
      id: "urchin-spine-slam",
      name: "Spine Slam",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Circle, radius: 45, range: 0 },
      damage: 28,
      visual: { color: 0x6ee5b0, trailEffect: "explosion", screenShake: 0.45 },
    } satisfies AttackAbility, {
      id: "urchin-chain-whip",
      name: "Chain Whip",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 90, width: 10 },
      damage: 10,
      onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.3 }],
      visual: { color: 0x808080, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "crab-claw-gauntlet": {
    type: "weapon",
    id: "crab-claw-gauntlet",
    name: "Crab Claw Gauntlet",
    description: "A crustacean's severed claw fitted over the wearer's fist. It still wants to grab.",
    rarity: "uncommon",
    sprite: "crab-claw-gauntlets",
    dimensionId: 1,
    slotCost: { hand: 1 },
    abilities: [{
      id: "gauntlet-crusher-grip",
      name: "Crusher Grip",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 4 },
      damage: 22,
      onHit: [{ type: "pull", distance: 50 }],
      visual: { color: 0xb87333, trailEffect: "slash", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "gauntlet-pincer-hold",
      name: "Pincer Hold",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 4 },
      damage: 8,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
      visual: { color: 0xb87333, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility, {
      id: "gauntlet-snap-snap",
      name: "Snap Snap",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 60, width: 14 },
      damage: 14,
      visual: { color: 0xb87333, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "sword",
  },
};

// --- Seed ---

export function seedDimension1(): void {
  saveDimension(1, "The Shallows", DIMENSION_1_STRUCTURES, "sprites/map-objects/dimension-1/backgrounds/background-shallows.png", "sprites/map-decorations/dimension-1");
  saveEnemyTemplates(1, ENEMY_TEMPLATES);
  saveItems(1, DIMENSION_1_ITEMS);
}
