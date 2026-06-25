import { Container, Graphics } from "pixi.js";
import type { AimDirection, AttackAbility, CombatShapeDefinition, Entity, GameEvent, GameState, ShapeFootprint, TrailEffect, Vec2, ZoneEffectKind } from "shared";
import { ShapeKind, computeShapeFootprint, normalize, length as vecLength, raycast, STATUS_META, pathfind, smoothPath, moveRadiusOf, distance } from "shared";
import { EntityVisual } from "./entity-renderer.js";
import { drawRoughArc, drawRoughRect, drawRoughLine, drawXMark, drawRoughCircle } from "./sketch-utils.js";
import { FloatingTextManager } from "./floating-text.js";
import { VisualEffectDispatcher, type EffectKey } from "./visual-effect-dispatcher.js";
import { defenseLabel } from "./impact-labels.js";

const FOOT_OFFSET = 272 * 0.2 * (1 - 0.75);
const DEFAULT_FLASH_COLOR = 0x8b2020;
const FLASH_DURATION = 0.4;
const HIT_DELAY = 0.2;

// Dispatcher keys: stable identifiers for visual effects that can fire from either local
// prediction or a server event. The same key from each source dedupes via VisualEffectDispatcher.
// The enum constrains the prefix; `makeKey` builds the branded `EffectKey` so raw strings can't
// reach the dispatcher API.
enum EffectKind {
  Swing = "swing",
  Flash = "flash",
  Shake = "shake",
  Defender = "defender",
}
const makeKey = (kind: EffectKind, scope: string) => `${kind}:${scope}` as EffectKey;
const swingKey = (attackerId: string) => makeKey(EffectKind.Swing, attackerId);
const flashKey = (attackerId: string) => makeKey(EffectKind.Flash, attackerId);
const shakeKey = (attackerId: string) => makeKey(EffectKind.Shake, attackerId);
const defenderKey = (defenderId: string) => makeKey(EffectKind.Defender, defenderId);

const ZONE_TICK_LABEL: Record<ZoneEffectKind, (m: number) => string> = {
  damage: (m) => `-${m}`,
  heal: (m) => `+${m}`,
  addBarrier: (m) => `+${m} shield`,
  drainRed: () => STATUS_META.suppressed.label,
  drainBlue: () => STATUS_META.winded.label,
  cover: () => "",
  wall: () => "",
};
const ZONE_TICK_COLOR: Record<ZoneEffectKind, number> = {
  damage: 0xc0392b,
  heal: 0x2ecc71,
  addBarrier: 0x3498db,
  drainRed: STATUS_META.suppressed.color,
  drainBlue: STATUS_META.winded.color,
  cover: 0xffffff,
  wall: 0xffffff,
};

interface AttackFlash {
  gfx: Graphics;
  timer: number;
}

interface DelayedHit {
  targetId: string;
  timer: number;
  killed: boolean;
  defenseTier?: "perfect" | "decent";
  attackerPos?: Vec2;
}

export type ShakeRequest = { intensity: number };

export class EntityManager {
  private visuals = new Map<string, EntityVisual>();
  private pendingEvents: GameEvent[] = [];
  private attackFlashes: AttackFlash[] = [];
  private delayedHits: DelayedHit[] = [];
  private floatingText: FloatingTextManager;
  onShake: ((req: ShakeRequest) => void) | null = null;
  onPerfectBlock: (() => void) | null = null;
  private dispatcher = new VisualEffectDispatcher();

  constructor(private layer: Container, private mySeatId: string | null = null) {
    this.floatingText = new FloatingTextManager(layer);
  }

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

      if (visual && (visual.entitySprites?.idle !== entity.sprites?.idle || visual.heightMeters !== (entity.heightMeters ?? 2))) {
        this.layer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        visual = undefined;
      }

