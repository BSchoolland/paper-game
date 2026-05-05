import type { Entity, GameState } from "shared";
import { UNIT_TEMPLATES, makeEntity } from "shared";
import { createCombatGrid } from "shared";
import type { GeneratedEncounter } from "shared";
import type { MapDefinition } from "shared";

export function createEncounterGameState(encounter: GeneratedEncounter): GameState {
  const grid = createCombatGrid();

  const entities = new Map<string, Entity>();
  const { warrior, spearman, archer } = UNIT_TEMPLATES;

  entities.set("red1", makeEntity("red1", "Warrior", 120, 200, "red", warrior));
  entities.set("red2", makeEntity("red2", "Spearman", 120, 300, "red", spearman));
  entities.set("red3", makeEntity("red3", "Archer", 100, 400, "red", archer));

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
    entities.set(id, makeEntity(id, template.className, x, y, "blue", template));
  }

  const mapDefinition: MapDefinition = {
    seed: 0,
    objects: encounter.structures,
  };

  return {
    entities,
    grid,
    mapDefinition,
    activeTeam: "red",
    turnNumber: 1,
    winner: null,
  };
}
