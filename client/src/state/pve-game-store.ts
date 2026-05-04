import type { GameState, PlayerAction } from "shared";
import { AiController } from "shared";
import type { GameStore, PendingAttack } from "./game-store.js";
import { LocalGameStore, ATTACK_DELAY_MS } from "./game-store.js";

type Listener = () => void;

export class PveGameStore implements GameStore {
  private store: LocalGameStore;
  private listeners: Listener[] = [];
  private _aiActing = false;
  private readonly aiTeam: "red" | "blue";
  private _isAnimating: (() => boolean) | null = null;
  private aiController = new AiController();

  get aiActing(): boolean {
    return this._aiActing;
  }

  get pendingAttack(): PendingAttack | null {
    return this.store.pendingAttack;
  }

  constructor(initialState: GameState, aiTeam: "red" | "blue" = "blue") {
    this.store = new LocalGameStore(initialState);
    this.aiTeam = aiTeam;
    this.store.subscribe(() => this.notify());
  }

  setAnimatingCheck(fn: () => boolean) {
    this._isAnimating = fn;
  }

  getState(): GameState {
    return this.store.getState();
  }

  dispatch(action: PlayerAction) {
    if (this._aiActing) return;

    const state = this.store.getState();
    if (state.activeTeam === this.aiTeam) return;

    this.store.dispatch(action);

    if (action.type === "endTurn" && !this.store.getState().winner) {
      this.runAiTurn();
    }
  }

  reset() {
    this._aiActing = false;
    this.store.reset();
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private waitForAnimations(): Promise<void> {
    if (!this._isAnimating) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (!this._isAnimating || !this._isAnimating()) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    });
  }

  private runAiTurn() {
    const actions = this.aiController.computeActions(this.store.getState(), this.aiTeam);

    this._aiActing = true;
    this.notify();

    let idx = 0;
    const step = async () => {
      if (idx >= actions.length) {
        this._aiActing = false;
        this.notify();
        return;
      }
      const action = actions[idx]!;
      this.store.dispatch(action);
      idx++;

      await this.waitForAnimations();

      const nextAction = idx < actions.length ? actions[idx] : null;
      if (action.type === "move" && nextAction?.type === "attack") {
        await new Promise((r) => setTimeout(r, 200));
      }

      setTimeout(step, 50);
    };
    setTimeout(step, 400);
  }
}
