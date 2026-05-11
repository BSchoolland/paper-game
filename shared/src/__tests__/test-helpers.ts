import type { Entity, GameState } from "../core/types.js";
import { SHORT_SWORD_SLASH, INNATE_MOVE } from "../core/items.js";
import { createGrid } from "../map/collision-grid.js";

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
    barrier: 0,
    teamId,
    energy: { red: 2, blue: 2, maxRed: 2, maxBlue: 2 },
    abilities: [INNATE_MOVE, SHORT_SWORD_SLASH],
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
    mapDefinition: { seed: 0, objects: [] },
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
    ...overrides,
  };
}
