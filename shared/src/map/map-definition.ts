import type { Vec2 } from "../core/types.js";
import { Rng } from "../core/rng.js";

export interface MapObjectPlacement {
  readonly name: string;
  readonly position: Vec2;
  readonly scale: number;
}

export interface MapDefinition {
  readonly seed: number;
  readonly objects: readonly MapObjectPlacement[];
  /** Per-encounter background image (public path). When set, the client renders
   *  this single image instead of compositing `objects`. */
  readonly mapImage?: string;
  /** Collision mask image (public path). Server-side use only. */
  readonly maskImage?: string;
}

export interface PlaceableObject {
  readonly name: string;
  readonly scale: number;
}

export function placeObjects(
  objects: readonly PlaceableObject[],
  worldWidth: number,
  worldHeight: number,
  rng: Rng,
  margin = 40,
  minDist = 50
): MapObjectPlacement[] {
  const placed: { x: number; y: number; r: number }[] = [];
  const result: MapObjectPlacement[] = [];

  for (const obj of objects) {
    let x: number, y: number;
    let attempts = 0;

    do {
      x = margin + rng.next() * (worldWidth - margin * 2);
      y = margin + rng.next() * (worldHeight - margin * 2);
      attempts++;
    } while (
      attempts < 30 &&
      placed.some(
        (p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (minDist + p.r) ** 2
      )
    );

    result.push({ name: obj.name, position: { x, y }, scale: obj.scale });
    placed.push({ x, y, r: obj.scale * 30 });
  }

  return result;
}

const DECORATION_OBJECTS = [
  "tree-oak-small",
  "tree-oak-medium",
  "tree-oak-large",
  "tree-pine",
  "bush-small",
  "bush-medium",
  "bush-large",
  "grass-small",
  "grass-medium",
  "grass-large",
  "rock-small",
  "rock-medium",
  "rock-large",
  "rock-pile",
  "ruins-rubble",
];

const WALL_OBJECTS = [
  "stone-block",
  "stone-brick",
  "stone-pillar",
  "wall-corner",
  "wall-enclosure",
  "wall-long",
  "wall-medium",
  "wall-short",
  "wall-t-junction",
  "wall-u-shape",
];

const OBJECT_SCALES: Record<string, number> = {
  "tree-oak-small": 0.35,
  "tree-oak-medium": 0.4,
  "tree-oak-large": 0.45,
  "tree-pine": 0.45,
  "bush-small": 0.3,
  "bush-medium": 0.35,
  "bush-large": 0.35,
  "grass-small": 0.25,
  "grass-medium": 0.25,
  "grass-large": 0.3,
  "rock-small": 0.25,
  "rock-medium": 0.3,
  "rock-large": 0.35,
  "rock-pile": 0.3,
  "ruins-rubble": 0.35,
  "stone-block": 0.25,
  "stone-brick": 0.25,
  "stone-pillar": 0.3,
  "wall-corner": 0.3,
  "wall-enclosure": 0.35,
  "wall-long": 0.3,
  "wall-medium": 0.3,
  "wall-short": 0.25,
  "wall-t-junction": 0.3,
  "wall-u-shape": 0.3,
};

export function generateMapObjects(
  worldWidth: number,
  worldHeight: number,
  seed: number
): MapDefinition {
  const rng = Rng.seeded(seed, 0);
  const wallCount = 18;
  const decoCount = 12;

  const picks: PlaceableObject[] = [];

  for (let i = 0; i < wallCount; i++) {
    const name = WALL_OBJECTS[Math.floor(rng.next() * WALL_OBJECTS.length)]!;
    picks.push({ name, scale: OBJECT_SCALES[name] ?? 0.3 });
  }

  for (let i = 0; i < decoCount; i++) {
    const name = DECORATION_OBJECTS[Math.floor(rng.next() * DECORATION_OBJECTS.length)]!;
    picks.push({ name, scale: OBJECT_SCALES[name] ?? 0.3 });
  }

  const objects = placeObjects(picks, worldWidth, worldHeight, rng);
  return { seed, objects };
}
