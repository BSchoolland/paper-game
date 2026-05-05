import type { Entity, GameState, TeamId, UnitTemplate } from "../types.js";
import { UNIT_TEMPLATES, ENEMY_TEMPLATES } from "../types.js";
import { createGrid } from "../collision-grid.js";
import { generateMapObjects } from "../map-definition.js";

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
    spriteType: template.spriteType,
  };
}

export function createTestMap() {
  const cellSize = 2;
  const width = 400;
  const height = 300;
  const grid = createGrid(width, height, cellSize);
  return grid;
}

export function createInitialGameState(): GameState {
  const grid = createTestMap();
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const mapDefinition = generateMapObjects(worldW, worldH, 42);
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
    mapDefinition,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}

export function createPveGameState(): GameState {
  const grid = createTestMap();
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const mapDefinition = generateMapObjects(worldW, worldH, 42);
  const entities = new Map<string, Entity>();
  const { warrior, spearman, archer } = UNIT_TEMPLATES;

  entities.set("red1", makeEntity("red1", "Warrior", 120, 200, "red", warrior));
  entities.set("red2", makeEntity("red2", "Spearman", 120, 300, "red", spearman));
  entities.set("red3", makeEntity("red3", "Archer", 100, 400, "red", archer));

  const gs = ENEMY_TEMPLATES["goblin-spear"];
  const ga = ENEMY_TEMPLATES["goblin-archer"];
  const gsh = ENEMY_TEMPLATES["goblin-shield"];
  const sl = ENEMY_TEMPLATES["slime"];

  entities.set("enemy1", makeEntity("enemy1", "Goblin Spearman", 600, 200, "blue", gs));
  entities.set("enemy2", makeEntity("enemy2", "Goblin Archer", 650, 320, "blue", ga));
  entities.set("enemy3", makeEntity("enemy3", "Goblin Shield", 560, 260, "blue", gsh));
  entities.set("enemy5", makeEntity("enemy5", "Goblin Archer", 700, 150, "blue", ga));
  entities.set("enemy6", makeEntity("enemy6", "Slime", 500, 350, "blue", sl));
  entities.set("enemy7", makeEntity("enemy7", "Slime", 530, 450, "blue", sl));
  entities.set("enemy8", makeEntity("enemy8", "Goblin Spearman", 650, 430, "blue", gs));
  entities.set("enemy9", makeEntity("enemy9", "Goblin Shield", 640, 160, "blue", gsh));

  return {
    entities,
    grid,
    mapDefinition,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}
