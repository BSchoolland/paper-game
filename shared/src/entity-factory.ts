import type { Entity, TeamId, UnitTemplate } from "./types.js";

export function makeEntity(
  id: string,
  name: string,
  x: number,
  y: number,
  teamId: TeamId,
  template: UnitTemplate
): Entity {
  return {
    id,
    name,
    position: { x, y },
    collisionRadius: template.collisionRadius,
    hp: template.hp,
    maxHp: template.hp,
    teamId,
    movementBudget: template.movementBudget,
    movementRemaining: template.movementBudget,
    actionsRemaining: 1,
    canMoveAfterAttack: template.canMoveAfterAttack,
    hasAttackedThisTurn: false,
    weapon: template.weapon,
    spriteType: template.spriteType,
  };
}
