import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Entity, SpriteSet, StatusEffect } from "shared";
import type { AnimSet } from "shared";
import { STATUS_META } from "shared";
import {
  type AnimState,
  getPlayerTexture,
  getEnemyTexture,
} from "./sprite-assets.js";
import { drawRoughEllipse } from "./sketch-utils.js";
import { CharacterSprite } from "./character-sprite.js";

const HP_BAR_W = 40;
const HP_BAR_H = 5;
const HP_BAR_Y = -42;
const PX_PER_METER = 22.5;

interface BarLayout {
  totalW: number;
  left: number;
  hpRatio: number;
  hpW: number;
  hpColor: number;
  barrierRatio: number;
}

function barLayout(hp: number, maxHp: number, barrier: number, extraBarrierRatio = 0): BarLayout {
  const hpRatio = Math.min(hp / maxHp, 1);
  const barrierRatio = barrier / maxHp;
  const totalRatio = Math.max(1, hpRatio + barrierRatio + extraBarrierRatio);
  const totalW = HP_BAR_W * totalRatio;
  const hpColor = hpRatio > 0.6 ? 0x5a7a3a : hpRatio > 0.3 ? 0x8b7a3a : 0x8b3a3a;
  return {
    totalW,
    left: -totalW / 2,
    hpRatio,
    hpW: HP_BAR_W * hpRatio,
    hpColor,
    barrierRatio,
  };
}

function easeOutQuad(t: number): number {
  return t * (2 - t);
}

/** Position at arc-length fraction `t` (0..1) along a polyline — used to animate a move along its
 *  routed path rather than straight. Recomputed per frame (one moving unit; negligible cost). */
function pointAlongPolyline(pts: { x: number; y: number }[], t: number): { x: number; y: number } {
  if (pts.length === 1) return pts[0]!;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  if (total < 1e-6) return pts[pts.length - 1]!;
  let target = t * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= seg || i === pts.length - 1) {
      const f = seg < 1e-6 ? 0 : target / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    target -= seg;
  }
  return pts[pts.length - 1]!;
}

const DEATH_DURATION = 0.5;
const STATUS_DOT_RADIUS = 2.5;
const STATUS_DOT_SPACING = 7;
const STATUS_DOT_Y = HP_BAR_Y + HP_BAR_H + 5;
const COMBAT_STATES: AnimState[] = ["idle", "attack", "hit", "move"];

export class EntityVisual {
  readonly container: Container;
  readonly sprites: Record<AnimState, Sprite>;
  private readonly hpBar: Graphics;
  private readonly hpBg: Graphics;
  private readonly hpPreview: Graphics;
  private readonly selectionRing: Graphics;
  private readonly ownerRing: Graphics;
  private animState: AnimState = "idle";
  private animTimer = 0;
  readonly entityId: string;
  readonly entitySprites: SpriteSet | undefined;
  readonly heightMeters: number;
  private lastHp: number;
  private lastBarrier: number;
  private lastHpRatio: number;
  private tweenFrom: { x: number; y: number } | null = null;
  private tweenProgress = 1;
  /** Full polyline [start, ...waypoints] for path-following move playback; null = straight tween. */
  private tweenPath: { x: number; y: number }[] | null = null;
  private facingLeft: boolean;
  private wasSelected = false;
  private readonly scale: number;
  private deathTimer = 0;
  private isDead = false;
  private isKnockback = false;
  private charSprite: CharacterSprite | null = null;
  private readonly statusDots: Graphics;
  private lastStatusCount = 0;

