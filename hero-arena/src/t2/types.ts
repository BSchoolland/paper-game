import type { AbilityDefinition, UnitTemplate } from "../../../shared/src/index.js";
import type { HeroController } from "../types.js";

export type HeroRole = "tank" | "fighter" | "ranged";

export interface MultiFormatAgent {
  name: string;
  solo(abilities: AbilityDefinition[]): HeroController;
  squad: { tank: HeroController; fighter: HeroController; ranged: HeroController };
  boss: HeroController;
  raid: { tank: HeroController; fighter: HeroController; ranged: HeroController };
}

export interface TeamComposition {
  heroes: Array<{ id: string; role: string; template: UnitTemplate }>;
  scriptedAllies: Array<{ key: string; count: number; dim: number }>;
}

export interface ArenaConfig {
  seed: number;
  red: TeamComposition;
  blue: TeamComposition;
}

export interface EscalationResult {
  agentName: string;
  highestLevelCleared: number;
  totalTurns: number;
  log: string[];
}

export type MultiMatchOutcome = "red" | "blue" | "draw";

export interface MultiMatchResult {
  outcome: MultiMatchOutcome;
  red: string;
  blue: string;
  seed: number;
  turns: number;
  hpFrac: { red: number; blue: number };
  heroesAlive: { red: number; blue: number };
  log: string[];
}
