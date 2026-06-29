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
  readonly status: string;
  readonly enemies: readonly UnitTemplate[];
  readonly structures: readonly StructureEntry[];
  /** Pre-generated encounter maps, by encounter type. When present for a type,
   *  the encounter uses a single-image map instead of rolling/placing structures. */
  readonly maps?: Record<string, readonly string[]>;
  /** Collision masks parallel to `maps` (same keys/order). */
  readonly masks?: Record<string, readonly string[]>;
}
