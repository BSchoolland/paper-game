import { Graphics } from "pixi.js";
import type { GridState } from "shared";

export function createGridGraphics(grid: GridState): Graphics {
  const g = new Graphics();
  const cs = grid.cellSize;

  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      if (grid.walls[cy * grid.width + cx] === 1) {
        g.rect(cx * cs, cy * cs, cs, cs);
      }
    }
  }
  g.fill({ color: 0x4a4a5a });

  return g;
}
