import type { Entity, PassiveEffect, TeamId, UnitTemplate } from "../core/types.js";
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
  passives?: readonly PassiveEffect[],
): Entity {
  // Charge counters start full for every ability that declares `uses`.
  let abilityUses: Record<string, number> | undefined;
  for (const ability of template.abilities) {
    if (ability.uses === undefined) continue;
    abilityUses ??= {};
    abilityUses[ability.id] = ability.uses;
  }
  return {
    abilityUses,
    passives: passives && passives.length > 0 ? passives : undefined,
    id,
    name,
    position: { x, y },
    collisionRadius: template.collisionRadius,
    moveRadius: template.moveRadius,
    hp: template.hp,
    maxHp: template.hp,
    barrier: 0,
    teamId,
    energy: {
      // Template values are the per-turn income; the bank caps at `energyBankFactor` turns' worth
      // (default 2). Setting `energyBankFactor: 1` makes energy use-it-or-lose-it.
      // Entities start empty — they receive their first income at their first turn-start.
      red: 0,
      blue: 0,
      regenRed: template.energy.red,
      regenBlue: template.energy.blue,
      maxRed: template.energy.red * (template.energyBankFactor ?? 2),
      maxBlue: template.energy.blue * (template.energyBankFactor ?? 2),
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
