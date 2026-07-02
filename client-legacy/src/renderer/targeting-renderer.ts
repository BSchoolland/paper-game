import type { Graphics } from "pixi.js";
import type { AimDirection, AttackAbility, Entity, GameEvent, GameState, GridState, Vec2 } from "shared";
import { ShapeKind, computeShapeFootprint, sub, length } from "shared";
import {
  PENCIL,
  PENCIL_HIT,
  PENCIL_LIGHT,
  drawRoughArc,
  drawRoughRect,
  drawRoughLine,
  drawRoughCircle,
  drawXMark,
} from "./sketch-utils.js";
import { drawZonePreview } from "./zone-renderer.js";

export function getActiveAttackAbility(entity: Entity): AttackAbility | undefined {
  return entity.abilities.find(a => a.kind === "attack") as AttackAbility | undefined;
}

/**
 * Draws the aiming overlay for an attack: the shape footprint (cone / beam / blast / ray) the
 * attack will cover. The geometry comes from `computeShapeFootprint` — the same maths the
 * resolver's hit test uses — so this never re-derives angles or rectangles by hand.
 */
export function drawTargetingPreview(
  g: Graphics,
  entity: Entity,
  mouseWorld: Vec2,
  state: GameState,
  selectedAbility?: AttackAbility
): void {
  const ability = selectedAbility ?? getActiveAttackAbility(entity);
  if (!ability) return;

  const dir = sub(mouseWorld, entity.position);
  if (length(dir) < 1) return;

  const footprint = computeShapeFootprint(
    ability.shape,
    entity.position,
    dir,
    state.entities,
    state.grid,
    entity.id,
    ability.ignoreCoverRange
  );

  switch (footprint.kind) {
    case ShapeKind.Sector: {
      g.moveTo(footprint.origin.x, footprint.origin.y);
      drawRoughArc(g, footprint.origin.x, footprint.origin.y, footprint.radius, footprint.startAngle, footprint.endAngle, 1.5, 24, 17);
      g.lineTo(footprint.origin.x, footprint.origin.y);
      g.fill({ color: PENCIL, alpha: 0.1 });
      g.stroke({ color: PENCIL, alpha: 0.5, width: 1.2 });
      break;
    }
    case ShapeKind.Rectangle: {
      drawRoughRect(g, footprint.corners, 1, 23);
      g.fill({ color: PENCIL, alpha: 0.1 });
      g.stroke({ color: PENCIL, alpha: 0.5, width: 1.2 });
      break;
    }
    case ShapeKind.Circle: {
      drawRoughCircle(g, footprint.rangeOrigin.x, footprint.rangeOrigin.y, footprint.range, 1.5, 48, 45);
      g.stroke({ color: PENCIL, alpha: 0.25, width: 1.2 });
      drawRoughArc(g, footprint.center.x, footprint.center.y, footprint.radius, 0, Math.PI * 2, 1.5, 24, 47);
      g.fill({ color: PENCIL, alpha: 0.1 });
      g.stroke({ color: PENCIL, alpha: 0.5, width: 1.2 });
      break;
    }
    case ShapeKind.Point: {
      const { from, to } = footprint;
      drawRoughLine(g, from.x, from.y, to.x, to.y, 0.8, 31);
      g.stroke({ color: PENCIL, alpha: 0.6, width: 1.2 });

      if (footprint.hitEntityId) {
        const hitEntity = state.entities.get(footprint.hitEntityId);
        if (hitEntity && hitEntity.teamId !== entity.teamId) {
          drawXMark(g, to.x, to.y, 6, 37);
          g.stroke({ color: PENCIL_HIT, alpha: 0.7, width: 1.5 });
        } else {
          drawRoughCircle(g, to.x, to.y, 5, 0.8, 12, 41);
          g.stroke({ color: PENCIL_LIGHT, alpha: 0.5, width: 1.2 });
        }
      } else if (footprint.hitWall) {
        drawXMark(g, to.x, to.y, 4, 43);
        g.stroke({ color: PENCIL_LIGHT, alpha: 0.6, width: 1.2 });
      } else {
        g.circle(to.x, to.y, 2.5);
        g.fill({ color: PENCIL, alpha: 0.5 });
      }
      break;
    }
  }
}

