import { Container, Graphics } from "pixi.js";
import type { Entity, GameEvent, GameState, Vec2, WeaponDefinition } from "shared";
import { normalize, raycast } from "shared";
import { EntityVisual } from "./entity-renderer.js";
import { drawRoughArc, drawRoughRect, drawRoughLine, drawXMark } from "./sketch-utils.js";

const FOOT_OFFSET = 272 * 0.2 * (1 - 0.75);
const FLASH_COLOR = 0x8b2020;
const FLASH_DURATION = 0.4;
const HIT_DELAY = 0.2;

interface AttackFlash {
  gfx: Graphics;
  timer: number;
}

interface DelayedHit {
  targetId: string;
  timer: number;
  killed: boolean;
}

export class EntityManager {
  private visuals = new Map<string, EntityVisual>();
  private pendingEvents: GameEvent[] = [];
  private attackFlashes: AttackFlash[] = [];
  private delayedHits: DelayedHit[] = [];

  constructor(private layer: Container) {}

  pushEvents(events: readonly GameEvent[]) {
    this.pendingEvents.push(...events);
  }

  sync(state: GameState, selectedEntityId: string | null) {
    const currentEntities = state.entities;

    for (const [id, visual] of this.visuals) {
      if (!currentEntities.has(id)) {
        this.layer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        this.visuals.delete(id);
      }
    }

    for (const [id, entity] of currentEntities) {
      let visual = this.visuals.get(id);

      if (visual && (visual.spriteType !== entity.spriteType || visual.heightMeters !== (entity.heightMeters ?? 2))) {
        this.layer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        visual = undefined;
      }

      if (!visual) {
        visual = new EntityVisual(entity);
        this.visuals.set(id, visual);
        this.layer.addChild(visual.container);
      }

      visual.update(entity, entity.id === selectedEntityId && !entity.dead, 0);
    }

    for (const event of this.pendingEvents) {
      this.applyEvent(event, state);
    }
    this.pendingEvents.length = 0;
  }

  tick(state: GameState, selectedEntityId: string | null, dt: number) {
    for (const [id, visual] of this.visuals) {
      const entity = state.entities.get(id);
      if (!entity) continue;
      visual.update(entity, id === selectedEntityId && !entity.dead, dt);
    }

    for (let i = this.attackFlashes.length - 1; i >= 0; i--) {
      const flash = this.attackFlashes[i]!;
      flash.timer -= dt;
      flash.gfx.alpha = Math.max(0, flash.timer / FLASH_DURATION);
      if (flash.timer <= 0) {
        this.layer.removeChild(flash.gfx);
        flash.gfx.destroy();
        this.attackFlashes.splice(i, 1);
      }
    }

    for (let i = this.delayedHits.length - 1; i >= 0; i--) {
      const hit = this.delayedHits[i]!;
      hit.timer -= dt;
      if (hit.timer <= 0) {
        const visual = this.visuals.get(hit.targetId);
        if (visual) {
          if (hit.killed) {
            visual.triggerDeath();
          } else {
            visual.triggerHit();
          }
        }
        this.delayedHits.splice(i, 1);
      }
    }
  }

  destroy() {
    for (const visual of this.visuals.values()) {
      this.layer.removeChild(visual.container);
      visual.container.destroy({ children: true });
    }
    this.visuals.clear();
    for (const flash of this.attackFlashes) {
      this.layer.removeChild(flash.gfx);
      flash.gfx.destroy();
    }
    this.attackFlashes.length = 0;
    this.delayedHits.length = 0;
    this.pendingEvents.length = 0;
  }

  depthSort() {
    for (const visual of this.visuals.values()) {
      visual.container.zIndex = visual.container.position.y + FOOT_OFFSET;
    }
  }

  isAnimating(): boolean {
    if (this.attackFlashes.length > 0 || this.delayedHits.length > 0) return true;
    for (const visual of this.visuals.values()) {
      if (visual.isBusy) return true;
    }
    return false;
  }

