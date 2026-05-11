import type { UnitTemplate } from "../core/types.js";
import type { MapObjectCategory } from "../map/map-definition.js";

export interface StructureEntry {
  readonly name: string;
  readonly category: MapObjectCategory;
  readonly cost: number;
  readonly scale: number;
}

export interface Dimension {
  readonly id: string;
  readonly name: string;
  readonly enemies: readonly UnitTemplate[];
  readonly structures: readonly StructureEntry[];
}
