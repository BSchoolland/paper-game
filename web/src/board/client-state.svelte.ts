import type { AbilityDefinition, GameState, PlayerAction, Vec2, WireAction } from "shared";
import { canMyHeroAct, canUseAbility, getAbility, isMyEntity, isPlayerPhase, myHeroEntity } from "./combat-ui-state.js";
import type { IncomingAttackData, InteractionState } from "./combat-ui-state.js";
import { SeatContext, seatContext } from "./seat-context.js";
import { combat, onActionRejected, onSelfActed } from "../state/combat.svelte.js";
import { pass, sendAction, unpass } from "../state/actions.js";
import { socket } from "../net/client.js";

type Listener = () => void;

export interface IncomingAttack extends IncomingAttackData {
  /** "windup" = pre-window telegraph, "window" = press-now window. */
  phase: "windup" | "window";
  /** 0..1 progress within the current phase. */
  phaseProgress: number;
}

/**
 * The local combat interaction state machine (ported from the prototype — its semantics were
 * right). Fields are runes so the DOM HUD reacts directly; the imperative renderer stack keeps
 * the subscribe/notify channel. `submitting` locks re-entry of MY hero only.
 */
export class ClientState {
  private listeners: Listener[] = [];

  ui = $state<InteractionState>({ tag: "watching" });
  selectedEntityId = $state<string | null>(null);
  selectedAbilityId = $state<string | null>(null);
  showDebugWalls = $state(false);
  /** Frozen aim direction during timing phase. */
  timingAim: Vec2 | null = null;
  /** Incoming enemy attack being telegraphed for defensive timing (null = none). */
  incomingAttack = $state<IncomingAttack | null>(null);

  constructor(public seat: SeatContext = seatContext) {
    onSelfActed(() => this.clearSubmitLock());
    onActionRejected(() => this.clearSubmitLock());
  }

  get timingPower(): number | null {
    return this.ui.tag === "attackTiming" ? this.ui.power : null;
  }
  set timingPower(power: number | null) {
    if (this.ui.tag !== "attackTiming" || power === null) return;
    this.ui = { ...this.ui, power };
  }

  getState(): GameState | null {
    return combat.display;
  }

  submitAction(action: PlayerAction) {
    this.ui = { tag: "submitting", action };
    this.selectedAbilityId = null;
    this.notify();
    if (action.type === "endTurn") throw new Error("clients send pass/unpass, never endTurn");
    const seatId = this.seat.mySeatId;
    if (!seatId) throw new Error("submitAction with no bound seat");
    sendAction(seatId, action as WireAction);
  }

  canAcceptPlayerInput(): boolean {
    return canMyHeroAct(this.getState(), this.seat) && ["idle", "abilitySelected", "aiming"].includes(this.ui.tag);
  }

  canSelectAbility(abilityId: string): boolean {
    return this.canAcceptPlayerInput() && canUseAbility(this.getState(), this.selectedEntityId, abilityId, this.seat);
  }

  canPassTurn(): boolean {
    return this.canAcceptPlayerInput();
  }

  selectEntity(entityId: string | null) {
    if (!isPlayerPhase(this.getState(), this.seat)) return;
    this.selectedEntityId = entityId;
    this.selectedAbilityId = null;
    this.ui = { tag: "idle" };
    this.notify();
  }

  selectAbility(abilityId: string | null) {
    if (abilityId === null) {
      this.selectedAbilityId = null;
      this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "idle" } : { tag: "watching" };
      this.notify();
      return;
    }
    if (!this.selectedEntityId || !this.canSelectAbility(abilityId)) return;

    const ability = getAbility(this.getState(), this.selectedEntityId, abilityId);
    if (!ability) return;

    if (this.selectedAbilityId === abilityId && ability.kind === "barrier") {
      this.confirmAbility();
      return;
    }