  constructor(entity: Entity, mySeatId: string | null = null) {
    this.entityId = entity.id;
    this.entitySprites = entity.sprites;
    this.heightMeters = entity.heightMeters ?? 2;
    this.lastHp = entity.hp;
    this.lastBarrier = entity.barrier;
    this.lastHpRatio = entity.hp / entity.maxHp;
    this.facingLeft = entity.teamId === "blue";

    this.container = new Container();
    this.container.position.set(entity.position.x, entity.position.y);

    const playerAnimSet = entity.playerAnimSet ?? null;

    const heightM = entity.heightMeters ?? 2;

    if (playerAnimSet) {
      const charSprite = new CharacterSprite(
        playerAnimSet,
        COMBAT_STATES,
        heightM * PX_PER_METER,
        this.facingLeft,
      );
      this.charSprite = charSprite;
      this.scale = charSprite.scale;
      this.sprites = charSprite.sprites as Record<AnimState, Sprite>;
      this.container.addChild(charSprite.container);

      if (entity.equipped && entity.attachments) {
        charSprite.setEquipment(entity.equipped, entity.attachments);
      }
    } else {
      const idleTex = entity.sprites
        ? getEnemyTexture(entity.sprites.idle)
        : getPlayerTexture("sword", "idle");
      this.scale = (heightM * PX_PER_METER) / idleTex!.height;

      const sprites: Record<string, Sprite> = {};
      for (const state of COMBAT_STATES) {
        const tex = entity.sprites
          ? getEnemyTexture(entity.sprites[state])
          : getPlayerTexture("sword", state);
        const sprite = new Sprite(tex!);
        sprite.anchor.set(0.5, 0.75);
        sprite.scale.set(this.facingLeft ? -this.scale : this.scale, this.scale);
        sprite.visible = state === "idle";
        this.container.addChild(sprite);
        sprites[state] = sprite;
      }
      this.sprites = sprites as Record<AnimState, Sprite>;
    }

    // A persistent ground ring under the hero this client owns (controllerId === mySeatId),
    // distinct from the transient gold-on-hover selection ring above it.
    this.ownerRing = new Graphics();
    this.ownerRing.visible = !!mySeatId && entity.controllerId === mySeatId;
    if (this.ownerRing.visible) {
      drawRoughEllipse(
        this.ownerRing,
        0,
        4,
        entity.collisionRadius + 9,
        entity.collisionRadius * 0.75,
        1,
        24,
        entity.id.length + 7,
      );
      this.ownerRing.stroke({ color: 0x4caf50, width: 2 });
    }
    this.container.addChildAt(this.ownerRing, 0);

    this.selectionRing = new Graphics();
    this.selectionRing.visible = false;
    this.container.addChildAt(this.selectionRing, 1);

    this.hpBg = new Graphics();
    this.container.addChild(this.hpBg);

    this.hpBar = new Graphics();
    this.container.addChild(this.hpBar);

    this.hpPreview = new Graphics();
    this.container.addChild(this.hpPreview);

    this.statusDots = new Graphics();
    this.container.addChild(this.statusDots);

    this.drawHpBar(entity);
    this.drawStatusDots(entity.statusEffects);

    const label = new Text({
      text: entity.name,
      style: { fontSize: 9, fill: 0x4a3728, fontFamily: "Georgia, serif" },
    });
    label.anchor.set(0.5);
    label.position.set(0, entity.collisionRadius + 12);
    this.container.addChild(label);
  }

  update(entity: Entity, isSelected: boolean, dt: number): void {
    if (this.isDead) {
      if (this.deathTimer < DEATH_DURATION) {
        this.deathTimer += dt;
        const t = Math.min(1, this.deathTimer / DEATH_DURATION);
        const targetAngle = this.facingLeft ? -Math.PI / 2 : Math.PI / 2;
        const sprite = this.sprites.hit;
        sprite.rotation = targetAngle * easeOutQuad(t);
        sprite.alpha = 1 - t * 0.4;
        if (t >= 1) {
          this.container.visible = false;
        }
      }
      return;
    }

    if (this.tweenProgress < 1) {
      const speed = this.isKnockback ? 2.8 : 1.6;
      this.tweenProgress = Math.min(1, this.tweenProgress + dt * speed);
      const t = easeOutQuad(this.tweenProgress);
      if (this.tweenPath) {
        const prevX = this.container.position.x;
        const p = pointAlongPolyline(this.tweenPath, t);
        this.container.position.set(p.x, p.y);
        // Face the direction of travel so the unit doesn't moonwalk around bends.
        if (Math.abs(p.x - prevX) > 0.5) this.setFacing(p.x < prevX);
      } else {
        const from = this.tweenFrom!;
        this.container.position.set(
          from.x + (entity.position.x - from.x) * t,
          from.y + (entity.position.y - from.y) * t
        );
      }
      if (this.tweenProgress >= 1) { this.isKnockback = false; this.tweenPath = null; }
    } else {
      this.container.position.set(entity.position.x, entity.position.y);
    }

    if (this.animTimer > 0) {
      this.animTimer -= dt;
      if (this.animTimer <= 0) {
        this.setAnimState("idle");
      }
    }

    if (this.tweenProgress < 1 && !this.isKnockback && this.animState !== "move") {
      this.setAnimState("move");
    }
    // Auto-revert "move" → "idle" when the position tween finishes. Guarded by animTimer so
    // that a manually-driven `move`-state animation (e.g. a bow's block dodge) plays out.
    if (this.tweenProgress >= 1 && this.animState === "move" && this.animTimer <= 0) {
      this.setAnimState("idle");
    }

    if (entity.hp !== this.lastHp || entity.barrier !== this.lastBarrier) {
      this.drawHpBar(entity);
      this.lastHp = entity.hp;
      this.lastBarrier = entity.barrier;
    }

    const statusCount = entity.statusEffects?.length ?? 0;
    if (statusCount !== this.lastStatusCount) {
      this.drawStatusDots(entity.statusEffects);
      this.lastStatusCount = statusCount;
    }

    if (isSelected !== this.wasSelected) {
      this.selectionRing.visible = isSelected;
      if (isSelected) {
        this.selectionRing.clear();
        const ringColor = entity.teamId === "red" ? 0x8b3a3a : 0x3a5a8b;
        drawRoughEllipse(
          this.selectionRing,
          0,
          3,
          entity.collisionRadius + 6,
          entity.collisionRadius * 0.7,
          1,
          24,
          entity.id.length
        );
        this.selectionRing.stroke({ color: ringColor, width: 1.5 });
      }
      this.wasSelected = isSelected;
    }
  }

