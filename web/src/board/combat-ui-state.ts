import type { AbilityDefinition, AttackAbility, Entity, GameState, PlayerAction, Vec2 } from "shared";
import { abilityReady, canAffordAbility } from "shared";
import type { SeatContext } from "./seat-context.js";

/**
 * The local interaction state machine. `submitting` locks re-entry of MY hero only (other
 * players' heroes still animate in from snapshots); the renderer is never gated on it.
 * `defending` carries the server `promptId` so a stale defend round is matched and dropped.
 */
export type InteractionState =
  | { tag: "idle" }
  | { tag: "abilitySelected"; entityId: string; abilityId: string }
  | { tag: "aiming"; entityId: string; abilityId: string }
  | { tag: "attackTiming"; entityId: string; abilityId: string; aim: Vec2; power: number }
  | { tag: "defending"; promptId: string; phase: "windup" | "window"; progress: number; incoming: IncomingAttackData }
  | { tag: "submitting"; action: PlayerAction }
  | { tag: "watching" };

export interface IncomingAttackData {
  attackerId: string;
  attackerPosition: Vec2;
  aimDirection: Vec2;
  ability: AttackAbility;
}

// --- Seat-aware accessors ---
// Each answers an ownership / whose-phase question from the local player's point of view.
// A SeatContext is REQUIRED: ownership is read from `controllerId`, phase from `coopStatus`.

/** The hero this client controls. */
export function myHeroEntity(state: GameState | null, seat: SeatContext): Entity | null {
  if (!state) return null;
  const seatHeroId = seat.myHeroEntityId();
  if (!seatHeroId) return null;
  return state.entities.get(seatHeroId) ?? null;
}

/** Does this client control `entity`? (Ownership is `controllerId === mySeatId`.) */
export function isMyEntity(entity: Entity | null | undefined, seat: SeatContext): boolean {
  if (!entity) return false;
  return !!seat.mySeatId && entity.controllerId === seat.mySeatId;
}

/** Is it currently the player side's phase (and the game isn't over)? (Reads `coopStatus`.) */
export function isPlayerPhase(state: GameState | null, seat: SeatContext): boolean {
  if (!state || state.winner) return false;
  return seat.coopPhase() === "player";
}

/** Can my own hero still take an action this player phase (alive, not passed/exhausted)? */
export function canMyHeroAct(state: GameState | null, seat: SeatContext): boolean {
  if (!isPlayerPhase(state, seat)) return false;
  const hero = myHeroEntity(state, seat);
  if (!hero || hero.dead) return false;
  const mySeat = seat.mySeat();
  if (mySeat && (mySeat.ready || mySeat.exhausted)) return false;
  return true;
}

export function canUseAbility(
  state: GameState | null,
  entityId: string | null,
  abilityId: string | null,
  seat: SeatContext,
): boolean {
  if (!isPlayerPhase(state, seat) || !entityId || !abilityId) return false;
  const entity = state!.entities.get(entityId);
  if (!entity || entity.dead || !isMyEntity(entity, seat)) return false;
  const ability = entity.abilities.find((a) => a.id === abilityId);
  return !!ability && canAffordAbility(entity, ability) && abilityReady(entity, ability);
}

export function getAbility(state: GameState | null, entityId: string | null, abilityId: string | null): AbilityDefinition | null {
  if (!state || !entityId || !abilityId) return null;
  return state.entities.get(entityId)?.abilities.find((a) => a.id === abilityId) ?? null;
}
