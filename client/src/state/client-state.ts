import type { AbilityDefinition, AimDirection, AttackAbility, GameState, PlayerAction, Vec2 } from "shared";
import type { GameStore } from "./game-store.js";
import { canUseAbility, getAbility, isMyEntity, isPlayerPhase, myHeroEntity } from "./combat-ui-state.js";
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

  ui: InteractionState = { tag: "enemyTurn" };
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
    this.ui = { tag: "submittingAction", action };
    this.selectedAbilityId = null;
    this.notify();
    this.gameStore.dispatch(action);
  }

  canAcceptPlayerInput(): boolean {
    return isPlayerPhase(this.getState(), this.seat) && ["playerIdle", "abilitySelected", "aiming"].includes(this.ui.tag);
  }

  canSelectAbility(abilityId: string): boolean {
    return this.canAcceptPlayerInput() && canUseAbility(this.getState(), this.selectedEntityId, abilityId, this.seat);
  }

  canEndTurn(): boolean {
    return this.canAcceptPlayerInput();
  }

  selectEntity(entityId: string | null) {
    if (!isPlayerPhase(this.getState(), this.seat)) return;
    this.selectedEntityId = entityId;
    this.selectedAbilityId = null;
    this.ui = { tag: "playerIdle" };
    this.notify();
  }

  selectAbility(abilityId: string | null) {
    if (abilityId === null) {
      this.selectedAbilityId = null;
      this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "playerIdle" } : { tag: "enemyTurn" };
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

  setDefensePrompt(input: IncomingAttackData, phase: "windup" | "window", progress: number) {
    this.selectedAbilityId = null;
    this.incomingAttack = { ...input, phase, phaseProgress: progress };
    this.ui = { tag: "defensePrompt", phase, progress, incoming: input };
    this.notify();
  }

  clearDefensePrompt() {
    this.incomingAttack = null;
    this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "playerIdle" } : { tag: "enemyTurn" };
    this.notify();
  }

  getSelectedAbility(): AbilityDefinition | null {
    return getAbility(this.getState(), this.selectedEntityId, this.selectedAbilityId);
  }

  resetSelection() {
    this.selectedEntityId = null;
    this.selectedAbilityId = null;
    this.ui = isPlayerPhase(this.getState(), this.seat) ? { tag: "playerIdle" } : { tag: "enemyTurn" };
  }

  toggleDebugWalls() {
    this.showDebugWalls = !this.showDebugWalls;
    this.notify();
  }

  endTurn() {
    if (!this.canEndTurn()) return;
    const action: PlayerAction = { type: "endTurn" };
    this.submitAction(action);
  }

  autoSelectPlayer() {
    const state = this.getState();
    const player = myHeroEntity(state, this.seat);
    if (player) this.selectedEntityId = player.id;
    this.selectedAbilityId = null;
    this.ui = isPlayerPhase(state, this.seat) ? { tag: "playerIdle" } : { tag: "enemyTurn" };
    this.notify();
  }

  reset() {
    this.gameStore.reset();
    this.selectedEntityId = null;
    this.selectedAbilityId = null;
    this.timingAim = null;
    this.incomingAttack = null;
    this.ui = { tag: "enemyTurn" };
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
      this.ui = { tag: "enemyTurn" };
      return;
    }
    if (this.incomingAttack) return;
    if (this.ui.tag === "attackTiming") {
      if (!canUseAbility(state, this.ui.entityId, this.ui.abilityId, this.seat)) {
        this.selectedAbilityId = null;
        this.timingAim = null;
        this.ui = isPlayerPhase(state, this.seat) ? { tag: "playerIdle" } : { tag: "enemyTurn" };
      }
      return;
    }
    if (this.selectedEntityId) {
      const selected = state.entities.get(this.selectedEntityId);
      if (!selected || selected.dead || !isMyEntity(selected, this.seat)) this.selectedEntityId = null;
    }
    if (this.selectedAbilityId && !canUseAbility(state, this.selectedEntityId, this.selectedAbilityId, this.seat)) {
      this.selectedAbilityId = null;
      if (this.ui.tag === "aiming" || this.ui.tag === "abilitySelected") this.ui = { tag: "playerIdle" };
    }
    if (!isPlayerPhase(state, this.seat)) {
      this.selectedAbilityId = null;
      this.ui = { tag: "enemyTurn" };
    } else if (this.ui.tag === "enemyTurn" || this.ui.tag === "submittingAction") {
      this.ui = { tag: "playerIdle" };
    }
  }
}
