import type { Entity, GameState } from "../types.js";
import { SHORT_SWORD } from "../types.js";
import { createGrid } from "../collision-grid.js";

export function makeEntity(
  id: string,
  x: number,
  y: number,
  teamId: "red" | "blue",
  overrides: Partial<Entity> = {}
): Entity {
  return {
    id,
    name: id,
    position: { x, y },
    collisionRadius: 16,
    hp: 100,
    maxHp: 100,
    teamId,
    movementBudget: 150,
    movementRemaining: 150,
    actionsRemaining: 1,
    canMoveAfterAttack: true,
    hasAttackedThisTurn: false,
    weapon: SHORT_SWORD,
    ...overrides,
  };
}

export function makeState(
  entities: Entity[],
  overrides: Partial<GameState> = {}
): GameState {
  const map = new Map<string, Entity>();
  for (const e of entities) map.set(e.id, e);
  return {
    entities: map,
    grid: createGrid(100, 100, 8),
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
    ...overrides,
  };
}
