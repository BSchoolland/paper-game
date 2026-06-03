import type { AbilityDefinition, AttackAbility, Entity, GameState, PlayerAction, Vec2 } from "shared";
import { canAffordAbility } from "shared";

export type InteractionState =
  | { tag: "playerIdle" }
  | { tag: "abilitySelected"; entityId: string; abilityId: string }
  | { tag: "aiming"; entityId: string; abilityId: string }
  | { tag: "attackTiming"; entityId: string; abilityId: string; aim: Vec2; power: number }
  | { tag: "defensePrompt"; phase: "windup" | "window"; progress: number; incoming: IncomingAttackData }
  | { tag: "submittingAction"; action: PlayerAction }
  | { tag: "enemyTurn" };

export interface IncomingAttackData {
  attackerId: string;
  attackerPosition: Vec2;
  aimDirection: Vec2;
  ability: AttackAbility;
}

export function playerEntity(state: GameState | null): Entity | null {
  if (!state) return null;
  return [...state.entities.values()].find(e => e.teamId === "red" && !e.dead) ?? null;
}

export function isPlayerTurn(state: GameState | null): boolean {
  return !!state && !state.winner && state.activeTeam === "red";
}

export function canUseAbility(state: GameState | null, entityId: string | null, abilityId: string | null): boolean {
  if (!isPlayerTurn(state) || !entityId || !abilityId) return false;
  const entity = state!.entities.get(entityId);
  if (!entity || entity.dead || entity.teamId !== state!.activeTeam) return false;
  const ability = entity.abilities.find(a => a.id === abilityId);
  return !!ability && canAffordAbility(entity, ability);
}

export function getAbility(state: GameState | null, entityId: string | null, abilityId: string | null): AbilityDefinition | null {
  if (!state || !entityId || !abilityId) return null;
  return state.entities.get(entityId)?.abilities.find(a => a.id === abilityId) ?? null;
}