    this.selectedAbilityId = abilityId;
    this.ui =
      ability.kind === "attack" || ability.kind === "zone"
        ? { tag: "aiming", entityId: this.selectedEntityId, abilityId }
        : { tag: "abilitySelected", entityId: this.selectedEntityId, abilityId };
    this.notify();
  }

  confirmAbility() {
    if (!this.selectedEntityId || !this.selectedAbilityId) return;
    if (!canUseAbility(this.getState(), this.selectedEntityId, this.selectedAbilityId, this.seat)) return;
    this.submitAction({ type: "ability", entityId: this.selectedEntityId, abilityId: this.selectedAbilityId });
  }

  beginAttackTiming(entityId: string, abilityId: string, aim: Vec2): boolean {
    const ability = getAbility(this.getState(), entityId, abilityId);
    if (!ability || ability.kind !== "attack") return false;
    if (!canUseAbility(this.getState(), entityId, abilityId, this.seat)) return false;
    this.selectedEntityId = entityId;
    this.selectedAbilityId = abilityId;
    this.timingAim = aim;
    this.ui = { tag: "attackTiming", entityId, abilityId, aim, power: 0 };
    this.notify();
    return true;
  }

  finishAttackTiming(power: number) {
    if (this.ui.tag !== "attackTiming") return null;
    const { entityId, abilityId, aim } = this.ui;
    this.timingAim = null;
    const action: PlayerAction = { type: "ability", entityId, abilityId, aimDirection: aim, power };
    this.submitAction(action);
    return action;
  }

  setDefensePrompt(promptId: string, input: IncomingAttackData, phase: "windup" | "window", progress: number) {
    this.selectedAbilityId = null;
    this.incomingAttack = { ...input, phase, phaseProgress: progress };
    this.ui = { tag: "defending", promptId, phase, progress, incoming: input };
    this.notify();
  }

  clearDefensePrompt() {
    this.incomingAttack = null;
    this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "idle" } : { tag: "watching" };
    this.notify();
  }

  getSelectedAbility(): AbilityDefinition | null {
    return getAbility(this.getState(), this.selectedEntityId, this.selectedAbilityId);
  }

  resetSelection() {
    this.selectedEntityId = null;
    this.selectedAbilityId = null;
    this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "idle" } : { tag: "watching" };
  }

  toggleDebugWalls() {
    this.showDebugWalls = !this.showDebugWalls;
    this.notify();
  }

  /** Release the submit lock without snapping the board. */
  clearSubmitLock() {
    if (this.ui.tag !== "submitting") return;
    this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "idle" } : { tag: "watching" };
    this.notify();
  }

  /** Toggle my hero's player-phase readiness: `pass` marks done, `unpass` reopens it. */
  setReady(ready: boolean) {
    if (ready) {
      pass();
      this.ui = { tag: "watching" };
      this.selectedAbilityId = null;
    } else {
      unpass();
      this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "idle" } : { tag: "watching" };
    }
    this.notify();
  }

  /** Abort the whole encounter for the party (host-only; server enforces). */
  resetEncounter() {
    socket().send({ type: "reset" });
    this.selectedEntityId = null;
    this.selectedAbilityId = null;
    this.timingAim = null;
    this.incomingAttack = null;
    this.ui = { tag: "watching" };
  }

  autoSelectMyHero() {
    const state = this.getState();
    const hero = myHeroEntity(state, this.seat);
    if (hero) this.selectedEntityId = hero.id;
    this.selectedAbilityId = null;
    this.ui = isPlayerPhase(state, this.seat) ? { tag: "idle" } : { tag: "watching" };
    this.notify();
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  notify() {
    for (const listener of this.listeners) listener();
  }

  /** Set ui only when the tag actually changes — reconcile runs inside effects, so identical
   *  rewrites must not create fresh state objects (that's an effect-loop). */
  private settleUi(tag: "idle" | "watching") {
    if (this.ui.tag !== tag) this.ui = { tag };
  }

  /** Called whenever a new display snapshot lands (BoardHost effect): drop stale selections. */
  reconcileWithGameState() {
    const state = this.getState();
    if (!state) return;
    if (state.winner) {
      this.selectedAbilityId = null;
      this.timingAim = null;
      this.incomingAttack = null;
      this.settleUi("watching");
      return;
    }
    if (this.incomingAttack) return;
    if (this.ui.tag === "attackTiming") {
      if (!canUseAbility(state, this.ui.entityId, this.ui.abilityId, this.seat)) {
        this.selectedAbilityId = null;
        this.timingAim = null;
        this.settleUi(isPlayerPhase(state, this.seat) ? "idle" : "watching");
      }
      return;
    }
    if (this.selectedEntityId) {
      const selected = state.entities.get(this.selectedEntityId);
      if (!selected || selected.dead || !isMyEntity(selected, this.seat)) this.selectedEntityId = null;
    }
    if (this.selectedAbilityId && !canUseAbility(state, this.selectedEntityId, this.selectedAbilityId, this.seat)) {
      this.selectedAbilityId = null;
      if (this.ui.tag === "aiming" || this.ui.tag === "abilitySelected") this.settleUi("idle");
    }
    if (!isPlayerPhase(state, this.seat)) {
      this.selectedAbilityId = null;
      this.settleUi("watching");
    } else if (this.ui.tag === "watching") {
      // `submitting` is NOT cleared here: in co-op a peer's snapshot must not release my lock.
      this.settleUi("idle");
    }
  }
}
