import type { AnimSet, Entity, GameState, GridState, WeaponDefinition, ItemDefinition, AttachmentData } from "shared";
import { UNIT_TEMPLATES, makeEntity, findWalkablePosition } from "shared";
import { createCombatGrid } from "shared";
import type { GeneratedEncounter } from "shared";
import type { MapDefinition } from "shared";

export interface EncounterMap {
  readonly grid: GridState;
  readonly mapDefinition: MapDefinition;
}

export function buildEncounterMap(encounter: GeneratedEncounter): EncounterMap {
  const grid = createCombatGrid();
  const mapDefinition: MapDefinition = {
    seed: 0,
    objects: encounter.structures,
  };
  return { grid, mapDefinition };
}

export function placeEncounterEntities(
  encounter: GeneratedEncounter,
  grid: GridState,
  equippedWeapon?: WeaponDefinition,
  animSet?: AnimSet,
  equipped?: readonly ItemDefinition[],
  attachments?: Record<string, AttachmentData>,
): Map<string, Entity> {
  const entities = new Map<string, Entity>();
  const spriteType = animSet ? `char1-${animSet}` : "char1-sword";
  const playerTemplate = equippedWeapon
    ? { ...UNIT_TEMPLATES.player, weapon: equippedWeapon, spriteType }
    : { ...UNIT_TEMPLATES.player, spriteType };

  entities.set("red1", placeEntity("red1", "Player", 120, 300, "red", playerTemplate, grid, equipped, attachments));

  const enemyStartX = 500;
  const enemySpreadX = 200;
  const enemyStartY = 150;
  const enemySpreadY = 350;

  for (let i = 0; i < encounter.enemies.length; i++) {
    const template = encounter.enemies[i]!;
    const col = Math.floor(i / 4);
    const row = i % 4;
    const x = enemyStartX + col * (enemySpreadX / 3) + (row % 2) * 30;
    const y = enemyStartY + row * (enemySpreadY / 4);
    const id = `enemy${i + 1}`;
    console.log(`[encounter] ${id}: class=${template.className} sprite=${template.spriteType} hp=${template.hp} weapon=${template.weapon.id} shape=${template.weapon.shape.kind}`);
    entities.set(id, placeEntity(id, template.className, x, y, "blue", template, grid));
  }

  return entities;
}

function placeEntity(
  id: string,
  name: string,
  x: number,
  y: number,
  teamId: "red" | "blue",
  template: Parameters<typeof makeEntity>[5],
  grid: GridState,
  equipped?: readonly ItemDefinition[],
  attachments?: Record<string, AttachmentData>,
): Entity {
  const pos = findWalkablePosition(grid, { x, y }, template.collisionRadius);
  return makeEntity(id, name, pos.x, pos.y, teamId, template, equipped, attachments);
}

export function assembleGameState(map: EncounterMap, entities: Map<string, Entity>): GameState {
  return {
    entities,
    grid: map.grid,
    mapDefinition: map.mapDefinition,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}
