import type { AbilityDefinition, GameState, PlayerAction, Vec2 } from "shared";
import type { GameStore } from "./game-store.js";
import { canMyHeroAct, canUseAbility, getAbility, isMyEntity, isPlayerPhase, myHeroEntity } from "./combat-ui-state.js";
import type { IncomingAttackData, InteractionState } from "./combat-ui-state.js";
import { SeatContext } from "./seat-context.js";

type Listener = () => void;

export interface IncomingAttack extends IncomingAttackData {
  /** "windup" = pre-window telegraph, "window" = press-now window. */
  phase: "windup" | "window";
  /** 0..1 progress within the current phase. */
  phaseProgress: number;
}

export class ClientState {
  private listeners: Listener[] = [];

  ui: InteractionState = { tag: "watching" };
  selectedEntityId: string | null = null;
  selectedAbilityId: string | null = null;
  showDebugWalls = false;
  /** Frozen aim direction during timing phase. */
  timingAim: { x: number; y: number } | null = null;
  /** Incoming enemy attack being telegraphed for defensive timing (null = none). */
  incomingAttack: IncomingAttack | null = null;

  constructor(private gameStore: GameStore, public seat: SeatContext = new SeatContext()) {
    gameStore.subscribe(() => {
      this.reconcileWithGameState();
      this.notify();
    });
  }

  get timingPower(): number | null {
    return this.ui.tag === "attackTiming" ? this.ui.power : null;
  }
  set timingPower(power: number | null) {
    if (this.ui.tag !== "attackTiming" || power === null) return;
    this.ui = { ...this.ui, power };
  }

  getState(): GameState | null {
    return this.gameStore.getState();
  }

  dispatch(action: PlayerAction) {
    this.gameStore.dispatch(action);
  }

  submitAction(action: PlayerAction) {
    this.ui = { tag: "submitting", action };
    this.selectedAbilityId = null;
    this.notify();
    this.gameStore.dispatch(action);
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
    this.ui = ability.kind === "attack" || ability.kind === "zone"
      ? { tag: "aiming", entityId: this.selectedEntityId, abilityId }
      : { tag: "abilitySelected", entityId: this.selectedEntityId, abilityId };
    this.notify();
  }

  confirmAbility() {
    if (!this.selectedEntityId || !this.selectedAbilityId) return;
    if (!canUseAbility(this.getState(), this.selectedEntityId, this.selectedAbilityId, this.seat)) return;
    const action: PlayerAction = {
      type: "ability",
      entityId: this.selectedEntityId,
      abilityId: this.selectedAbilityId,
    };
    this.submitAction(action);
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

  /** Release the submit lock without snapping the board (on actionRejected for my seat, or my own
   * action resolving in a snapshot). */
  clearSubmitLock() {
    if (this.ui.tag !== "submitting") return;
    this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "idle" } : { tag: "watching" };
    this.notify();
  }

  /** Mark my hero as done for the player phase (server-side `pass`). */
  passTurn() {
    if (!this.canPassTurn()) return;
    this.gameStore.pass();
    this.ui = { tag: "watching" };
    this.selectedAbilityId = null;
    this.notify();
  }

  /** Toggle my hero's player-phase readiness: `pass` marks done, `unpass` reopens it. */
  setReady(ready: boolean) {
    if (ready) {
      this.gameStore.pass();
      this.ui = { tag: "watching" };
      this.selectedAbilityId = null;
    } else {
      this.gameStore.unpass();
      this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "idle" } : { tag: "watching" };
    }
    this.notify();
  }

  autoSelectMyHero() {
    const state = this.getState();
    const hero = myHeroEntity(state, this.seat);
    if (hero) this.selectedEntityId = hero.id;
    this.selectedAbilityId = null;
    this.ui = isPlayerPhase(state, this.seat) ? { tag: "idle" } : { tag: "watching" };
    this.notify();
  }

  reset() {
    this.gameStore.reset();
    this.selectedEntityId = null;
    this.selectedAbilityId = null;
    this.timingAim = null;
    this.incomingAttack = null;
    this.ui = { tag: "watching" };
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

  private reconcileWithGameState() {
    const state = this.getState();
    if (!state) return;
    if (state.winner) {
      this.selectedAbilityId = null;
      this.timingAim = null;
      this.incomingAttack = null;
      this.ui = { tag: "watching" };
      return;
    }
    if (this.incomingAttack) return;
    if (this.ui.tag === "attackTiming") {
      if (!canUseAbility(state, this.ui.entityId, this.ui.abilityId, this.seat)) {
        this.selectedAbilityId = null;
        this.timingAim = null;
        this.ui = isPlayerPhase(state, this.seat) ? { tag: "idle" } : { tag: "watching" };
      }
      return;
    }
    if (this.selectedEntityId) {
      const selected = state.entities.get(this.selectedEntityId);
      if (!selected || selected.dead || !isMyEntity(selected, this.seat)) this.selectedEntityId = null;
    }
    if (this.selectedAbilityId && !canUseAbility(state, this.selectedEntityId, this.selectedAbilityId, this.seat)) {
      this.selectedAbilityId = null;
      if (this.ui.tag === "aiming" || this.ui.tag === "abilitySelected") this.ui = { tag: "idle" };
    }
    if (!isPlayerPhase(state, this.seat)) {
      this.selectedAbilityId = null;
      this.ui = { tag: "watching" };
    } else if (this.ui.tag === "watching") {
      // `submitting` is NOT cleared here: in co-op a peer's snapshot must not release my lock.
      // It clears on my own action resolving (clearSubmitLock via subscribeSelfActed) or on
      // actionRejected for my seat.
      this.ui = { tag: "idle" };
    }
  }
}
