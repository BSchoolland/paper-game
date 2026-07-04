import type { Graphics } from "pixi.js";
import type { Entity, GameState, Vec2 } from "shared";
import { planDisplayRoute, moveRadiusOf } from "shared";
import {
  PENCIL,
  drawRoughCircle,
  drawDottedPolyline,
} from "./sketch-utils.js";

/**
 * Draws the path-based move preview: a dotted line that bends around obstacles to `displayTarget`,
 * ending at the move-radius landing marker. `displayTarget` is the *eased* on-screen target (see
 * GameRenderer) — it glides between the 12px-snapped destinations and may sit briefly between cells
 * while easing, which is fine since it's purely visual. Pass `null` to draw nothing (no reachable
 * target near the cursor). The line uses the same smoothing as move playback, so preview and
 * animation match.
 */
export function drawMovePreview(
  g: Graphics,
  entity: Entity,
  displayTarget: Vec2 | null,
  state: GameState
): void {
  if (!displayTarget) return;

  const radius = moveRadiusOf(entity);
  const { smoothed } = planDisplayRoute(entity.position, displayTarget, state.grid, radius);
  drawDottedPolyline(g, smoothed, 6, 1.2, 0.8, 42);
  g.fill({ color: PENCIL, alpha: 0.6 });

  drawRoughCircle(g, displayTarget.x, displayTarget.y, entity.collisionRadius, 1, 24, 13);
  g.stroke({ color: PENCIL, alpha: 0.5, width: 1.2 });
  g.circle(displayTarget.x, displayTarget.y, 2.5);
  g.fill({ color: PENCIL, alpha: 0.7 });
}
