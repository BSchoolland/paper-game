import { Container, Graphics } from "pixi.js";
import type { GridState } from "shared";

const FLOOR_COLORS = [0x3d3528, 0x36301f] as const;
const WALL_COLOR_OUTER = 0x5a4a3a;
const WALL_COLOR_INNER = 0x3a2e22;
const WALL_HIGHLIGHT = 0x6b5a48;

function isWall(grid: GridState, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return true;
  return grid.walls[cy * grid.width + cx] === 1;
}

export function createGridGraphics(grid: GridState): Container {
  const container = new Container();
  const cs = grid.cellSize;

  const floor = new Graphics();
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      if (grid.walls[cy * grid.width + cx] !== 1) {
        const color = FLOOR_COLORS[(cx + cy) % 2]!;
        floor.rect(cx * cs, cy * cs, cs, cs);
        floor.fill({ color });
      }
    }
  }
  container.addChild(floor);

  const walls = new Graphics();
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      if (grid.walls[cy * grid.width + cx] !== 1) continue;

      const x = cx * cs;
      const y = cy * cs;

      walls.rect(x, y, cs, cs);
      walls.fill({ color: WALL_COLOR_OUTER });

      const inset = 1;
      walls.rect(x + inset, y + inset, cs - inset * 2, cs - inset * 2);
      walls.fill({ color: WALL_COLOR_INNER });

      if (!isWall(grid, cx, cy - 1)) {
        walls.rect(x + 1, y, cs - 2, 2);
        walls.fill({ color: WALL_HIGHLIGHT });
      }
      if (!isWall(grid, cx - 1, cy)) {
        walls.rect(x, y + 1, 2, cs - 2);
        walls.fill({ color: WALL_HIGHLIGHT });
      }
    }
  }
  container.addChild(walls);

  return container;
}
