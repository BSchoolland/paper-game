import type { AbilityDefinition, AttackAbility, Entity, GameState, PlayerAction, Vec2 } from "shared";
import { canAffordAbility, entitiesInShape, entityHasAffordableAction, powerToMultiplier, scaleAttack, sub } from "shared";
import type { SeatContext } from "./seat-context.js";

/**
 * The local interaction state machine — only what the player DID (selections, aiming, timing,
 * the submit lock). Whether input is open at all is derived from coopStatus + the snapshot
 * (`canMyHeroAct`), never stored here. `submitting` locks re-entry of MY hero only (other
 * players' heroes still animate in from snapshots); the renderer is never gated on it.
 * `defending` carries the server `promptId` so a stale defend round is matched and dropped.
 */
export type InteractionState =
  | { tag: "idle" }
  | { tag: "abilitySelected"; entityId: string; abilityId: string }
  | { tag: "aiming"; entityId: string; abilityId: string }
  | { tag: "attackTiming"; entityId: string; abilityId: string; aim: Vec2; power: number }
  | { tag: "defending"; promptId: string; phase: "windup" | "window"; progress: number; incoming: IncomingAttackData }
  | { tag: "submitting"; action: PlayerAction };

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

/** True for abilities that resolve on the caster alone — no aim, no destination. */
export function isSelfCastAbility(ability: AbilityDefinition): boolean {
  return ability.kind === "barrier" || ability.kind === "restore" || ability.kind === "convert";
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
  if (!ability || !canAffordAbility(entity, ability)) return false;
  // Spent per-encounter charges stay unusable even if energy would cover them.
  if (ability.uses !== undefined) {
    const left = entity.abilityUses?.[ability.id] ?? ability.uses;
    if (left <= 0) return false;
  }
  return true;
}

export function getAbility(state: GameState | null, entityId: string | null, abilityId: string | null): AbilityDefinition | null {
  if (!state || !entityId || !abilityId) return null;
  return state.entities.get(entityId)?.abilities.find((a) => a.id === abilityId) ?? null;
}

/**
 * True when ending the turn is the only sensible play for my hero: nothing is affordable at
 * all, or there's no move left and no affordable attack can reach any living enemy even at
 * perfect (crit) power. Drives the END TURN button highlight.
 */
export function shouldSuggestEndTurn(state: GameState | null, seat: SeatContext): boolean {
  if (!canMyHeroAct(state, seat)) return false;
  const hero = myHeroEntity(state, seat)!;
  if (!entityHasAffordableAction(hero)) return true;

  const move = hero.abilities.find((a) => a.kind === "move");
  if (move && canAffordAbility(hero, move)) return false;

  const critMult = powerToMultiplier(1);
  const enemies = [...state!.entities.values()].filter((e) => e.teamId !== hero.teamId && !e.dead);
  for (const ability of hero.abilities) {
    if (ability.kind !== "attack" || !canAffordAbility(hero, ability)) continue;
    const crit = scaleAttack(ability, critMult);
    for (const enemy of enemies) {
      const aim = sub(enemy.position, hero.position);
      const hits = entitiesInShape(hero.position, aim, crit.shape, state!.entities, state!.grid, hero.id, crit.ignoreCoverRange);
      if (hits.some((h) => h.id === enemy.id)) return false;
    }
  }
  return true;
}
