import type { UnitTemplate } from "../core/types.js";

export interface StructureEntry {
  readonly name: string;
  readonly index: number;
  readonly cost: number;
  readonly scale: number;
  readonly spritePath?: string;
}

export interface Dimension {
  readonly id: string;
  readonly name: string;
  readonly backgroundPath: string | null;
  readonly hexDecorationsPath: string | null;
  readonly enemies: readonly UnitTemplate[];
  readonly structures: readonly StructureEntry[];
}
