import type { Vec2 } from "./types.js";

export type MapObjectCategory = "wall" | "decoration";

export interface MapObjectPlacement {
  readonly name: string;
  readonly category: MapObjectCategory;
  readonly position: Vec2;
  readonly scale: number;
}

export interface MapDefinition {
  readonly seed: number;
  readonly objects: readonly MapObjectPlacement[];
}

export interface PlaceableObject {
  readonly name: string;
  readonly category: MapObjectCategory;
  readonly scale: number;
}

export function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function placeObjects(
  objects: readonly PlaceableObject[],
  worldWidth: number,
  worldHeight: number,
  rand: () => number,
  margin = 40,
  minDist = 50
): MapObjectPlacement[] {
  const placed: { x: number; y: number; r: number }[] = [];
  const result: MapObjectPlacement[] = [];

  for (const obj of objects) {
    let x: number, y: number;
    let attempts = 0;

    do {
      x = margin + rand() * (worldWidth - margin * 2);
      y = margin + rand() * (worldHeight - margin * 2);
      attempts++;
    } while (
      attempts < 30 &&
      placed.some(
        (p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (minDist + p.r) ** 2
      )
    );

    result.push({ name: obj.name, category: obj.category, position: { x, y }, scale: obj.scale });
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
  const rand = seededRandom(seed);
  const wallCount = 18;
  const decoCount = 12;

  const picks: PlaceableObject[] = [];

  for (let i = 0; i < wallCount; i++) {
    const name = WALL_OBJECTS[Math.floor(rand() * WALL_OBJECTS.length)]!;
    picks.push({ name, category: "wall", scale: OBJECT_SCALES[name] ?? 0.3 });
  }

  for (let i = 0; i < decoCount; i++) {
    const name = DECORATION_OBJECTS[Math.floor(rand() * DECORATION_OBJECTS.length)]!;
    picks.push({ name, category: "decoration", scale: OBJECT_SCALES[name] ?? 0.3 });
  }

  const objects = placeObjects(picks, worldWidth, worldHeight, rand);
  return { seed, objects };
}
