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

export type CombatShapeDefinition =
  | { kind: "sector"; radius: number; halfAngle: number }
  | { kind: "rectangle"; length: number; width: number }
  | { kind: "circle"; radius: number; range: number }
  | { kind: "point"; range: number };

export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  readonly shape: CombatShapeDefinition;
  readonly damage: number;
  readonly actionCost: number;
  readonly ignoreCoverRange?: number;
  readonly onHit?: readonly WeaponEffect[];
}

export type WeaponEffect =
  | { type: "knockback"; distance: number };

export interface Entity {
  readonly id: EntityId;
  readonly name: string;
  readonly position: Vec2;
  readonly collisionRadius: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly teamId: TeamId;
  readonly movementBudget: number;
  readonly movementRemaining: number;
  readonly actionsRemaining: number;
  readonly canMoveAfterAttack: boolean;
  readonly hasAttackedThisTurn: boolean;
  readonly weapon: WeaponDefinition;
  readonly spriteType?: string;
  readonly spriteScale?: number;
  readonly strategy?: AiStrategyType;
  readonly effects?: readonly EntityEffect[];
  readonly dead?: boolean;
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
  | { type: "move"; entityId: EntityId; destination: Vec2 }
  | { type: "attack"; entityId: EntityId; aimDirection: Vec2 }
  | { type: "endTurn" };

export type GameEvent =
  | { type: "move"; entityId: EntityId; from: Vec2; to: Vec2 }
  | {
      type: "attack";
      attackerId: EntityId;
      attackerPosition: Vec2;
      aimDirection: Vec2;
      weapon: WeaponDefinition;
      hits: readonly AttackHit[];
    }
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

export const SHORT_SWORD: WeaponDefinition = {
  id: "short-sword",
  name: "Short Sword",
  shape: { kind: "sector", radius: 80, halfAngle: Math.PI / 3 },
  damage: 25,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 30 }],
};

export const SPEAR: WeaponDefinition = {
  id: "spear",
  name: "Spear",
  shape: { kind: "rectangle", length: 140, width: 20 },
  damage: 30,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 25 }],
};

export const BOW: WeaponDefinition = {
  id: "bow",
  name: "Bow",
  shape: { kind: "point", range: 300 },
  damage: 20,
  actionCost: 1,
  ignoreCoverRange: 40,
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

export interface UnitTemplate {
  readonly weapon: WeaponDefinition;
  readonly hp: number;
  readonly movementBudget: number;
  readonly collisionRadius: number;
  readonly canMoveAfterAttack: boolean;
  readonly className: string;
  readonly spriteType?: string;
  readonly spriteScale?: number;
  readonly strategy?: AiStrategyType;
  readonly effects?: readonly EntityEffect[];
  readonly cost?: number;
  readonly tags?: readonly EnemyTag[];
}

export const UNIT_TEMPLATES = {
  player: {
    weapon: SHORT_SWORD,
    hp: 120,
    movementBudget: 130,
    collisionRadius: 16,
    canMoveAfterAttack: true,
    className: "Player",
  },
} as const satisfies Record<string, UnitTemplate>;

export const GOBLIN_SPEAR: WeaponDefinition = {
  id: "goblin-spear",
  name: "Goblin Spear",
  shape: { kind: "rectangle", length: 100, width: 18 },
  damage: 25,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 20 }],
};

export const GOBLIN_BOW: WeaponDefinition = {
  id: "goblin-bow",
  name: "Goblin Bow",
  shape: { kind: "point", range: 260 },
  damage: 15,
  actionCost: 1,
};

export const SHIELD_BASH: WeaponDefinition = {
  id: "shield-bash",
  name: "Shield Bash",
  shape: { kind: "sector", radius: 60, halfAngle: Math.PI / 4 },
  damage: 15,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 45 }],
};

export const BRUTE_SLAM: WeaponDefinition = {
  id: "brute-slam",
  name: "Brute Slam",
  shape: { kind: "sector", radius: 90, halfAngle: Math.PI / 2 },
  damage: 40,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 50 }],
};

