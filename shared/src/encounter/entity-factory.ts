import type { Entity, TeamId, UnitTemplate } from "../core/types.js";
import type { ItemDefinition } from "../core/items.js";
import type { AttachmentData } from "../core/inventory.js";

export function makeEntity(
  id: string,
  name: string,
  x: number,
  y: number,
  teamId: TeamId,
  template: UnitTemplate,
  equipped?: readonly ItemDefinition[],
  attachments?: Record<string, AttachmentData>,
): Entity {
  return {
    id,
    name,
    position: { x, y },
    collisionRadius: template.collisionRadius,
    hp: template.hp,
    maxHp: template.hp,
    barrier: 0,
    teamId,
    energy: {
      // Template values are the per-turn income; the bank caps at two turns' worth.
      // Entities start empty — they receive their first income at their first turn-start.
      red: 0,
      blue: 0,
      regenRed: template.energy.red,
      regenBlue: template.energy.blue,
      maxRed: template.energy.red * 2,
      maxBlue: template.energy.blue * 2,
    },
    abilities: template.abilities,
    sprites: template.sprites,
    spriteScale: template.spriteScale,
    heightMeters: template.heightMeters,
    strategy: template.strategy,
    effects: template.effects,
    equipped,
    attachments,
  };
}
