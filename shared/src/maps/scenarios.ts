import type { Entity, GameState, GridState } from "../core/types.js";
import { UNIT_TEMPLATES, ENEMY_TEMPLATES } from "../core/types.js";
import { createGrid } from "../map/collision-grid.js";
import { findWalkablePosition } from "../map/collision-grid.js";
import { generateMapObjects } from "../map/map-definition.js";
import type { MapDefinition } from "../map/map-definition.js";
import { makeEntity } from "../encounter/entity-factory.js";

const GRID_WIDTH = 400;
const GRID_HEIGHT = 300;
const CELL_SIZE = 2;

export function createCombatGrid() {
  return createGrid(GRID_WIDTH, GRID_HEIGHT, CELL_SIZE);
}

export interface ScenarioMap {
  readonly grid: GridState;
  readonly mapDefinition: MapDefinition;
}

export function buildScenarioMap(seed: number): ScenarioMap {
  const grid = createCombatGrid();
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const mapDefinition = generateMapObjects(worldW, worldH, seed);
  return { grid, mapDefinition };
}

function placeEntity(
  id: string,
  name: string,
  x: number,
  y: number,
  teamId: "red" | "blue",
  template: Parameters<typeof makeEntity>[5],
  grid: GridState
): Entity {
  const pos = findWalkablePosition(grid, { x, y }, template.collisionRadius);
  return makeEntity(id, name, pos.x, pos.y, teamId, template);
}

export function placePvpEntities(grid: GridState): Map<string, Entity> {
  const entities = new Map<string, Entity>();
  const { player } = UNIT_TEMPLATES;

  entities.set("red1", placeEntity("red1", "Player", 120, 300, "red", player, grid));

  entities.set("blue1", placeEntity("blue1", "Player", 680, 300, "blue", player, grid));

  return entities;
}

export function placePveEntities(grid: GridState): Map<string, Entity> {
  const entities = new Map<string, Entity>();
  const { player } = UNIT_TEMPLATES;

  entities.set("red1", placeEntity("red1", "Player", 120, 300, "red", player, grid));

  const gs = ENEMY_TEMPLATES["goblin-spear"];
  const ga = ENEMY_TEMPLATES["goblin-archer"];
  const gsh = ENEMY_TEMPLATES["goblin-shield"];
  const sl = ENEMY_TEMPLATES["slime"];

  entities.set("enemy1", placeEntity("enemy1", "Goblin Spearman", 600, 200, "blue", gs, grid));
  entities.set("enemy2", placeEntity("enemy2", "Goblin Archer", 650, 320, "blue", ga, grid));
  entities.set("enemy3", placeEntity("enemy3", "Goblin Shield", 560, 260, "blue", gsh, grid));
  entities.set("enemy5", placeEntity("enemy5", "Goblin Archer", 700, 150, "blue", ga, grid));
  entities.set("enemy6", placeEntity("enemy6", "Slime", 500, 350, "blue", sl, grid));
  entities.set("enemy7", placeEntity("enemy7", "Slime", 530, 450, "blue", sl, grid));
  entities.set("enemy8", placeEntity("enemy8", "Goblin Spearman", 650, 430, "blue", gs, grid));
  entities.set("enemy9", placeEntity("enemy9", "Goblin Shield", 640, 160, "blue", gsh, grid));

  return entities;
}

export function assembleGameState(map: ScenarioMap, entities: Map<string, Entity>): GameState {
  return {
    entities,
    grid: map.grid,
    mapDefinition: map.mapDefinition,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}

/** @deprecated Use buildScenarioMap + placePvpEntities + assembleGameState */
export function createInitialGameState(): GameState {
  const map = buildScenarioMap(42);
  return assembleGameState(map, placePvpEntities(map.grid));
}

/** @deprecated Use buildScenarioMap + placePveEntities + assembleGameState */
export function createPveGameState(): GameState {
  const map = buildScenarioMap(42);
  return assembleGameState(map, placePveEntities(map.grid));
}
