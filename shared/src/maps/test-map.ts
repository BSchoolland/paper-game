import type { Entity, GameState } from "../types.js";
import { SHORT_SWORD, ENTITY_DEFAULTS } from "../types.js";
import { createGrid, rasterizeRect } from "../collision-grid.js";

function makeEntity(
  id: string,
  name: string,
  x: number,
  y: number,
  teamId: "red" | "blue"
): Entity {
  return {
    id,
    name,
    position: { x, y },
    collisionRadius: ENTITY_DEFAULTS.collisionRadius,
    hp: ENTITY_DEFAULTS.hp,
    maxHp: ENTITY_DEFAULTS.hp,
    teamId,
    movementBudget: ENTITY_DEFAULTS.movementBudget,
    movementRemaining: ENTITY_DEFAULTS.movementBudget,
    actionsRemaining: ENTITY_DEFAULTS.actionsPerTurn,
    canMoveAfterAttack: ENTITY_DEFAULTS.canMoveAfterAttack,
    hasAttackedThisTurn: false,
    weapon: SHORT_SWORD,
  };
}

export function createTestMap() {
  const cellSize = 8;
  const width = 100;
  const height = 75;
  let grid = createGrid(width, height, cellSize);

  grid = rasterizeRect(grid, 0, 0, width, 2);
  grid = rasterizeRect(grid, 0, height - 2, width, 2);
  grid = rasterizeRect(grid, 0, 0, 2, height);
  grid = rasterizeRect(grid, width - 2, 0, 2, height);

  grid = rasterizeRect(grid, 48, 15, 4, 18);
  grid = rasterizeRect(grid, 48, 42, 4, 18);

  grid = rasterizeRect(grid, 22, 22, 5, 5);
  grid = rasterizeRect(grid, 73, 48, 5, 5);

  return grid;
}

export function createInitialGameState(): GameState {
  const grid = createTestMap();
  const entities = new Map<string, Entity>();

  entities.set("red1", makeEntity("red1", "Red Delver I", 120, 200, "red"));
  entities.set("red2", makeEntity("red2", "Red Delver II", 120, 300, "red"));
  entities.set("red3", makeEntity("red3", "Red Delver III", 120, 400, "red"));

  entities.set("blue1", makeEntity("blue1", "Blue Delver I", 680, 200, "blue"));
  entities.set("blue2", makeEntity("blue2", "Blue Delver II", 680, 300, "blue"));
  entities.set("blue3", makeEntity("blue3", "Blue Delver III", 680, 400, "blue"));

  return {
    entities,
    grid,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}
