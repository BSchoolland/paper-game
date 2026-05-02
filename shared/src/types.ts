export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface GridState {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly walls: Uint8Array;
}

export interface Entity {
  readonly id: string;
  readonly position: Vec2;
  readonly collisionRadius: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly team: "red" | "blue";
  readonly movementBudget: number;
  readonly movementRemaining: number;
  readonly actionsRemaining: number;
  readonly canMoveAfterAttack: boolean;
  readonly hasAttackedThisTurn: boolean;
}

export interface GameState {
  readonly entities: ReadonlyMap<string, Entity>;
  readonly grid: GridState;
  readonly activeTeam: "red" | "blue";
  readonly turnNumber: number;
  readonly winner: "red" | "blue" | null;
}

export type PlayerAction =
  | { type: "move"; entityId: string; destination: Vec2 }
  | { type: "attack"; entityId: string; aimDirection: Vec2 }
  | { type: "endTurn" };

export interface SwordStats {
  readonly radius: number;
  readonly halfAngle: number;
  readonly damage: number;
}

export const DEFAULT_SWORD: SwordStats = {
  radius: 60,
  halfAngle: Math.PI / 4,
  damage: 25,
};

export const ENTITY_DEFAULTS = {
  collisionRadius: 16,
  hp: 100,
  movementBudget: 150,
  actionsPerTurn: 1,
  canMoveAfterAttack: false,
} as const;
