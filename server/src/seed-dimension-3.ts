import { ShapeKind } from "shared";
import type { AttackAbility, MoveAbility, SpriteSet, UnitTemplate, ItemDefinition } from "shared";
import type { StructureEntry } from "shared";
import { saveDimension, saveEnemyTemplates, saveItems } from "./db.js";

function enemySprites(name: string): SpriteSet {
  const base = `/api/sprites/enemies/dimension-3/${name}/${name}`;
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
// ENEMIES — The Gilt Barrens
// Mechanical identity: bleeding. Ambush predators, mirages, desert heat.
// =============================================================================

// --- Fodder ---

const SAND_SKITTER_PINCH: AttackAbility = {
  id: "sand-skitter-pinch",
  name: "Pinch",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 40, halfAngle: Math.PI / 4 },
  damage: 9,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 3 }],
  visual: { color: 0xc4a030, trailEffect: "slash", screenShake: 0.15 },
};

const MIRAGE_WISP_SHIMMER_BOLT: AttackAbility = {
  id: "mirage-wisp-shimmer-bolt",
  name: "Shimmer Bolt",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 200 },
  damage: 7,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 2, value: 3 }],
  visual: { color: 0xf0d060, trailEffect: "projectile" },
};

const DUNE_JACKAL_RAKE: AttackAbility = {
  id: "dune-jackal-rake",
  name: "Rake",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 3 },
  damage: 10,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 3 }],
  visual: { color: 0xb89050, trailEffect: "slash", screenShake: 0.15 },
};

const DUST_DEVIL_GUST: AttackAbility = {
  id: "dust-devil-gust",
  name: "Sand Gust",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 180 },
  damage: 6,
  onHit: [
    { type: "applyStatus", status: "bleeding", duration: 2, value: 3 },
    { type: "knockback", distance: 25 },
  ],
  visual: { color: 0xd4a533, trailEffect: "projectile", screenShake: 0.15 },
};

// --- Standard ---

const GILT_VIPER_LUNGE: AttackAbility = {
  id: "gilt-viper-lunge",
  name: "Fang Lunge",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 100, width: 18 },
  damage: 20,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xd4a040, trailEffect: "thrust", screenShake: 0.3 },
};

const GILT_VIPER_COIL_STRIKE: AttackAbility = {
  id: "gilt-viper-coil-strike",
  name: "Coil Strike",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
  damage: 14,
  visual: { color: 0xd4a040, trailEffect: "slash", screenShake: 0.2 },
};

const CARRION_VULTURE_DIVE: AttackAbility = {
  id: "carrion-vulture-dive",
  name: "Swooping Dive",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 200 },
  damage: 18,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
  visual: { color: 0x8b4020, trailEffect: "projectile", screenShake: 0.25 },
};

const CARRION_VULTURE_TALON_RAKE: AttackAbility = {
  id: "carrion-vulture-talon-rake",
  name: "Talon Rake",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 3 },
  damage: 12,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 2, value: 3 }],
  visual: { color: 0x8b4020, trailEffect: "slash", screenShake: 0.2 },
};

const SANDSWORN_RAIDER_DUAL_SLASH: AttackAbility = {
  id: "sandsworn-raider-dual-slash",
  name: "Dual Slash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 2 },
  damage: 22,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xa09060, trailEffect: "slash", screenShake: 0.3 },
};

const SANDSWORN_RAIDER_RIPOSTE: AttackAbility = {
  id: "sandsworn-raider-riposte",
  name: "Riposte",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 70, width: 14 },
  damage: 15,
  visual: { color: 0xa09060, trailEffect: "thrust", screenShake: 0.2 },
};

const SHIMMER_STALKER_MIRAGE_FLASH: AttackAbility = {
  id: "shimmer-stalker-mirage-flash",
  name: "Mirage Flash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 220 },
  damage: 12,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xe0c870, trailEffect: "projectile", screenShake: 0.2 },
};

const SHIMMER_STALKER_PHANTOM_BITE: AttackAbility = {
  id: "shimmer-stalker-phantom-bite",
  name: "Phantom Bite",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 4 },
  damage: 16,
  visual: { color: 0xe0c870, trailEffect: "slash", screenShake: 0.25 },
};

