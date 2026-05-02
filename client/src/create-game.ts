import type { GameState, Entity } from "shared";
import { ENTITY_DEFAULTS, createTestMap } from "shared";

function makeEntity(
  id: string,
  x: number,
  y: number,
  team: "red" | "blue"
): Entity {
  return {
    id,
    position: { x, y },
    collisionRadius: ENTITY_DEFAULTS.collisionRadius,
    hp: ENTITY_DEFAULTS.hp,
    maxHp: ENTITY_DEFAULTS.hp,
    team,
    movementBudget: ENTITY_DEFAULTS.movementBudget,
    movementRemaining: ENTITY_DEFAULTS.movementBudget,
    actionsRemaining: ENTITY_DEFAULTS.actionsPerTurn,
    canMoveAfterAttack: ENTITY_DEFAULTS.canMoveAfterAttack,
    hasAttackedThisTurn: false,
  };
}

export function createInitialGameState(): GameState {
  const grid = createTestMap();
  const entities = new Map<string, Entity>();

  entities.set("red1", makeEntity("red1", 200, 300, "red"));
  entities.set("red2", makeEntity("red2", 200, 500, "red"));
  entities.set("blue1", makeEntity("blue1", 1000, 300, "blue"));
  entities.set("blue2", makeEntity("blue2", 1000, 500, "blue"));

  return {
    entities,
    grid,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}
