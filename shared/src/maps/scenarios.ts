import type { GridState } from "../core/types.js";
import { createGrid } from "../map/collision-grid.js";
import { generateMapObjects } from "../map/map-definition.js";
import type { MapDefinition } from "../map/map-definition.js";

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