// --- Elites ---

const DUNE_REAVER_AMBUSH: AttackAbility = {
  id: "dune-reaver-ambush",
  name: "Ambush Surge",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 110, width: 25 },
  damage: 40,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 4, value: 5 }],
  visual: { color: 0xc4a030, trailEffect: "thrust", screenShake: 0.6 },
};

const DUNE_REAVER_HOOK_LEGS: AttackAbility = {
  id: "dune-reaver-hook-legs",
  name: "Hook Legs",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 3 },
  damage: 18,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 3 }],
  visual: { color: 0xc4a030, trailEffect: "slash", screenShake: 0.3 },
};

const OASIS_GUARDIAN_MIRAGE_PULSE: AttackAbility = {
  id: "oasis-guardian-mirage-pulse",
  name: "Mirage Pulse",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 80, range: 0 },
  damage: 12,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xf0d060, trailEffect: "explosion", screenShake: 0.4 },
};

const OASIS_GUARDIAN_CRYSTAL_SLAM: AttackAbility = {
  id: "oasis-guardian-crystal-slam",
  name: "Crystal Slam",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 2 },
  damage: 30,
  onHit: [{ type: "knockback", distance: 50 }],
  visual: { color: 0xd4a533, trailEffect: "slash", screenShake: 0.6 },
};

const GAZELLE_MATRIARCH_STAMPEDE: AttackAbility = {
  id: "gazelle-matriarch-stampede",
  name: "Stampede Charge",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 120, width: 30 },
  damage: 35,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0x8b6830, trailEffect: "thrust", screenShake: 0.5 },
};

const GAZELLE_MATRIARCH_HORN_GORE: AttackAbility = {
  id: "gazelle-matriarch-horn-gore",
  name: "Horn Gore",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 60, halfAngle: Math.PI / 4 },
  damage: 20,
  onHit: [{ type: "knockback", distance: 35 }],
  visual: { color: 0x8b6830, trailEffect: "slash", screenShake: 0.35 },
};

const SANDWRAITH_PHASE_SLASH: AttackAbility = {
  id: "sandwraith-phase-slash",
  name: "Phase Slash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 90, width: 18 },
  damage: 28,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xd4a533, trailEffect: "thrust", screenShake: 0.35 },
};

const SANDWRAITH_MIRAGE_STEP: AttackAbility = {
  id: "sandwraith-mirage-step",
  name: "Mirage Step",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 55, range: 0 },
  damage: 15,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 2, value: 3 }],
  visual: { color: 0xd4a533, trailEffect: "explosion", screenShake: 0.3 },
};

// --- Bosses ---

const CARAVAN_KING_COIN_SHRAPNEL: AttackAbility = {
  id: "caravan-king-coin-shrapnel",
  name: "Coin Shrapnel",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 85, range: 160 },
  damage: 30,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 5 }],
  visual: { color: 0xd4a533, trailEffect: "explosion", screenShake: 0.6 },
};

const CARAVAN_KING_FLAIL_SMASH: AttackAbility = {
  id: "caravan-king-flail-smash",
  name: "War-Flail Smash",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
  damage: 40,
  onHit: [{ type: "knockback", distance: 40 }],
  visual: { color: 0x8b6830, trailEffect: "slash", screenShake: 0.7 },
};

const SUNSCORCH_WYRM_SANDSTORM_BREATH: AttackAbility = {
  id: "sunscorch-wyrm-sandstorm-breath",
  name: "Sandstorm Breath",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 100, halfAngle: Math.PI / 3 },
  damage: 35,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xd4a533, trailEffect: "splash", screenShake: 0.7 },
};

const SUNSCORCH_WYRM_TAIL_SWIPE: AttackAbility = {
  id: "sunscorch-wyrm-tail-swipe",
  name: "Tail Swipe",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 2 },
  damage: 30,
  onHit: [
    { type: "applyStatus", status: "bleeding", duration: 3, value: 4 },
    { type: "knockback", distance: 45 },
  ],
  visual: { color: 0xc4a030, trailEffect: "slash", screenShake: 0.5 },
};

