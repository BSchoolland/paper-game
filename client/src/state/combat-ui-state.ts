import type { AbilityDefinition, AttackAbility, Entity, GameState, PlayerAction, Vec2 } from "shared";
import { canAffordAbility } from "shared";
import type { SeatContext } from "./seat-context.js";

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

// --- Seat-aware accessors ---
// Each answers an ownership / whose-phase question from the local player's point of view.
// When no seat context is bound (single-seat play, before the Phase 7 client rewrite),
// they fall back to the legacy "red == the lone player" behaviour. The remaining `"red"`
// literals below are exactly those fallbacks and nothing else.

/** The hero this client controls. Seat-aware via the room roster; falls back to the lone
 *  living red hero in single-seat play. */
export function myHeroEntity(state: GameState | null, seat?: SeatContext | null): Entity | null {
  if (!state) return null;
  const seatHeroId = seat?.myHeroEntityId() ?? null;
  if (seatHeroId) return state.entities.get(seatHeroId) ?? null;
  return [...state.entities.values()].find((e) => e.teamId === "red" && !e.dead) ?? null;
}

/** Does this client control `entity`? Seat-aware via `controllerId`; falls back to "on the
 *  red player party" in single-seat play. */
export function isMyEntity(entity: Entity | null | undefined, seat?: SeatContext | null): boolean {
  if (!entity) return false;
  const mySeatId = seat?.mySeatId ?? null;
  if (mySeatId) return entity.controllerId === mySeatId;
  return entity.teamId === "red";
}

/** Is it currently the player side's phase (and the game isn't over)? Seat-aware via
 *  coopStatus; falls back to `activeTeam === "red"`. */
export function isPlayerPhase(state: GameState | null, seat?: SeatContext | null): boolean {
  if (!state || state.winner) return false;
  const phase = seat?.coopPhase() ?? null;
  if (phase) return phase === "player";
  return state.activeTeam === "red";
}

/** Can my own hero still take an action this player phase (alive, not passed/exhausted)? */
export function canMyHeroAct(state: GameState | null, seat?: SeatContext | null): boolean {
  if (!isPlayerPhase(state, seat)) return false;
  const hero = myHeroEntity(state, seat);
  if (!hero || hero.dead) return false;
  const mySeat = seat?.mySeat() ?? null;
  if (mySeat && (mySeat.ready || mySeat.exhausted)) return false;
  return true;
}

// --- Back-compat thin wrappers (single-seat). Removed in Phase 8 once every caller passes
//     a real SeatContext. ---
export function playerEntity(state: GameState | null): Entity | null {
  return myHeroEntity(state, null);
}

export function isPlayerTurn(state: GameState | null): boolean {
  return isPlayerPhase(state, null);
}

export function canUseAbility(
  state: GameState | null,
  entityId: string | null,
  abilityId: string | null,
  seat?: SeatContext | null,
): boolean {
  if (!isPlayerPhase(state, seat) || !entityId || !abilityId) return false;
  const entity = state!.entities.get(entityId);
  if (!entity || entity.dead || !isMyEntity(entity, seat)) return false;
  const ability = entity.abilities.find((a) => a.id === abilityId);
  return !!ability && canAffordAbility(entity, ability);
}

export function getAbility(state: GameState | null, entityId: string | null, abilityId: string | null): AbilityDefinition | null {
  if (!state || !entityId || !abilityId) return null;
  return state.entities.get(entityId)?.abilities.find(a => a.id === abilityId) ?? null;
}
