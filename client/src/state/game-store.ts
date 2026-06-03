import type { GameState, PlayerAction } from "shared";

export type Listener = () => void;

export interface GameStore {
  getState(): GameState | null;
  dispatch(action: PlayerAction): void;
  /** Mark my hero done for this player phase (server-side `pass`). Read-only stores no-op. */
  pass(): void;
  /** Re-open my hero in the player phase (server-side `unpass`). Read-only stores no-op. */
  unpass(): void;
  reset(): void;
  subscribe(listener: Listener): () => void;
}
