import { ShapeKind } from "../core/types.js";
import type { AttackAbility, Entity, GameState, MoveAbility } from "../core/types.js";
import { createGrid } from "../map/collision-grid.js";

const TEST_MOVE: MoveAbility = {
  id: "move",
  name: "Move",
  kind: "move",
  cost: { blue: 2 },
  variableCost: true,
  distance: 130,
};

const TEST_SLASH: AttackAbility = {
  id: "short-sword-slash",
  name: "Slash",
  kind: "attack",
  cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 3 },
  damage: 25,
  onHit: [{ type: "knockback", distance: 30 }],
  visual: { color: 0xc0c0c0, trailEffect: "slash", screenShake: 0.3 },
};

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
    abilities: [TEST_MOVE, TEST_SLASH],
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
    nextSpawnId: 0,
    actionCount: 0,
    ...overrides,
  };
}