const SUNSCORCH_WYRM_BURROW_CHARGE: AttackAbility = {
  id: "sunscorch-wyrm-burrow-charge",
  name: "Burrow Charge",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 140, width: 30 },
  damage: 50,
  visual: { color: 0xc2541d, trailEffect: "explosion", screenShake: 0.8 },
};

const FALSE_OASIS_MIRAGE_PULL: AttackAbility = {
  id: "false-oasis-mirage-pull",
  name: "Mirage Lure",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 280 },
  damage: 5,
  onHit: [
    { type: "pull", distance: 90 },
    { type: "applyStatus", status: "bleeding", duration: 3, value: 4 },
  ],
  visual: { color: 0x5090c0, trailEffect: "projectile", screenShake: 0.2 },
};

const FALSE_OASIS_CRYSTAL_TEETH: AttackAbility = {
  id: "false-oasis-crystal-teeth",
  name: "Crystal Teeth",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 70, range: 0 },
  damage: 40,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 4, value: 5 }],
  visual: { color: 0x5090c0, trailEffect: "explosion", screenShake: 0.7 },
};

const FALSE_OASIS_SHIMMER_WAVE: AttackAbility = {
  id: "false-oasis-shimmer-wave",
  name: "Shimmer Wave",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Circle, radius: 90, range: 0 },
  damage: 15,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0x5090c0, trailEffect: "splash", screenShake: 0.4 },
};

const PHARAOH_SANDSTORM: AttackAbility = {
  id: "pharaoh-sandstorm",
  name: "Sandstorm",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Circle, radius: 95, range: 180 },
  damage: 30,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
  visual: { color: 0xd4a533, trailEffect: "splash", screenShake: 0.7 },
};

const PHARAOH_CRESCENT_STRIKE: AttackAbility = {
  id: "pharaoh-crescent-strike",
  name: "Crescent Strike",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 85, halfAngle: (2 * Math.PI) / 3 },
  damage: 55,
  onHit: [{ type: "applyStatus", status: "bleeding", duration: 4, value: 5 }],
  visual: { color: 0xc2541d, trailEffect: "slash", screenShake: 0.8 },
};

const PHARAOH_SUN_DISK_BLAST: AttackAbility = {
  id: "pharaoh-sun-disk-blast",
  name: "Sun Disk Blast",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 250 },
  damage: 20,
  onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
  visual: { color: 0xf0d060, trailEffect: "projectile", screenShake: 0.35 },
};

// =============================================================================
// ENEMY TEMPLATES
// =============================================================================