  get isBusy(): boolean {
    if (this.isDead) return this.deathTimer < DEATH_DURATION;
    return this.tweenProgress < 1 || this.animTimer > 0;
  }

  triggerDeath(): void {
    this.isDead = true;
    this.deathTimer = 0;
    this.setAnimState("hit");
    this.selectionRing.visible = false;
    this.hpBar.visible = false;
    this.hpBg.visible = false;
    this.hpPreview.visible = false;
  }

  triggerMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    path?: readonly { x: number; y: number }[]
  ): void {
    this.tweenFrom = { x: fromX, y: fromY };
    this.tweenProgress = 0;
    // `path` is the full smoothed polyline (start → … → destination); null = straight tween.
    this.tweenPath = path && path.length > 1 ? path.map((p) => ({ x: p.x, y: p.y })) : null;

    const dx = toX - fromX;
    if (Math.abs(dx) > 1) {
      this.setFacing(dx < 0);
    }
  }

  triggerKnockback(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): void {
    this.tweenFrom = { x: fromX, y: fromY };
    this.tweenProgress = 0;
    this.tweenPath = null; // knockback is a straight shove, never a routed path
    this.isKnockback = true;
    this.setAnimState("hit");
    this.animTimer = 0.6;

    const dx = fromX - toX;
    if (Math.abs(dx) > 1) {
      this.setFacing(dx < 0);
    }
  }

  triggerAttack(targetX: number): void {
    const dx = targetX - this.container.position.x;
    if (Math.abs(dx) > 1) {
      this.setFacing(dx < 0);
    }
    this.setAnimState("attack");
    this.animTimer = 0.7;
  }

  triggerHit(): void {
    this.setAnimState("hit");
    this.animTimer = 0.6;
  }

  triggerBlock(attackerX: number): void {
    this.playBlockAnimation(attackerX, 0.55);
  }

  triggerPerfectBlock(attackerX: number): void {
    this.playBlockAnimation(attackerX, 0.65);
  }

  /** Pose for a block. There's no dedicated block sprite, so we reuse an existing state per
   *  weapon — most parry-style weapons (sword, spear, staff, two-handed, dual-wield) look right
   *  with the attack pose (a counter-swing); the bow reads better with the move pose (a quick
   *  dodge). Enemies fall through to the attack pose since they don't have a weapon animSet.
   *  Drop a new branch in here if a specific weapon should pose differently. */
  private playBlockAnimation(attackerX: number, holdSeconds: number): void {
    const dx = attackerX - this.container.position.x;
    if (Math.abs(dx) > 1) this.setFacing(dx < 0);
    const animSet = this.charSprite?.currentAnimSet ?? null;
    const useMoveSprite = animSet === "bow";
    this.setAnimState(useMoveSprite ? "move" : "attack");
    this.animTimer = holdSeconds;
  }

  setDamagePreview(damage: number, currentHp: number, maxHp: number, barrier: number): void {
    const layout = barLayout(currentHp, maxHp, barrier);
    this.redrawBarBase(layout);
    this.hpPreview.clear();
    this.hpPreview.visible = true;

    const barrierAbsorbed = Math.min(barrier, damage);
    const hpDamage = damage - barrierAbsorbed;
    const dmgRatio = Math.min(hpDamage / maxHp, layout.hpRatio);
    const wouldKill = hpDamage >= currentHp;

    if (dmgRatio > 0) {
      const previewX = layout.left + HP_BAR_W * (layout.hpRatio - dmgRatio);
      const previewW = HP_BAR_W * dmgRatio;
      this.hpPreview.roundRect(previewX, HP_BAR_Y, previewW, HP_BAR_H, 1);
      this.hpPreview.fill({ color: 0x000000, alpha: 0.7 });
    }

    if (barrierAbsorbed > 0) {
      const absorbedRatio = barrierAbsorbed / maxHp;
      const barrierStart = layout.left + HP_BAR_W * (layout.hpRatio + layout.barrierRatio - absorbedRatio);
      const barrierW = HP_BAR_W * absorbedRatio;
      if (barrierW > 0) {
        this.hpPreview.roundRect(barrierStart, HP_BAR_Y, barrierW, HP_BAR_H, 1);
        this.hpPreview.fill({ color: 0x2a5a8b, alpha: 0.7 });
      }
    }

    if (wouldKill) {
      this.hpPreview.roundRect(
        layout.left - 1, HP_BAR_Y - 1,
        layout.totalW + 2, HP_BAR_H + 2, 1
      );
      this.hpPreview.stroke({ color: 0xff0000, alpha: 0.8, width: 1.5 });

      const cx = 0;
      const cy = HP_BAR_Y + HP_BAR_H / 2;
      const s = 4;
      this.hpPreview.moveTo(cx - s, cy - s);
      this.hpPreview.lineTo(cx + s, cy + s);
      this.hpPreview.moveTo(cx + s, cy - s);
      this.hpPreview.lineTo(cx - s, cy + s);
      this.hpPreview.stroke({ color: 0xff0000, alpha: 0.9, width: 1.5 });
    }
  }

  setBarrierPreview(barrierHp: number, currentHp: number, maxHp: number, currentBarrier: number): void {
    const newBarrierRatio = barrierHp / maxHp;
    const layout = barLayout(currentHp, maxHp, currentBarrier, newBarrierRatio);
    this.redrawBarBase(layout);
    this.hpPreview.clear();
    this.hpPreview.visible = true;

    const previewX = layout.left + HP_BAR_W * (layout.hpRatio + layout.barrierRatio);
    const previewW = HP_BAR_W * newBarrierRatio;
    if (previewW > 0) {
      this.hpPreview.roundRect(previewX, HP_BAR_Y, previewW, HP_BAR_H, 1);
      this.hpPreview.fill({ color: 0x6ab8f7, alpha: 0.6 });
    }
  }

  clearDamagePreview(): void {
    this.hpPreview.clear();
    this.hpPreview.visible = false;
    if (this.lastHpRatio >= 1 && this.lastBarrier === 0) {
      this.hpBg.visible = false;
      this.hpBar.visible = false;
    }
  }

  private redrawBarBase(layout: BarLayout): void {
    this.hpBg.visible = true;
    this.hpBar.visible = true;

    this.hpBg.clear();
    this.hpBg.roundRect(layout.left - 1, HP_BAR_Y - 1, layout.totalW + 2, HP_BAR_H + 2, 1);
    this.hpBg.fill({ color: 0x3d3528, alpha: 0.7 });

    this.hpBar.clear();
    if (layout.hpRatio > 0) {
      this.hpBar.roundRect(layout.left, HP_BAR_Y, layout.hpW, HP_BAR_H, 1);
      this.hpBar.fill({ color: layout.hpColor });
    }
    if (layout.barrierRatio > 0) {
      this.hpBar.roundRect(layout.left + layout.hpW, HP_BAR_Y, HP_BAR_W * layout.barrierRatio, HP_BAR_H, 1);
      this.hpBar.fill({ color: 0x4a9adb });
    }
  }

  private setFacing(left: boolean): void {
    if (left === this.facingLeft) return;
    this.facingLeft = left;
    if (this.charSprite) {
      this.charSprite.setFacing(left);
    } else {
      for (const s of Object.values(this.sprites)) {
        s.scale.x = left ? -this.scale : this.scale;
      }
    }
  }

  private setAnimState(state: AnimState): void {
    if (this.animState === state) return;
    if (this.charSprite) {
      this.charSprite.setAnimState(state);
    } else {
      this.sprites[this.animState].visible = false;
      this.sprites[state].visible = true;
    }
    this.animState = state;
  }

  private drawHpBar(entity: Entity): void {
    this.lastHpRatio = entity.hp / entity.maxHp;
    const full = this.lastHpRatio >= 1 && entity.barrier === 0;
    this.hpBg.visible = !full;
    this.hpBar.visible = !full;
    if (full) return;

    this.redrawBarBase(barLayout(entity.hp, entity.maxHp, entity.barrier));
  }

  private drawStatusDots(statuses: readonly StatusEffect[] | undefined): void {
    this.statusDots.clear();
    if (!statuses || statuses.length === 0) {
      this.statusDots.visible = false;
      return;
    }
    this.statusDots.visible = true;
    const totalW = statuses.length * STATUS_DOT_SPACING;
    const startX = -totalW / 2 + STATUS_DOT_SPACING / 2;
    for (let i = 0; i < statuses.length; i++) {
      const color = STATUS_META[statuses[i]!.type]?.color ?? 0xffffff;
      this.statusDots.circle(startX + i * STATUS_DOT_SPACING, STATUS_DOT_Y, STATUS_DOT_RADIUS);
      this.statusDots.fill({ color });
    }
  }
}
