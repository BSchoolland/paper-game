import type { Entity, GameState, GridState } from "./types.js";

export interface SerializedGameState {
  entities: Record<string, Entity>;
  grid: { width: number; height: number; cellSize: number; walls: string };
  mapDefinition: GameState["mapDefinition"];
  activeTeam: GameState["activeTeam"];
  turnNumber: number;
  winner: GameState["winner"];
  nextSpawnId: number;
  actionCount: number;
}

export function serializeGameState(state: GameState): SerializedGameState {
  const entities: Record<string, Entity> = {};
  for (const [id, entity] of state.entities) {
    entities[id] = entity;
  }

  let binary = "";
  for (let i = 0; i < state.grid.walls.length; i++) {
    binary += String.fromCharCode(state.grid.walls[i]!);
  }

  return {
    entities,
    grid: {
      width: state.grid.width,
      height: state.grid.height,
      cellSize: state.grid.cellSize,
      walls: btoa(binary),
    },
    mapDefinition: state.mapDefinition,
    activeTeam: state.activeTeam,
    turnNumber: state.turnNumber,
    winner: state.winner,
    nextSpawnId: state.nextSpawnId,
    actionCount: state.actionCount,
  };
}

export function deserializeGameState(data: SerializedGameState): GameState {
  const entities = new Map<string, Entity>();
  for (const [id, entity] of Object.entries(data.entities)) {
    entities.set(id, entity);
  }

  const binary = atob(data.grid.walls);
  const walls = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    walls[i] = binary.charCodeAt(i);
  }

  return {
    entities,
    grid: { width: data.grid.width, height: data.grid.height, cellSize: data.grid.cellSize, walls },
    mapDefinition: data.mapDefinition,
    activeTeam: data.activeTeam,
    turnNumber: data.turnNumber,
    winner: data.winner,
    nextSpawnId: data.nextSpawnId ?? 0,
    actionCount: data.actionCount ?? 0,
  };
}
