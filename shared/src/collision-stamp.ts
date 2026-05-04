import type { GridState } from "./types.js";
import type { MapObjectPlacement } from "./map-definition.js";
import { CELL_WALL, CELL_COVER } from "./collision-grid.js";

const CHARACTER_HEIGHT = 10;
const ALPHA_THRESHOLD = 30;
const CHARACTER_DIAMETER = 32;

export interface AlphaImage {
  readonly alpha: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export function stampWallCollision(
  walls: Uint8Array,
  grid: GridState,
  position: { x: number; y: number },
  scale: number,
  anchorX: number,
  anchorY: number,
  image: AlphaImage
): void {
  const texW = image.width;
  const texH = image.height;
  const worldX = position.x - texW * scale * anchorX;
  const worldY = position.y - texH * scale * anchorY;
  const skipPixels = Math.ceil(CHARACTER_HEIGHT / scale);

  for (let px = 0; px < texW; px++) {
    let opaqueHit = 0;
    for (let py = 0; py < texH; py++) {
      if ((image.alpha[py * texW + px] ?? 0) < ALPHA_THRESHOLD) continue;
      opaqueHit++;
      const wx = worldX + px * scale;
      const wy = worldY + py * scale;
      const cx = Math.floor(wx / grid.cellSize);
      const cy = Math.floor(wy / grid.cellSize);
      if (cx >= 0 && cy >= 0 && cx < grid.width && cy < grid.height) {
        walls[cy * grid.width + cx] = opaqueHit <= skipPixels ? CELL_COVER : CELL_WALL;
      }
    }
  }
}

export function stampDecorationCollision(
  walls: Uint8Array,
  grid: GridState,
  position: { x: number; y: number },
  scale: number,
  anchorX: number,
  anchorY: number,
  image: AlphaImage
): void {
  const texW = image.width;
  const texH = image.height;
  const renderedW = texW * scale;
  const renderedH = texH * scale;
  if (renderedW < CHARACTER_DIAMETER && renderedH < CHARACTER_DIAMETER) return;

  const wallStart = Math.floor(texH * 2 / 3);
  const worldX = position.x - texW * scale * anchorX;
  const worldY = position.y - texH * scale * anchorY;

  for (let py = 0; py < texH; py++) {
    for (let px = 0; px < texW; px++) {
      if ((image.alpha[py * texW + px] ?? 0) < ALPHA_THRESHOLD) continue;
      const wx = worldX + px * scale;
      const wy = worldY + py * scale;
      const cx = Math.floor(wx / grid.cellSize);
      const cy = Math.floor(wy / grid.cellSize);
      if (cx >= 0 && cy >= 0 && cx < grid.width && cy < grid.height) {
        walls[cy * grid.width + cx] = py < wallStart ? CELL_COVER : CELL_WALL;
      }
    }
  }
}

export function stampMapObjects(
  grid: GridState,
  placements: readonly MapObjectPlacement[],
  getImage: (name: string) => AlphaImage | null
): void {
  const walls = grid.walls as Uint8Array;
  const anchorX = 0.5;
  const anchorY = 0.9;

  for (const obj of placements) {
    const image = getImage(obj.name);
    if (!image) continue;

    if (obj.category === "wall") {
      stampWallCollision(walls, grid, obj.position, obj.scale, anchorX, anchorY, image);
    } else {
      stampDecorationCollision(walls, grid, obj.position, obj.scale, anchorX, anchorY, image);
    }
  }
}