  private applyEvent(event: GameEvent, state: GameState) {
    switch (event.type) {
      case "move": {
        const visual = this.visuals.get(event.entityId);
        if (visual) {
          visual.triggerMove(event.from.x, event.from.y, event.to.x, event.to.y);
        }
        break;
      }
      case "attack": {
        const visual = this.visuals.get(event.attackerId);
        if (visual) {
          const aimX = event.attackerPosition.x + event.aimDirection.x;
          visual.triggerAttack(aimX);
        }

        this.spawnAttackFlash(event.attackerPosition, event.aimDirection, event.weapon, event.attackerId, state);

        for (const hit of event.hits) {
          this.delayedHits.push({ targetId: hit.targetId, timer: HIT_DELAY, killed: hit.killed });
        }
        break;
      }
      case "knockback": {
        const kbVisual = this.visuals.get(event.entityId);
        if (kbVisual) {
          kbVisual.triggerKnockback(event.from.x, event.from.y, event.to.x, event.to.y);
        }
        break;
      }
      case "spawn":
        break;
    }
  }

  private spawnAttackFlash(
    pos: Vec2,
    aimDirection: Vec2,
    weapon: WeaponDefinition,
    attackerId: string,
    state: GameState
  ) {
    const gfx = new Graphics();
    const norm = normalize(aimDirection);
    const baseAngle = Math.atan2(norm.y, norm.x);
    const shape = weapon.shape;

    switch (shape.kind) {
      case "sector": {
        gfx.moveTo(pos.x, pos.y);
        drawRoughArc(
          gfx, pos.x, pos.y,
          shape.radius,
          baseAngle - shape.halfAngle,
          baseAngle + shape.halfAngle,
          1.5, 24, 71
        );
        gfx.lineTo(pos.x, pos.y);
        gfx.fill({ color: FLASH_COLOR, alpha: 0.25 });
        gfx.stroke({ color: FLASH_COLOR, alpha: 0.7, width: 1.5 });
        break;
      }
      case "rectangle": {
        const perpX = -norm.y;
        const perpY = norm.x;
        const hw = shape.width / 2;

        const corners = [
          { x: pos.x + perpX * hw, y: pos.y + perpY * hw },
          { x: pos.x + norm.x * shape.length + perpX * hw, y: pos.y + norm.y * shape.length + perpY * hw },
          { x: pos.x + norm.x * shape.length - perpX * hw, y: pos.y + norm.y * shape.length - perpY * hw },
          { x: pos.x - perpX * hw, y: pos.y - perpY * hw },
        ];

        drawRoughRect(gfx, corners, 1, 73);
        gfx.fill({ color: FLASH_COLOR, alpha: 0.25 });
        gfx.stroke({ color: FLASH_COLOR, alpha: 0.7, width: 1.5 });
        break;
      }
      case "point": {
        const result = raycast(
          pos, norm, shape.range,
          state.entities, state.grid,
          attackerId, weapon.ignoreCoverRange
        );

        drawRoughLine(gfx, pos.x, pos.y, result.endPoint.x, result.endPoint.y, 0.8, 77);
        gfx.stroke({ color: FLASH_COLOR, alpha: 0.8, width: 2 });

        if (result.hit) {
          drawXMark(gfx, result.endPoint.x, result.endPoint.y, 7, 79);
          gfx.stroke({ color: FLASH_COLOR, alpha: 0.9, width: 2 });
        }
        break;
      }
      case "circle": {
        const targetX = pos.x + norm.x * shape.range;
        const targetY = pos.y + norm.y * shape.range;
        drawRoughArc(gfx, targetX, targetY, shape.radius, 0, Math.PI * 2, 1.5, 24, 83);
        gfx.fill({ color: FLASH_COLOR, alpha: 0.2 });
        gfx.stroke({ color: FLASH_COLOR, alpha: 0.7, width: 1.5 });
        break;
      }
    }

    this.layer.addChild(gfx);
    this.attackFlashes.push({ gfx, timer: FLASH_DURATION });
  }
}
