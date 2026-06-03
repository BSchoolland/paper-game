import type { Entity, GridState, ItemDefinition, AttachmentData, Vec2 } from "shared";
import { UNIT_TEMPLATES, PLAYER_INNATE_ABILITIES, makeEntity, findWalkablePosition, getItemAbilities } from "shared";
import { createCombatGrid } from "shared";
import type { GeneratedEncounter } from "shared";
import type { MapDefinition } from "shared";
import type { SeatBuildSpec } from "./room.js";

export interface EncounterMap {
  readonly grid: GridState;
  readonly mapDefinition: MapDefinition;
}

export function buildEncounterMap(encounter: GeneratedEncounter): EncounterMap {
  const grid = createCombatGrid();
  const m = encounter.map;
  const mapDefinition: MapDefinition = m.kind === "image"
    ? { seed: 0, objects: [], mapImage: m.mapImage, maskImage: m.maskImage }
    : { seed: 0, objects: m.structures };
  return { grid, mapDefinition };
}

/**
 * Build the combat entities for a party: one red hero per seat (built from that seat's loadout)
 * plus the encounter's blue enemies. Each hero's `controllerId` is stamped via spread (ruling
 * R24) so makeEntity's many call sites stay untouched; item abilities are derived from the seat's
 * equipped items exactly as the live game does.
 */
export function placeEncounterEntities(
  encounter: GeneratedEncounter,
  grid: GridState,
  seats: readonly SeatBuildSpec[],
): Map<string, Entity> {
  const entities = new Map<string, Entity>();

  const formation = playerFormation(seats.length);
  seats.forEach((seat, i) => {
    const itemAbilities = getItemAbilities(seat.equipped);
    const hasItemAttack = itemAbilities.some((a) => a.kind === "attack");
    const innate = hasItemAttack
      ? PLAYER_INNATE_ABILITIES.filter((a) => a.id !== "punch")
      : [...PLAYER_INNATE_ABILITIES];
    const template = { ...UNIT_TEMPLATES.player, abilities: [...innate, ...itemAbilities] };
    const spawn = formation[i]!;
    const hero = placeEntity(seat.heroEntityId, "Player", spawn.x, spawn.y, "red", template, grid, seat.equipped, seat.attachments);
    entities.set(seat.heroEntityId, { ...hero, playerAnimSet: seat.animSet, controllerId: seat.controllerId });
  });

  for (let i = 0; i < encounter.enemies.length; i++) {
    const template = encounter.enemies[i]!;
    entities.set(`enemy${i + 1}`, placeEntity(`enemy${i + 1}`, template.className, 500 + Math.floor(i / 4) * 66 + (i % 2) * 30, 150 + (i % 4) * 87, "blue", template, grid));
  }

  return entities;
}

/** Staggered column of spawn points near the left edge, centred vertically. */
function playerFormation(n: number): Vec2[] {
  const baseX = 120;
  const baseY = 300;
  const spacing = 72;
  const positions: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    positions.push({ x: baseX + (i % 2) * 48, y: baseY + Math.round((i - (n - 1) / 2) * spacing) });
  }
  return positions;
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
