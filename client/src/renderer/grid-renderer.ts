import { Assets, Container, Sprite, Texture } from "pixi.js";
import type { GridState } from "shared";

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

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function objectFolder(name: string): string {
  if (name.startsWith("tree-") || name.startsWith("bush-") || name.startsWith("grass-"))
    return "plants";
  if (name.startsWith("rock-")) return "rocks";
  if (name.startsWith("wall-") || name.startsWith("stone-")) return "walls";
  return "";
}

export async function loadMapAssets(): Promise<void> {
  const allObjects = [...DECORATION_OBJECTS, ...WALL_OBJECTS];
  const entries = [
    { alias: "map-background", src: "sprites/map-objects/backgrounds/background-grass.png" },
    ...allObjects.map((name) => {
      const folder = objectFolder(name);
      const subpath = folder ? `${folder}/` : "";
      return {
        alias: `map-${name}`,
        src: `sprites/map-objects/${subpath}${name}.webp`,
      };
    }),
  ];
  await Assets.load(entries);
}

export function createBackground(grid: GridState): Sprite {
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const bgTex: Texture = Assets.get("map-background");
  const bg = new Sprite(bgTex);
  bg.width = worldW;
  bg.height = worldH;
  return bg;
}

export function getBottomY(sprite: Sprite): number {
  const tex = sprite.texture;
  return sprite.position.y + tex.height * sprite.scale.y * (1 - sprite.anchor.y);
}

export function createMapObjects(grid: GridState): Sprite[] {
  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const rand = seededRandom(42);
  const margin = 40;
  const wallCount = 18;
  const decoCount = 12;
  const placed: { x: number; y: number; r: number }[] = [];
  const sprites: Sprite[] = [];

  function placeObject(name: string) {
    const tex: Texture = Assets.get(`map-${name}`);
    const scale = OBJECT_SCALES[name] ?? 0.3;

    let x: number, y: number;
    let attempts = 0;
    const minDist = 50;

    do {
      x = margin + rand() * (worldW - margin * 2);
      y = margin + rand() * (worldH - margin * 2);
      attempts++;
    } while (
      attempts < 30 &&
      placed.some(
        (p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (minDist + p.r) ** 2
      )
    );

    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5, 0.9);
    sprite.scale.set(scale);
    sprite.position.set(x, y);
    sprites.push(sprite);

    placed.push({ x, y, r: Math.max(tex.width, tex.height) * scale * 0.3 });
  }

  for (let i = 0; i < wallCount; i++) {
    const name = WALL_OBJECTS[Math.floor(rand() * WALL_OBJECTS.length)]!;
    placeObject(name);
  }

  for (let i = 0; i < decoCount; i++) {
    const name =
      DECORATION_OBJECTS[Math.floor(rand() * DECORATION_OBJECTS.length)]!;
    placeObject(name);
  }

  return sprites;
}
