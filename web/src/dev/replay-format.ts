import type { GameEvent, SerializedGameState, TeamId } from "shared";

/** One frame per resolved action, as written by scripts/sim-battle.ts and the hero-arena presets. */
export interface ReplayFrame {
  serializedState: SerializedGameState;
  events: GameEvent[];
  turnNumber: number;
  team: TeamId;
}

export interface ReplayLog {
  seed: number;
  /** Dimension ids whose sprite sheets the fight uses. */
  dimensions: number[];
  frames: ReplayFrame[];
}

export interface ReplayListEntry {
  name: string;
  mtimeMs: number;
  size: number;
}