const ENEMY_TEMPLATES: Record<string, UnitTemplate> = {
  // --- Fodder ---
  "sand-skitter": {
    abilities: [makeMove(140), SAND_SKITTER_PINCH],
    hp: 35,
    energy: { red: 1, blue: 1 },
    collisionRadius: 12,
    className: "Sand Skitter",
    sprites: enemySprites("sand-skitter"),
    heightMeters: 1.0,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "mirage-wisp": {
    abilities: [makeMove(150), MIRAGE_WISP_SHIMMER_BOLT],
    hp: 25,
    energy: { red: 1, blue: 2 },
    collisionRadius: 10,
    className: "Mirage Wisp",
    sprites: enemySprites("mirage-wisp"),
    heightMeters: 1.0,
    strategy: "kite",
    cost: 2,
    tags: ["ranged", "swarm"],
  },
  "dune-jackal": {
    abilities: [makeMove(170), DUNE_JACKAL_RAKE],
    hp: 40,
    energy: { red: 1, blue: 1 },
    collisionRadius: 13,
    className: "Dune Jackal",
    sprites: enemySprites("dune-jackal"),
    heightMeters: 1.5,
    strategy: "rush",
    cost: 2,
    tags: ["melee", "swarm"],
  },
  "dust-devil": {
    abilities: [makeMove(160), DUST_DEVIL_GUST],
    hp: 30,
    energy: { red: 1, blue: 2 },
    collisionRadius: 12,
    className: "Dust Devil",
    sprites: enemySprites("dust-devil"),
    heightMeters: 1.5,
    strategy: "kite",
    cost: 2,
    tags: ["ranged", "swarm"],
  },

  // --- Standard ---
  "gilt-viper": {
    abilities: [makeMove(150), GILT_VIPER_LUNGE, GILT_VIPER_COIL_STRIKE],
    hp: 80,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Gilt Viper",
    sprites: enemySprites("gilt-viper"),
    heightMeters: 1.75,
    strategy: "rush",
    cost: 4,
    tags: ["melee"],
  },
  "carrion-vulture": {
    abilities: [makeMove(140), CARRION_VULTURE_DIVE, CARRION_VULTURE_TALON_RAKE],
    hp: 65,
    energy: { red: 1, blue: 2 },
    collisionRadius: 16,
    className: "Carrion Vulture",
    sprites: enemySprites("carrion-vulture"),
    heightMeters: 2.0,
    strategy: "kite",
    cost: 4,
    tags: ["ranged"],
  },
  "sandsworn-raider": {
    abilities: [makeMove(130), SANDSWORN_RAIDER_DUAL_SLASH, SANDSWORN_RAIDER_RIPOSTE],
    hp: 90,
    energy: { red: 1, blue: 1 },
    collisionRadius: 14,
    className: "Sandsworn Raider",
    sprites: enemySprites("sandsworn-raider"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 5,
    tags: ["melee"],
  },
  "shimmer-stalker": {
    abilities: [makeMove(120), SHIMMER_STALKER_MIRAGE_FLASH, SHIMMER_STALKER_PHANTOM_BITE],
    hp: 70,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Shimmer Stalker",
    sprites: enemySprites("shimmer-stalker"),
    heightMeters: 1.75,
    strategy: "kite",
    cost: 4,
    tags: ["ranged"],
  },

  // --- Elites ---
  "dune-reaver": {
    abilities: [makeMove(100), DUNE_REAVER_AMBUSH, DUNE_REAVER_HOOK_LEGS],
    hp: 140,
    energy: { red: 2, blue: 1 },
    collisionRadius: 20,
    className: "Dune Reaver",
    sprites: enemySprites("dune-reaver"),
    heightMeters: 2.5,
    strategy: "rush",
    cost: 7,
    tags: ["melee", "elite"],
  },
  "oasis-guardian": {
    abilities: [makeMove(60), OASIS_GUARDIAN_MIRAGE_PULSE, OASIS_GUARDIAN_CRYSTAL_SLAM],
    hp: 220,
    energy: { red: 1, blue: 1 },
    collisionRadius: 24,
    className: "Oasis Guardian",
    sprites: enemySprites("oasis-guardian"),
    heightMeters: 3.5,
    strategy: "threat",
    cost: 9,
    tags: ["melee", "tank", "elite"],
  },
  "gazelle-matriarch": {
    abilities: [makeMove(170), GAZELLE_MATRIARCH_STAMPEDE, GAZELLE_MATRIARCH_HORN_GORE],
    hp: 100,
    energy: { red: 2, blue: 2 },
    collisionRadius: 18,
    className: "Gazelle Matriarch",
    sprites: enemySprites("gazelle-matriarch"),
    heightMeters: 2.5,
    strategy: "rush",
    cost: 7,
    tags: ["melee", "elite"],
  },
  "sandwraith": {
    abilities: [makeMove(160), SANDWRAITH_PHASE_SLASH, SANDWRAITH_MIRAGE_STEP],
    hp: 95,
    energy: { red: 1, blue: 2 },
    collisionRadius: 14,
    className: "Sandwraith",
    sprites: enemySprites("sandwraith"),
    heightMeters: 2.0,
    strategy: "rush",
    cost: 7,
    tags: ["melee", "elite"],
  },

  // --- Bosses ---
  "caravan-king": {
    abilities: [makeMove(70), CARAVAN_KING_COIN_SHRAPNEL, CARAVAN_KING_FLAIL_SMASH],
    hp: 300,
    energy: { red: 2, blue: 1 },
    collisionRadius: 28,
    className: "The Caravan King",
    sprites: enemySprites("caravan-king"),
    heightMeters: 4.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "sandsworn-raider", count: 2 } }],
    cost: 12,
    tags: ["melee", "boss"],
  },
  "sunscorch-wyrm": {
    abilities: [makeMove(100), SUNSCORCH_WYRM_SANDSTORM_BREATH, SUNSCORCH_WYRM_TAIL_SWIPE, SUNSCORCH_WYRM_BURROW_CHARGE],
    hp: 400,
    energy: { red: 2, blue: 1 },
    collisionRadius: 26,
    className: "Sunscorch Wyrm",
    sprites: enemySprites("sunscorch-wyrm"),
    heightMeters: 5.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "sand-skitter", count: 3 } }],
    cost: 14,
    tags: ["melee", "boss"],
  },
  "the-false-oasis": {
    abilities: [makeMove(30), FALSE_OASIS_MIRAGE_PULL, FALSE_OASIS_CRYSTAL_TEETH, FALSE_OASIS_SHIMMER_WAVE],
    hp: 280,
    energy: { red: 2, blue: 1 },
    collisionRadius: 30,
    className: "The False Oasis",
    sprites: enemySprites("the-false-oasis"),
    heightMeters: 3.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "mirage-wisp", count: 3 } }],
    cost: 12,
    tags: ["ranged", "tank", "boss"],
  },
  "pharaoh-of-the-sands": {
    abilities: [makeMove(90), PHARAOH_SANDSTORM, PHARAOH_CRESCENT_STRIKE, PHARAOH_SUN_DISK_BLAST],
    hp: 450,
    energy: { red: 2, blue: 2 },
    collisionRadius: 20,
    className: "Pharaoh of the Sands",
    sprites: enemySprites("pharaoh-of-the-sands"),
    heightMeters: 3.0,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "sandwraith", count: 2 } }],
    cost: 15,
    tags: ["melee", "boss"],
  },
};