      if (!visual) {
        visual = new EntityVisual(entity, this.mySeatId);
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
          } else if (hit.defenseTier) {
            // Block: pose-and-screen-flash is delegated to the per-tier methods on EntityVisual
            // so weapon-specific block poses live in one place.
            const facingX = hit.attackerPos?.x ?? visual.container.position.x;
            if (hit.defenseTier === "perfect") {
              visual.triggerPerfectBlock(facingX);
              this.onPerfectBlock?.();
            } else {
              visual.triggerBlock(facingX);
            }
            const label = defenseLabel(hit.defenseTier);
            const pos = visual.container.position;
            this.floatingText.spawn(pos.x, pos.y - 55, label.text, label.color, {
              fontSize: label.fontSize,
              lifetime: label.lifetime,
              strokeColor: label.strokeColor,
              strokeWidth: label.strokeWidth,
              fontWeight: label.fontWeight,
              fontFamily: label.fontFamily,
            });
          } else {
            visual.triggerHit();
          }
        }
        this.delayedHits.splice(i, 1);
      }
    }

    this.floatingText.tick(dt);
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
    this.dispatcher.clear();
    this.floatingText.destroy();
  }

  setDamagePreview(targets: { entityId: string; damage: number; currentHp: number; maxHp: number; barrier: number }[]): void {
    const targetIds = new Set(targets.map(t => t.entityId));
    for (const [id, visual] of this.visuals) {
      if (targetIds.has(id)) {
        const t = targets.find(t => t.entityId === id)!;
        visual.setDamagePreview(t.damage, t.currentHp, t.maxHp, t.barrier);
      } else {
        visual.clearDamagePreview();
      }
    }
  }

  setBarrierPreview(entityId: string, barrierHp: number, currentHp: number, maxHp: number, currentBarrier: number): void {
    for (const [id, visual] of this.visuals) {
      if (id === entityId) {
        visual.setBarrierPreview(barrierHp, currentHp, maxHp, currentBarrier);
      } else {
        visual.clearDamagePreview();
      }
    }
  }

  clearDamagePreview(): void {
    for (const visual of this.visuals.values()) {
      visual.clearDamagePreview();
    }
  }

  /** Play just the attacker-side visuals of an attack (swing sprite + shape flash + screen shake)
   *  using the same code path the real `attack` event uses. Called from the defense prompt to
   *  visualize the incoming swing during the timing window. */
  previewIncomingAttack(
    attackerId: string,
    attackerPosition: Vec2,
    aimDirection: AimDirection,
    ability: AttackAbility,
    state: GameState,
  ): void {
    this.dispatcher.playLocal(swingKey(attackerId), () => {
      const visual = this.visuals.get(attackerId);
      if (visual) visual.triggerAttack(attackerPosition.x + aimDirection.x);
    });
    this.dispatcher.playLocal(flashKey(attackerId), () => {
      this.spawnAttackFlash(attackerPosition, aimDirection, ability, attackerId, state);
    });
    const shake = ability.visual?.screenShake;
    if (shake && shake > 0) {
      this.dispatcher.playLocal(shakeKey(attackerId), () => this.onShake?.({ intensity: shake }));
    }
  }

  /** Spawn a floating text label in world space. Used for impact-feedback callouts (CRIT!,
   *  BLOCK!, PARRY!) on top of the standard damage/status floats. */
  spawnFloatingText(x: number, y: number, message: string, color: number, opts?: import("./floating-text.js").FloatingTextOptions): void {
    this.floatingText.spawn(x, y, message, color, opts);
  }

  /** Trigger the defender's block animation immediately when the player presses, so the visual
   *  response is instant rather than waiting for the server round-trip. The server's matching
   *  delayed-hit visual is consumed via the same dispatcher key. */
  triggerLocalBlock(defenderId: string, attackerPosition: Vec2, tier: "perfect" | "decent"): void {
    this.dispatcher.playLocal(defenderKey(defenderId), () => {
      const visual = this.visuals.get(defenderId);
      if (!visual) return;
      if (tier === "perfect") {
        visual.triggerPerfectBlock(attackerPosition.x);
        this.onPerfectBlock?.();
      } else {
        visual.triggerBlock(attackerPosition.x);
      }
    });
  }

  depthSort() {
    for (const visual of this.visuals.values()) {
      visual.container.zIndex = visual.container.position.y + FOOT_OFFSET;
    }
  }

  isAnimating(): boolean {
    if (this.attackFlashes.length > 0 || this.delayedHits.length > 0) return true;
    if (this.floatingText.isAnimating()) return true;
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
          // Recompute the route locally (point-sized transit, like the mover) so playback follows the
          // threaded path around obstacles instead of sliding straight through them. Smoothing uses
          // the body radius so the drawn motion still hugs corners. Fall back to a straight tween only
          // if no route exists at all.
          const mover = state.entities.get(event.entityId);
          const radius = mover ? moveRadiusOf(mover) : 16;
          const route = pathfind(event.from, event.to, state.grid, 0);
          const followsPath = route.length > 0 && distance(route[route.length - 1]!, event.to) < radius;
          const smoothed = followsPath ? smoothPath([event.from, ...route], state.grid, radius) : undefined;
          visual.triggerMove(event.from.x, event.from.y, event.to.x, event.to.y, smoothed);
        }
        break;
      }
      case "attack": {
        this.dispatcher.playFromServer(swingKey(event.attackerId), () => {
          const visual = this.visuals.get(event.attackerId);
          if (visual) visual.triggerAttack(event.attackerPosition.x + event.aimDirection.x);
        });
        this.dispatcher.playFromServer(flashKey(event.attackerId), () => {
          this.spawnAttackFlash(event.attackerPosition, event.aimDirection, event.ability, event.attackerId, state);
        });
        const shake = event.ability.visual?.screenShake;
        if (shake && shake > 0) {
          this.dispatcher.playFromServer(shakeKey(event.attackerId), () => this.onShake?.({ intensity: shake }));
        }

        for (const hit of event.hits) {
          // Deaths always play (terminal — even a successful block can't refund a kill).
          if (hit.killed) {
            this.delayedHits.push({
              targetId: hit.targetId,
              timer: HIT_DELAY,
              killed: true,
              defenseTier: hit.defenseTier,
              attackerPos: event.attackerPosition,
            });
            continue;
          }
          // Non-fatal hits dedupe against the local prediction (if any) via the dispatcher.
          this.dispatcher.playFromServer(defenderKey(hit.targetId), () => {
            this.delayedHits.push({
              targetId: hit.targetId,
              timer: HIT_DELAY,
              killed: false,
              defenseTier: hit.defenseTier,
              attackerPos: event.attackerPosition,
            });
          });
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
      case "pull": {
        const pullVisual = this.visuals.get(event.entityId);
        if (pullVisual) {
          pullVisual.triggerKnockback(event.from.x, event.from.y, event.to.x, event.to.y);
        }
        break;
      }
      case "turnStart":
        break;
      case "statusApplied": {
        const statusVisual = this.visuals.get(event.entityId);
        if (statusVisual) {
          const pos = statusVisual.container.position;
          const meta = STATUS_META[event.status.type];
          this.floatingText.spawn(pos.x, pos.y - 50, meta?.label ?? event.status.type, meta?.color ?? 0xffffff);
        }
        break;
      }
      case "collision": {
        this.spawnImpactBurst(event.at, 0xb0392b);
        this.floatingText.spawn(event.at.x, event.at.y - 30, `-${event.damage}`, 0xc0392b);
        this.delayedHits.push({ targetId: event.entityId, timer: HIT_DELAY, killed: event.killed });
        break;
      }
      case "zoneTick": {
        const v = this.visuals.get(event.entityId);
        if (v) {
          const pos = v.container.position;
          this.floatingText.spawn(pos.x, pos.y - 45, ZONE_TICK_LABEL[event.effect](event.magnitude), ZONE_TICK_COLOR[event.effect]);
        }
        break;
      }
      case "zoneCreated":
      case "zoneExpired":
        // The persistent zone overlay is drawn straight from GameState.zones; nothing to animate.
        break;
    }
  }

  private spawnImpactBurst(at: Vec2, color: number) {
    const gfx = new Graphics();
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + 0.2;
      const len = 6 + (i % 3) * 4;
      gfx.moveTo(at.x, at.y);
      gfx.lineTo(at.x + Math.cos(angle) * len, at.y + Math.sin(angle) * len);
    }
    gfx.stroke({ color, alpha: 0.85, width: 2 });
    drawRoughCircle(gfx, at.x, at.y, 7, 1.5, 12, 61);
    gfx.stroke({ color, alpha: 0.6, width: 1.5 });
    this.layer.addChild(gfx);
    this.attackFlashes.push({ gfx, timer: FLASH_DURATION });
  }

  private spawnAttackFlash(
    pos: Vec2,
    aimDirection: AimDirection,
    ability: AttackAbility,
    attackerId: string,
    state: GameState
  ) {
    const gfx = new Graphics();
    const aimLen = vecLength(aimDirection);
    const norm = normalize(aimDirection);
    const baseAngle = Math.atan2(norm.y, norm.x);
    const shape = ability.shape;
    const visual = ability.visual;
    const color = visual?.color ?? DEFAULT_FLASH_COLOR;
    const trail = visual?.trailEffect;
    const circleDist = shape.kind === ShapeKind.Circle ? Math.min(aimLen, shape.range) : 0;

    const footprint = computeShapeFootprint(
      shape, pos, aimDirection,
      state.entities, state.grid,
      attackerId, ability.ignoreCoverRange
    );
    this.drawShapeFlash(gfx, footprint, color);

    if (trail) {
      this.drawTrailEffect(gfx, pos, norm, baseAngle, shape, color, trail, attackerId, ability, state, circleDist);
    }

    this.layer.addChild(gfx);
    this.attackFlashes.push({ gfx, timer: FLASH_DURATION });
  }

  private drawShapeFlash(gfx: Graphics, footprint: ShapeFootprint, color: number) {
    switch (footprint.kind) {
      case ShapeKind.Sector: {
        gfx.moveTo(footprint.origin.x, footprint.origin.y);
        drawRoughArc(gfx, footprint.origin.x, footprint.origin.y, footprint.radius, footprint.startAngle, footprint.endAngle, 1.5, 24, 71);
        gfx.lineTo(footprint.origin.x, footprint.origin.y);
        gfx.fill({ color, alpha: 0.25 });
        gfx.stroke({ color, alpha: 0.7, width: 1.5 });
        break;
      }
      case ShapeKind.Rectangle: {
        drawRoughRect(gfx, footprint.corners, 1, 73);
        gfx.fill({ color, alpha: 0.25 });
        gfx.stroke({ color, alpha: 0.7, width: 1.5 });
        break;
      }
      case ShapeKind.Point: {
        drawRoughLine(gfx, footprint.from.x, footprint.from.y, footprint.to.x, footprint.to.y, 0.8, 77);
        gfx.stroke({ color, alpha: 0.8, width: 2 });
        if (footprint.hitEntityId) {
          drawXMark(gfx, footprint.to.x, footprint.to.y, 7, 79);
          gfx.stroke({ color, alpha: 0.9, width: 2 });
        }
        break;
      }
      case ShapeKind.Circle: {
        drawRoughArc(gfx, footprint.center.x, footprint.center.y, footprint.radius, 0, Math.PI * 2, 1.5, 24, 83);
        gfx.fill({ color, alpha: 0.2 });
        gfx.stroke({ color, alpha: 0.7, width: 1.5 });
        break;
      }
    }
  }

  private drawTrailEffect(
    gfx: Graphics,
    pos: Vec2,
    norm: Vec2,
    baseAngle: number,
    shape: CombatShapeDefinition,
    color: number,
    trail: TrailEffect,
    attackerId: string,
    ability: AttackAbility,
    state: GameState,
    circleDist: number
  ) {
    switch (trail) {
      case "slash":
        this.drawSlashTrail(gfx, pos, baseAngle, shape, color);
        break;
      case "thrust":
        this.drawThrustTrail(gfx, pos, norm, shape, color);
        break;
      case "projectile":
        this.drawProjectileTrail(gfx, pos, norm, shape, color, attackerId, ability, state);
        break;
      case "explosion":
        this.drawExplosionTrail(gfx, pos, norm, shape, color, circleDist);
        break;
      case "splash":
        this.drawSplashTrail(gfx, pos, norm, shape, color, circleDist);
        break;
    }
  }

  private drawSlashTrail(gfx: Graphics, pos: Vec2, baseAngle: number, shape: CombatShapeDefinition, color: number) {
    const radius = shape.kind === ShapeKind.Sector ? shape.radius :
                   shape.kind === ShapeKind.Rectangle ? shape.length :
                   shape.kind === ShapeKind.Circle ? shape.radius : 50;
    const halfAngle = shape.kind === ShapeKind.Sector ? shape.halfAngle : Math.PI / 4;

    for (let i = 1; i <= 3; i++) {
      const r = radius * (0.3 + i * 0.2);
      const angleOffset = (i - 2) * 0.08;
      drawRoughArc(
        gfx, pos.x, pos.y, r,
        baseAngle - halfAngle * 0.8 + angleOffset,
        baseAngle + halfAngle * 0.8 + angleOffset,
        2.0, 16, 90 + i * 7
      );
      gfx.stroke({ color, alpha: 0.5 - i * 0.1, width: 2.5 - i * 0.4 });
    }
  }

  private drawThrustTrail(gfx: Graphics, pos: Vec2, norm: Vec2, shape: CombatShapeDefinition, color: number) {
    const length = shape.kind === ShapeKind.Rectangle ? shape.length :
                   shape.kind === ShapeKind.Point ? shape.range : 80;

    const endX = pos.x + norm.x * length;
    const endY = pos.y + norm.y * length;
    drawRoughLine(gfx, pos.x, pos.y, endX, endY, 0.5, 95);
    gfx.stroke({ color, alpha: 0.7, width: 3 });

    const tipLen = 8;
    const tipSpread = 5;
    const perpX = -norm.y;
    const perpY = norm.x;
    gfx.moveTo(endX, endY);
    gfx.lineTo(endX - norm.x * tipLen + perpX * tipSpread, endY - norm.y * tipLen + perpY * tipSpread);
    gfx.moveTo(endX, endY);
    gfx.lineTo(endX - norm.x * tipLen - perpX * tipSpread, endY - norm.y * tipLen - perpY * tipSpread);
    gfx.stroke({ color, alpha: 0.6, width: 2 });
  }

  private drawProjectileTrail(
    gfx: Graphics,
    pos: Vec2,
    norm: Vec2,
    shape: CombatShapeDefinition,
    color: number,
    attackerId: string,
    ability: AttackAbility,
    state: GameState
  ) {
    if (shape.kind !== ShapeKind.Point) return;

    const result = raycast(
      pos, norm, shape.range,
      state.entities, state.grid,
      attackerId, ability.ignoreCoverRange
    );
    const endX = result.endPoint.x;
    const endY = result.endPoint.y;

    const perpX = -norm.y;
    const perpY = norm.x;
    const dx = endX - pos.x;
    const dy = endY - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const segments = Math.max(3, Math.floor(dist / 20));

    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const x = pos.x + dx * t;
      const y = pos.y + dy * t;
      const dotSize = 1.5 + t * 1.5;
      gfx.circle(x + perpX * Math.sin(t * 12) * 1.5, y + perpY * Math.sin(t * 12) * 1.5, dotSize);
    }
    gfx.fill({ color, alpha: 0.4 });

    if (result.hit) {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const sparkLen = 5 + Math.random() * 5;
        gfx.moveTo(endX, endY);
        gfx.lineTo(endX + Math.cos(angle) * sparkLen, endY + Math.sin(angle) * sparkLen);
      }
      gfx.stroke({ color, alpha: 0.8, width: 1.5 });
    } else if (result.wallDistance !== null) {
      for (let i = 0; i < 5; i++) {
        const angle = Math.atan2(-norm.y, -norm.x) + (i - 2) * 0.4;
        const sparkLen = 4 + Math.random() * 4;
        gfx.moveTo(endX, endY);
        gfx.lineTo(endX + Math.cos(angle) * sparkLen, endY + Math.sin(angle) * sparkLen);
      }
      gfx.stroke({ color, alpha: 0.6, width: 1.5 });
    }
  }

  private drawExplosionTrail(gfx: Graphics, pos: Vec2, norm: Vec2, shape: CombatShapeDefinition, color: number, circleDist: number) {
    let cx: number, cy: number, radius: number;

    if (shape.kind === ShapeKind.Circle) {
      cx = pos.x + norm.x * circleDist;
      cy = pos.y + norm.y * circleDist;
      radius = shape.radius;
    } else if (shape.kind === ShapeKind.Sector) {
      cx = pos.x + norm.x * shape.radius * 0.5;
      cy = pos.y + norm.y * shape.radius * 0.5;
      radius = shape.radius * 0.6;
    } else {
      cx = pos.x + norm.x * 40;
      cy = pos.y + norm.y * 40;
      radius = 30;
    }

    for (let i = 1; i <= 3; i++) {
      const r = radius * (0.3 + i * 0.25);
      drawRoughCircle(gfx, cx, cy, r, 2.0, 20, 100 + i * 11);
      gfx.stroke({ color, alpha: 0.6 - i * 0.15, width: 2.5 - i * 0.5 });
    }

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.3;
      const len = radius * (0.5 + Math.random() * 0.5);
      gfx.moveTo(cx, cy);
      gfx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    }
    gfx.stroke({ color, alpha: 0.35, width: 1.5 });
  }

  private drawSplashTrail(gfx: Graphics, pos: Vec2, norm: Vec2, shape: CombatShapeDefinition, color: number, circleDist: number) {
    let cx: number, cy: number, spread: number;

    if (shape.kind === ShapeKind.Circle) {
      cx = pos.x + norm.x * circleDist;
      cy = pos.y + norm.y * circleDist;
      spread = shape.radius;
    } else if (shape.kind === ShapeKind.Sector) {
      cx = pos.x + norm.x * shape.radius * 0.5;
      cy = pos.y + norm.y * shape.radius * 0.5;
      spread = shape.radius * 0.7;
    } else {
      cx = pos.x + norm.x * 40;
      cy = pos.y + norm.y * 40;
      spread = 30;
    }

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + i * 0.5;
      const dist = spread * (0.2 + Math.random() * 0.8);
      const blobX = cx + Math.cos(angle) * dist;
      const blobY = cy + Math.sin(angle) * dist;
      const blobR = 2 + Math.random() * 4;
      drawRoughCircle(gfx, blobX, blobY, blobR, 1.0, 8, 120 + i * 5);
      gfx.fill({ color, alpha: 0.35 });
    }

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const d1 = spread * 0.3;
      const d2 = spread * (0.6 + Math.random() * 0.4);
      gfx.moveTo(cx + Math.cos(angle) * d1, cy + Math.sin(angle) * d1);
      gfx.lineTo(cx + Math.cos(angle) * d2, cy + Math.sin(angle) * d2);
    }
    gfx.stroke({ color, alpha: 0.3, width: 1.5 });
  }
}