/**
 * Draws preview indicators for the *consequences* of an action, off the same `GameEvent`s the
 * authoritative resolver produces. Today that's displacement — knockback / pull of a target,
 * or recoil / lunge of the attacker (both of which surface as `move` events): a dotted line
 * from where the entity stands to where it lands, plus a ghost ring at the landing spot. Any
 * future positional effect that emits an event is previewed by adding a case here — no second
 * implementation, no drift from the server.
 */
export function drawEffectPreview(g: Graphics, events: readonly GameEvent[]): void {
  for (const event of events) {
    if (event.type === "knockback" || event.type === "pull" || event.type === "move") {
      drawDisplacementGhost(g, event.from, event.to);
    } else if (event.type === "collision") {
      drawXMark(g, event.at.x, event.at.y, 7, 67);
      g.stroke({ color: PENCIL_HIT, alpha: 0.75, width: 1.6 });
    } else if (event.type === "zoneCreated") {
      drawZonePreview(g, event.zone, true);
    }
  }
}

/**
 * Telegraphs an incoming enemy attack as a sketched shape footprint at the attacker's position.
 * `strokeAlpha` and `fillAlpha` are controlled by the caller so the same draw can be used for
 * the subtle windup pulse and the brighter "press now" window flash.
 */
export function drawIncomingAttackPreview(
  g: Graphics,
  attackerId: string,
  attackerPos: Vec2,
  aimDirection: AimDirection,
  ability: AttackAbility,
  entities: ReadonlyMap<string, Entity>,
  grid: GridState,
  strokeAlpha: number,
  fillAlpha: number,
): void {
  if (length(aimDirection) < 1) return;

  const footprint = computeShapeFootprint(
    ability.shape,
    attackerPos,
    aimDirection,
    entities,
    grid,
    attackerId,
    ability.ignoreCoverRange,
  );

  switch (footprint.kind) {
    case ShapeKind.Sector: {
      g.moveTo(footprint.origin.x, footprint.origin.y);
      drawRoughArc(g, footprint.origin.x, footprint.origin.y, footprint.radius, footprint.startAngle, footprint.endAngle, 1.5, 24, 53);
      g.lineTo(footprint.origin.x, footprint.origin.y);
      g.fill({ color: PENCIL, alpha: fillAlpha });
      g.stroke({ color: PENCIL, alpha: strokeAlpha, width: 1.4 });
      break;
    }
    case ShapeKind.Rectangle: {
      drawRoughRect(g, footprint.corners, 1, 57);
      g.fill({ color: PENCIL, alpha: fillAlpha });
      g.stroke({ color: PENCIL, alpha: strokeAlpha, width: 1.4 });
      break;
    }
    case ShapeKind.Circle: {
      drawRoughArc(g, footprint.center.x, footprint.center.y, footprint.radius, 0, Math.PI * 2, 1.5, 24, 59);
      g.fill({ color: PENCIL, alpha: fillAlpha });
      g.stroke({ color: PENCIL, alpha: strokeAlpha, width: 1.4 });
      break;
    }
    case ShapeKind.Point: {
      const { from, to } = footprint;
      drawRoughLine(g, from.x, from.y, to.x, to.y, 0.8, 61);
      g.stroke({ color: PENCIL, alpha: strokeAlpha, width: 1.4 });
      break;
    }
  }
}

function drawDisplacementGhost(g: Graphics, from: Vec2, to: Vec2): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const ux = dx / dist;
  const uy = dy / dist;

  const dashLen = 6;
  for (let d = 0; d < dist; d += dashLen * 2) {
    const x0 = from.x + ux * d;
    const y0 = from.y + uy * d;
    const x1 = from.x + ux * Math.min(d + dashLen, dist);
    const y1 = from.y + uy * Math.min(d + dashLen, dist);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  }
  g.stroke({ color: PENCIL_HIT, alpha: 0.5, width: 1.2 });

  drawRoughCircle(g, to.x, to.y, 12, 1, 16, Math.round(dist) * 7 + 3);
  g.stroke({ color: PENCIL_HIT, alpha: 0.55, width: 1.2 });
}
