export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type TeamId = "red" | "blue";
export type EntityId = string;

export interface GridState {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly walls: Uint8Array;
}

export const enum ShapeKind {
  Sector = "sector",
  Rectangle = "rectangle",
  Circle = "circle",
  Point = "point",
}

export type CombatShapeDefinition =
  | { kind: ShapeKind.Sector; radius: number; halfAngle: number }
  | { kind: ShapeKind.Rectangle; length: number; width: number }
  | { kind: ShapeKind.Circle; radius: number; range: number }
  | { kind: ShapeKind.Point; range: number };

export type WeaponEffect =
  | { type: "knockback"; distance: number };

// --- Attack Visuals (client-side rendering hints, fully JSON-serializable) ---

export type TrailEffect = "slash" | "thrust" | "projectile" | "explosion" | "splash";

export interface AttackVisual {
  readonly color?: number;
  readonly trailEffect?: TrailEffect;
  readonly screenShake?: number;
}

// --- Ability System ---

export interface EnergyCost {
  readonly red?: number;
  readonly blue?: number;
}

export interface EnergyPool {
  readonly red: number;
  readonly blue: number;
  readonly maxRed: number;
  readonly maxBlue: number;
}

interface AbilityBase {
  readonly id: string;
  readonly name: string;
  readonly cost: EnergyCost;
  readonly variableCost?: boolean;
}

export interface AttackAbility extends AbilityBase {
  readonly kind: "attack";
  readonly shape: CombatShapeDefinition;
  readonly damage: number;
  readonly ignoreCoverRange?: number;
  readonly onHit?: readonly WeaponEffect[];
  readonly visual?: AttackVisual;
}

export interface MoveAbility extends AbilityBase {
  readonly kind: "move";
  readonly distance: number;
}

export interface BuffAbility extends AbilityBase {
  readonly kind: "buff";
  readonly effect: BuffEffect;
}

export type BuffEffect =
  | { type: "block"; damageReduction: number };

export type AbilityDefinition = AttackAbility | MoveAbility | BuffAbility;

export interface ActiveBuff {
  readonly id: string;
  readonly effect: BuffEffect;
  readonly turnsRemaining: number;
}


export interface Entity {
  readonly id: EntityId;
  readonly name: string;
  readonly position: Vec2;
  readonly collisionRadius: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly teamId: TeamId;
  readonly energy: EnergyPool;
  readonly abilities: readonly AbilityDefinition[];
  readonly buffs: readonly ActiveBuff[];
  readonly spriteType?: string;
  readonly spriteScale?: number;
  readonly heightMeters?: number;
  readonly strategy?: AiStrategyType;
  readonly effects?: readonly EntityEffect[];
  readonly dead?: boolean;
  readonly equipped?: readonly import("./items.js").ItemDefinition[];
  readonly attachments?: Record<string, import("../core/inventory.js").AttachmentData>;
}

export interface GameState {
  readonly entities: ReadonlyMap<EntityId, Entity>;
  readonly grid: GridState;
  readonly mapDefinition: import("../map/map-definition.js").MapDefinition;
  readonly activeTeam: TeamId;
  readonly turnNumber: number;
  readonly winner: TeamId | null;
}

export type PlayerAction =
  | { type: "ability"; entityId: EntityId; abilityId: string; aimDirection?: Vec2; destination?: Vec2 }
  | { type: "endTurn" };

export type GameEvent =
  | { type: "move"; entityId: EntityId; from: Vec2; to: Vec2 }
  | {
      type: "attack";
      attackerId: EntityId;
      attackerPosition: Vec2;
      aimDirection: Vec2;
      ability: AttackAbility;
      hits: readonly AttackHit[];
    }
  | { type: "buff"; entityId: EntityId; buff: ActiveBuff }
  | { type: "endTurn"; nextTeam: TeamId }
  | { type: "spawn"; entityId: EntityId; position: Vec2; templateKey: string }
  | { type: "knockback"; entityId: EntityId; from: Vec2; to: Vec2 };

export interface AttackHit {
  readonly targetId: EntityId;
  readonly damage: number;
  readonly killed: boolean;
}

export type EffectTrigger = "onDeath";

export type EffectAction =
  | { type: "spawn"; templateKey: string; count: number };

export interface EntityEffect {
  readonly trigger: EffectTrigger;
  readonly action: EffectAction;
}

export interface ActionResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

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
  shape: { kind: ShapeKind.Rectangle, length: 70, width: 15 },
  damage: 15,
  visual: { color: 0xc0c0c0, trailEffect: "thrust" },
};

export const SPEAR_THRUST: AttackAbility = {
  id: "spear-thrust",
  name: "Thrust",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Rectangle, length: 140, width: 20 },
  damage: 30,
  onHit: [{ type: "knockback", distance: 25 }],
  visual: { color: 0xa89070, trailEffect: "thrust", screenShake: 0.3 },
};

export const SPEAR_JAB: AttackAbility = {
  id: "spear-jab",
  name: "Jab",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Rectangle, length: 110, width: 15 },
  damage: 15,
  visual: { color: 0xa89070, trailEffect: "thrust" },
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

export const BOW_SNAP_SHOT: AttackAbility = {
  id: "bow-snap-shot",
  name: "Snap Shot",
  kind: "attack",
  cost: { red: 1 },
  shape: { kind: ShapeKind.Point, range: 180 },
  damage: 10,
  visual: { color: 0xd4a857, trailEffect: "projectile" },
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

export const ENEMY_TAGS = [
  "melee",
  "ranged",
  "tank",
  "swarm",
  "elite",
  "boss",
] as const;

export type EnemyTag = (typeof ENEMY_TAGS)[number];

export type AiStrategyType = "rush" | "kite" | "threat";

export function makeMove(distance: number): MoveAbility {
  return { id: "move", name: "Move", kind: "move", cost: { blue: 1 }, distance };
}

export interface UnitTemplate {
  readonly abilities: readonly AbilityDefinition[];
  readonly hp: number;
  readonly energy: { red: number; blue: number };
  readonly collisionRadius: number;
  readonly className: string;
  readonly spriteType?: string;
  readonly spriteScale?: number;
  readonly heightMeters?: number;
  readonly strategy?: AiStrategyType;
  readonly effects?: readonly EntityEffect[];
  readonly cost?: number;
  readonly tags?: readonly EnemyTag[];
}

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
