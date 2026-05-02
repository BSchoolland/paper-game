import type { Entity, GameState, TeamId, UnitTemplate } from "../types.js";
import { UNIT_TEMPLATES } from "../types.js";
import { createGrid, rasterizeRect } from "../collision-grid.js";

function makeEntity(
  id: string,
  name: string,
  x: number,
  y: number,
  teamId: TeamId,
  template: UnitTemplate
): Entity {
  return {
    id,
    name,
    position: { x, y },
    collisionRadius: template.collisionRadius,
    hp: template.hp,
    maxHp: template.hp,
    teamId,
    movementBudget: template.movementBudget,
    movementRemaining: template.movementBudget,
    actionsRemaining: 1,
    canMoveAfterAttack: template.canMoveAfterAttack,
    hasAttackedThisTurn: false,
    weapon: template.weapon,
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
  const { warrior, spearman, archer } = UNIT_TEMPLATES;

  entities.set("red1", makeEntity("red1", "Red Warrior", 120, 200, "red", warrior));
  entities.set("red2", makeEntity("red2", "Red Spearman", 120, 300, "red", spearman));
  entities.set("red3", makeEntity("red3", "Red Archer", 100, 400, "red", archer));

  entities.set("blue1", makeEntity("blue1", "Blue Warrior", 680, 200, "blue", warrior));
  entities.set("blue2", makeEntity("blue2", "Blue Spearman", 680, 300, "blue", spearman));
  entities.set("blue3", makeEntity("blue3", "Blue Archer", 700, 400, "blue", archer));

  return {
    entities,
    grid,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}
