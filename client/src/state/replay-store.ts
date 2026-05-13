import type { GameState, GameEvent, PlayerAction, TeamId } from "shared";
import { deserializeGameState } from "shared/src/core/serialization.js";
import type { SerializedGameState } from "shared/src/core/serialization.js";
import type { GameStore } from "./game-store.js";

type Listener = () => void;
type EventListener = (events: readonly GameEvent[]) => void;

export interface ReplayFrame {
  serializedState: SerializedGameState;
  events: GameEvent[];
  turnNumber: number;
  team: TeamId;
}

/**
 * A read-only {@link GameStore} that plays back a pre-recorded battle log (see
 * `scripts/sim-battle.ts`). It drives the same `ClientState` / `GameRenderer` the live combat
 * screen uses; the only difference is that frames are advanced by the user (`step` / `playTurn`)
 * instead of arriving over the wire.
 */
export class ReplayStore implements GameStore {
  private frames: ReplayFrame[] = [];
  private cursor = 0;
  private state: GameState | null = null;
  private listeners: Listener[] = [];
  private eventListeners: EventListener[] = [];
  private animatingCheck: (() => boolean) | null = null;

  loadFrames(frames: ReplayFrame[]) {
    this.frames = frames;
    this.cursor = 0;
    this.state = frames[0] ? deserializeGameState(frames[0].serializedState) : null;
    this.notify();
  }

  setAnimatingCheck(fn: () => boolean) { this.animatingCheck = fn; }

  // --- GameStore -----------------------------------------------------------
  hasState(): boolean { return this.state !== null; }
  getState(): GameState | null { return this.state; }
  dispatch(_action: PlayerAction) { /* replays are read-only */ }
  reset() { this.jumpTo(0); }
  subscribe(l: Listener) { this.listeners.push(l); return () => { this.listeners = this.listeners.filter(x => x !== l); }; }

  subscribeEvents(l: EventListener) { this.eventListeners.push(l); return () => { this.eventListeners = this.eventListeners.filter(x => x !== l); }; }

  // --- playback ------------------------------------------------------------
  get position() { return this.cursor; }
  get total() { return this.frames.length; }
  get atEnd() { return this.cursor >= this.frames.length - 1; }
  current(): ReplayFrame | null { return this.frames[this.cursor] ?? null; }

  private show(index: number, replayEvents: boolean) {
    const frame = this.frames[index];
    if (!frame) return;
    this.cursor = index;
    this.state = deserializeGameState(frame.serializedState);
    if (replayEvents) for (const l of this.eventListeners) l(frame.events);
    this.notify();
  }

  /** Jump straight to a frame, skipping animations. */
  jumpTo(index: number) {
    if (!this.frames.length) return;
    this.show(Math.max(0, Math.min(index, this.frames.length - 1)), false);
  }

  /** Advance one frame (one AI action), animating its events. No-op while animating or at the end. */
  step(): boolean {
    if (this.atEnd) return false;
    if (this.animatingCheck?.()) return false;
    this.show(this.cursor + 1, true);
    return true;
  }

  /** Play forward through whole frames until the turn number changes, waiting for animations. */
  playTurn() {
    const startTurn = this.current()?.turnNumber;
    const advance = () => {
      if (this.atEnd) return;
      if (this.animatingCheck?.()) { requestAnimationFrame(advance); return; }
      this.show(this.cursor + 1, true);
      if (this.current()?.turnNumber === startTurn) requestAnimationFrame(advance);
    };
    advance();
  }

  private notify() { for (const l of this.listeners) l(); }
}
