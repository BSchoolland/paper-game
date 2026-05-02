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
  readonly activeTeam: TeamId;
  readonly turnNumber: number;
  readonly winner: TeamId | null;
}

export type PlayerAction =
  | { type: "move"; entityId: EntityId; destination: Vec2 }
  | { type: "attack"; entityId: EntityId; aimDirection: Vec2 }
  | { type: "endTurn" };

export const SHORT_SWORD: WeaponDefinition = {
  id: "short-sword",
  name: "Short Sword",
  shape: { kind: "sector", radius: 80, halfAngle: Math.PI / 3 },
  damage: 25,
  actionCost: 1,
};

export const ENTITY_DEFAULTS = {
  collisionRadius: 16,
  hp: 100,
  movementBudget: 150,
  actionsPerTurn: 1,
  canMoveAfterAttack: true,
} as const;
