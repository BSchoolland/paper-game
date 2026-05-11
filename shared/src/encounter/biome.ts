import type { UnitTemplate } from "../core/types.js";
import { ENEMY_TEMPLATES } from "../core/items.js";
import type { MapObjectCategory } from "../map/map-definition.js";

export interface StructureEntry {
  readonly name: string;
  readonly category: MapObjectCategory;
  readonly cost: number;
  readonly scale: number;
}

export interface Biome {
  readonly id: string;
  readonly name: string;
  readonly enemies: readonly UnitTemplate[];
  readonly structures: readonly StructureEntry[];
}

export const GREENLANDS_BIOME: Biome = {
  id: "greenlands",
  name: "Greenlands",
  enemies: Object.values(ENEMY_TEMPLATES),
  structures: [
    { name: "tree-oak-small", category: "decoration", cost: 1, scale: 0.35 },
    { name: "tree-oak-medium", category: "decoration", cost: 2, scale: 0.4 },
    { name: "tree-oak-large", category: "decoration", cost: 3, scale: 0.45 },
    { name: "tree-pine", category: "decoration", cost: 2, scale: 0.45 },
    { name: "bush-small", category: "decoration", cost: 1, scale: 0.3 },
    { name: "bush-medium", category: "decoration", cost: 1, scale: 0.35 },
    { name: "bush-large", category: "decoration", cost: 2, scale: 0.35 },
    { name: "grass-small", category: "decoration", cost: 1, scale: 0.25 },
    { name: "grass-medium", category: "decoration", cost: 1, scale: 0.25 },
    { name: "grass-large", category: "decoration", cost: 1, scale: 0.3 },
    { name: "rock-small", category: "decoration", cost: 1, scale: 0.25 },
    { name: "rock-medium", category: "decoration", cost: 2, scale: 0.3 },
    { name: "rock-large", category: "decoration", cost: 3, scale: 0.35 },
    { name: "rock-pile", category: "decoration", cost: 2, scale: 0.3 },
    { name: "ruins-rubble", category: "decoration", cost: 2, scale: 0.35 },
    { name: "stone-block", category: "wall", cost: 2, scale: 0.25 },
    { name: "stone-brick", category: "wall", cost: 2, scale: 0.25 },
    { name: "stone-pillar", category: "wall", cost: 3, scale: 0.3 },
    { name: "wall-corner", category: "wall", cost: 3, scale: 0.3 },
    { name: "wall-enclosure", category: "wall", cost: 4, scale: 0.35 },
    { name: "wall-long", category: "wall", cost: 3, scale: 0.3 },
    { name: "wall-medium", category: "wall", cost: 2, scale: 0.3 },
    { name: "wall-short", category: "wall", cost: 1, scale: 0.25 },
    { name: "wall-t-junction", category: "wall", cost: 3, scale: 0.3 },
    { name: "wall-u-shape", category: "wall", cost: 3, scale: 0.3 },
  ],
};
