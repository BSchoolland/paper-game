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
}

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
}

export interface GameState {
  readonly entities: ReadonlyMap<EntityId, Entity>;
  readonly grid: GridState;
  readonly mapDefinition: import("./map-definition.js").MapDefinition;
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
  | { type: "attack"; attackerId: EntityId; hits: readonly AttackHit[] }
  | { type: "endTurn"; nextTeam: TeamId };

export interface AttackHit {
  readonly targetId: EntityId;
  readonly damage: number;
  readonly killed: boolean;
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
};

export const SPEAR: WeaponDefinition = {
  id: "spear",
  name: "Spear",
  shape: { kind: "rectangle", length: 110, width: 20 },
  damage: 30,
  actionCost: 1,
};

export const BOW: WeaponDefinition = {
  id: "bow",
  name: "Bow",
  shape: { kind: "point", range: 300 },
  damage: 20,
  actionCost: 1,
  ignoreCoverRange: 40,
};

export interface UnitTemplate {
  readonly weapon: WeaponDefinition;
  readonly hp: number;
  readonly movementBudget: number;
  readonly collisionRadius: number;
  readonly canMoveAfterAttack: boolean;
  readonly className: string;
}

export const UNIT_TEMPLATES = {
  warrior: {
    weapon: SHORT_SWORD,
    hp: 120,
    movementBudget: 130,
    collisionRadius: 16,
    canMoveAfterAttack: true,
    className: "Warrior",
  },
  spearman: {
    weapon: SPEAR,
    hp: 100,
    movementBudget: 140,
    collisionRadius: 16,
    canMoveAfterAttack: false,
    className: "Spearman",
  },
  archer: {
    weapon: BOW,
    hp: 70,
    movementBudget: 160,
    collisionRadius: 14,
    canMoveAfterAttack: true,
    className: "Archer",
  },
} as const satisfies Record<string, UnitTemplate>;