export const GOLEM_SMASH: WeaponDefinition = {
  id: "golem-smash",
  name: "Golem Smash",
  shape: { kind: "circle", radius: 70, range: 60 },
  damage: 50,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 60 }],
};

export const SLIME_SPIT: WeaponDefinition = {
  id: "slime-spit",
  name: "Slime Spit",
  shape: { kind: "point", range: 180 },
  damage: 12,
  actionCost: 1,
};

export const SLIME_LASH: WeaponDefinition = {
  id: "slime-lash",
  name: "Slime Lash",
  shape: { kind: "sector", radius: 70, halfAngle: Math.PI / 3 },
  damage: 20,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 20 }],
};

export const SLIME_WAVE: WeaponDefinition = {
  id: "slime-wave",
  name: "Slime Wave",
  shape: { kind: "circle", radius: 80, range: 50 },
  damage: 35,
  actionCost: 1,
  onHit: [{ type: "knockback", distance: 35 }],
};

export const ENEMY_TEMPLATES = {
  "goblin-spear": {
    weapon: GOBLIN_SPEAR,
    hp: 80,
    movementBudget: 150,
    collisionRadius: 14,
    canMoveAfterAttack: false,
    className: "Goblin Spearman",
    spriteType: "goblin-spear",
    strategy: "rush",
    cost: 3,
    tags: ["melee"],
  },
  "goblin-archer": {
    weapon: GOBLIN_BOW,
    hp: 55,
    movementBudget: 140,
    collisionRadius: 12,
    canMoveAfterAttack: true,
    className: "Goblin Archer",
    spriteType: "goblin-archer",
    strategy: "kite",
    cost: 3,
    tags: ["ranged"],
  },
  "goblin-shield": {
    weapon: SHIELD_BASH,
    hp: 110,
    movementBudget: 110,
    collisionRadius: 16,
    canMoveAfterAttack: true,
    className: "Goblin Shield",
    spriteType: "goblin-shield",
    strategy: "rush",
    cost: 4,
    tags: ["melee", "tank"],
  },
  "goblin-brute": {
    weapon: BRUTE_SLAM,
    hp: 160,
    movementBudget: 90,
    collisionRadius: 20,
    canMoveAfterAttack: false,
    className: "Goblin Brute",
    spriteType: "goblin-brute",
    strategy: "rush",
    cost: 6,
    tags: ["melee", "elite"],
  },
  "stone-golem": {
    weapon: GOLEM_SMASH,
    hp: 250,
    movementBudget: 70,
    collisionRadius: 22,
    canMoveAfterAttack: false,
    className: "Stone Golem",
    spriteType: "stone-golem",
    strategy: "threat",
    cost: 10,
    tags: ["melee", "tank", "boss"],
  },
  "slime": {
    weapon: SLIME_SPIT,
    hp: 40,
    movementBudget: 120,
    collisionRadius: 12,
    canMoveAfterAttack: true,
    className: "Slime",
    spriteType: "slime",
    strategy: "kite",
    cost: 1,
    tags: ["ranged", "swarm"],
  },
  "big-slime": {
    weapon: SLIME_LASH,
    hp: 90,
    movementBudget: 100,
    collisionRadius: 18,
    canMoveAfterAttack: true,
    className: "Big Slime",
    spriteType: "slime",
    spriteScale: 1.5,
    strategy: "rush",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "slime", count: 2 } }],
    cost: 6,
    tags: ["melee", "tank", "elite"],
  },
  "massive-slime": {
    weapon: SLIME_WAVE,
    hp: 200,
    movementBudget: 70,
    collisionRadius: 28,
    canMoveAfterAttack: false,
    className: "Massive Slime",
    spriteType: "slime",
    spriteScale: 3,
    strategy: "threat",
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "big-slime", count: 2 } }],
    cost: 14,
    tags: ["melee", "tank", "boss"],
  },
} as const satisfies Record<string, UnitTemplate>;