// =============================================================================
// STRUCTURES — The Gilt Barrens
// =============================================================================

const STRUCTURE_COUNT = 29;

function buildDim3Structures(): StructureEntry[] {
  const entries: StructureEntry[] = [];
  for (let i = 0; i < STRUCTURE_COUNT; i++) {
    const id = String(i).padStart(2, "0");
    const t = STRUCTURE_COUNT > 1 ? i / (STRUCTURE_COUNT - 1) : 0;
    entries.push({
      name: `structure-${id}`,
      index: i,
      cost: t < 0.33 ? 1 : t < 0.66 ? 2 : 3,
      scale: 0.25 + t * 0.15,
      spritePath: `sprites/map-objects/dimension-3/sprite-${id}.png`,
    });
  }
  return entries;
}

const DIMENSION_3_STRUCTURES = buildDim3Structures();

// =============================================================================
// ITEMS — The Gilt Barrens
// =============================================================================

const DIMENSION_3_ITEMS: Record<string, ItemDefinition> = {
  "dune-cleaver": {
    type: "weapon",
    id: "dune-cleaver",
    name: "Dune Cleaver",
    description: "A broad-bladed machete with a golden tint from desert dust. Hacks through anything that gets close.",
    rarity: "common",
    sprite: "dune-cleaver",
    dimensionId: 3,
    slotCost: { hand: 1 },
    abilities: [{
      id: "cleaver-slash",
      name: "Desert Slash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 75, halfAngle: Math.PI / 3 },
      damage: 24,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 3 }],
      visual: { color: 0xa09060, trailEffect: "slash", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "cleaver-chop",
      name: "Chop",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 70, width: 14 },
      damage: 12,
      visual: { color: 0xa09060, trailEffect: "thrust" },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "scorpion-spear": {
    type: "weapon",
    id: "scorpion-spear",
    name: "Scorpion Spear",
    description: "A spear tipped with a scorpion stinger. The barb hooks in and the venom does the rest.",
    rarity: "common",
    sprite: "scorpion-spear",
    dimensionId: 3,
    slotCost: { hand: 1 },
    abilities: [{
      id: "scorpion-sting",
      name: "Scorpion Sting",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 120, width: 16 },
      damage: 22,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
      visual: { color: 0xc4a030, trailEffect: "thrust", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "scorpion-shaft-sweep",
      name: "Shaft Sweep",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 55, halfAngle: Math.PI / 4 },
      damage: 10,
      visual: { color: 0xc4a030, trailEffect: "slash", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "spear",
  },

  "sandhorn-bow": {
    type: "weapon",
    id: "sandhorn-bow",
    name: "Sandhorn Bow",
    description: "A recurve bow of polished antelope horn. The flint-tipped arrows leave wounds that bleed freely.",
    rarity: "common",
    sprite: "sandhorn-bow",
    dimensionId: 3,
    slotCost: { hand: 2 },
    abilities: [{
      id: "sandhorn-shot",
      name: "Flint Shot",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Point, range: 280 },
      damage: 20,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 3 }],
      visual: { color: 0xa89070, trailEffect: "projectile", screenShake: 0.2 },
    } satisfies AttackAbility, {
      id: "sandhorn-rapid-shot",
      name: "Rapid Shot",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Point, range: 240 },
      damage: 10,
      visual: { color: 0xa89070, trailEffect: "projectile" },
    } satisfies AttackAbility],
    animSet: "bow",
  },

  "raiders-twinblade": {
    type: "weapon",
    id: "raiders-twinblade",
    name: "Raider's Twinblade",
    description: "Twin curved scimitars on a chain. Every strike is two cuts.",
    rarity: "uncommon",
    sprite: "raiders-twinblade",
    dimensionId: 3,
    slotCost: { hand: 1 },
    abilities: [{
      id: "twinblade-double-slash",
      name: "Double Slash",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 70, halfAngle: Math.PI / 2 },
      damage: 26,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 5 }],
      visual: { color: 0xa09060, trailEffect: "slash", screenShake: 0.4 },
    } satisfies AttackAbility, {
      id: "twinblade-chain-sweep",
      name: "Chain Sweep",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
      damage: 14,
      onHit: [{ type: "knockback", distance: 25 }],
      visual: { color: 0x808080, trailEffect: "slash", screenShake: 0.25 },
    } satisfies AttackAbility, {
      id: "twinblade-cross-cut",
      name: "Cross Cut",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 65, width: 20 },
      damage: 16,
      visual: { color: 0xa09060, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "mirage-staff": {
    type: "weapon",
    id: "mirage-staff",
    name: "Mirage Staff",
    description: "A petrified staff capped with a floating crystal shard. It bends the light around itself — and around your enemies.",
    rarity: "rare",
    sprite: "mirage-staff",
    dimensionId: 3,
    slotCost: { hand: 2 },
    abilities: [{
      id: "mirage-staff-heat-shimmer",
      name: "Heat Shimmer",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Circle, radius: 70, range: 200 },
      damage: 18,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 3, value: 4 }],
      visual: { color: 0xf0d060, trailEffect: "splash", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "mirage-staff-crystal-bolt",
      name: "Crystal Bolt",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Point, range: 260 },
      damage: 16,
      visual: { color: 0xf0d060, trailEffect: "projectile", screenShake: 0.2 },
    } satisfies AttackAbility, {
      id: "mirage-staff-disorienting-pulse",
      name: "Disorienting Pulse",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Circle, radius: 55, range: 0 },
      damage: 10,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 2, value: 3 }],
      visual: { color: 0xf0d060, trailEffect: "explosion", screenShake: 0.3 },
    } satisfies AttackAbility],
    animSet: "staff",
  },

  "viper-fang-dagger": {
    type: "weapon",
    id: "viper-fang-dagger",
    name: "Viper Fang Dagger",
    description: "A curved dagger carved from a serpent's fang. Still warm, still sharp.",
    rarity: "uncommon",
    sprite: "viper-fang-dagger",
    dimensionId: 3,
    slotCost: { hand: 1 },
    abilities: [{
      id: "viper-dagger-fang-strike",
      name: "Fang Strike",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 65, width: 12 },
      damage: 20,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 4, value: 4 }],
      visual: { color: 0xd4a040, trailEffect: "thrust", screenShake: 0.3 },
    } satisfies AttackAbility, {
      id: "viper-dagger-quick-slash",
      name: "Quick Slash",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 50, halfAngle: Math.PI / 4 },
      damage: 10,
      visual: { color: 0xd4a040, trailEffect: "slash", screenShake: 0.15 },
    } satisfies AttackAbility, {
      id: "viper-dagger-venom-nick",
      name: "Venom Nick",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 55, width: 10 },
      damage: 6,
      onHit: [{ type: "applyStatus", status: "poisoned", duration: 3, value: 4 }],
      visual: { color: 0x80a040, trailEffect: "thrust" },
    } satisfies AttackAbility],
    animSet: "sword",
  },

  "wyrm-spine-lance": {
    type: "weapon",
    id: "wyrm-spine-lance",
    name: "Wyrm-Spine Lance",
    description: "A lance made from a wyrm vertebra. Radiates heat that sears on impact.",
    rarity: "uncommon",
    sprite: "wyrm-spine-lance",
    dimensionId: 3,
    slotCost: { hand: 1 },
    abilities: [{
      id: "wyrm-lance-searing-thrust",
      name: "Searing Thrust",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Rectangle, length: 130, width: 18 },
      damage: 28,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.3 }],
      visual: { color: 0xc2541d, trailEffect: "thrust", screenShake: 0.35 },
    } satisfies AttackAbility, {
      id: "wyrm-lance-heat-sweep",
      name: "Heat Sweep",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Sector, radius: 65, halfAngle: Math.PI / 3 },
      damage: 14,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 2, value: 3 }],
      visual: { color: 0xc2541d, trailEffect: "slash", screenShake: 0.25 },
    } satisfies AttackAbility, {
      id: "wyrm-lance-impale",
      name: "Impale",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 100, width: 12 },
      damage: 16,
      visual: { color: 0xc2541d, trailEffect: "thrust", screenShake: 0.2 },
    } satisfies AttackAbility],
    animSet: "spear",
  },

  "pharaohs-crescent": {
    type: "weapon",
    id: "pharaohs-crescent",
    name: "Pharaoh's Crescent",
    description: "A massive crescent polearm of blackened gold. The inscriptions hum in sunlight.",
    rarity: "rare",
    sprite: "pharaohs-crescent",
    dimensionId: 3,
    slotCost: { hand: 2 },
    abilities: [{
      id: "crescent-reaping-arc",
      name: "Reaping Arc",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: (2 * Math.PI) / 3 },
      damage: 38,
      onHit: [{ type: "applyStatus", status: "bleeding", duration: 4, value: 5 }],
      visual: { color: 0xd4a533, trailEffect: "slash", screenShake: 0.6 },
    } satisfies AttackAbility, {
      id: "crescent-sundering-slam",
      name: "Sundering Slam",
      kind: "attack",
      cost: { red: 2 },
      shape: { kind: ShapeKind.Circle, radius: 55, range: 0 },
      damage: 30,
      onHit: [{ type: "applyStatus", status: "vulnerable", duration: 2, value: 0.4 }],
      visual: { color: 0xd4a533, trailEffect: "explosion", screenShake: 0.5 },
    } satisfies AttackAbility, {
      id: "crescent-gold-thrust",
      name: "Gold Thrust",
      kind: "attack",
      cost: { red: 1 },
      shape: { kind: ShapeKind.Rectangle, length: 100, width: 20 },
      damage: 18,
      visual: { color: 0xd4a533, trailEffect: "thrust", screenShake: 0.25 },
    } satisfies AttackAbility],
    animSet: "two-handed",
  },
};

// --- Seed ---

export function seedDimension3(): void {
  saveDimension(3, "The Gilt Barrens", DIMENSION_3_STRUCTURES, "sprites/map-objects/dimension-3/background.png", "sprites/map-decorations/dimension-3");
  saveEnemyTemplates(3, ENEMY_TEMPLATES);
  saveItems(3, DIMENSION_3_ITEMS);
}
