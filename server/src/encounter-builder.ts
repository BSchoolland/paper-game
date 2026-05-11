import type { AbilityDefinition, AnimSet, Entity, GameState, GridState, ItemDefinition, AttachmentData } from "shared";
import { UNIT_TEMPLATES, PLAYER_INNATE_ABILITIES, makeEntity, findWalkablePosition } from "shared";
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
  itemAbilities?: readonly AbilityDefinition[],
  animSet?: AnimSet,
  equipped?: readonly ItemDefinition[],
  attachments?: Record<string, AttachmentData>,
): Map<string, Entity> {
  const entities = new Map<string, Entity>();
  const spriteType = animSet ? `char1-${animSet}` : "char1-sword";
  const allAbilities = [...PLAYER_INNATE_ABILITIES, ...(itemAbilities ?? [])];
  const playerTemplate = { ...UNIT_TEMPLATES.player, abilities: allAbilities, spriteType };

  entities.set("red1", placeEntity("red1", "Player", 120, 300, "red", playerTemplate, grid, equipped, attachments));

  const enemyStartX = 500;
  const enemySpreadX = 200;
  const enemyStartY = 150;
  const enemySpreadY = 350;

  for (let i = 0; i < encounter.enemies.length; i++) {
    const template = encounter.enemies[i]!;
    const attackAbility = template.abilities.find(a => a.kind === "attack");
    console.log(`[encounter] enemy${i + 1}: class=${template.className} sprite=${template.spriteType} hp=${template.hp} attack=${attackAbility?.id ?? "none"}`);
    entities.set(`enemy${i + 1}`, placeEntity(`enemy${i + 1}`, template.className, 500 + Math.floor(i / 4) * 66 + (i % 2) * 30, 150 + (i % 4) * 87, "blue", template, grid));
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
