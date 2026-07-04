import { ColorMatrixFilter, Container, Graphics, Sprite, Text } from "pixi.js";
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

const DEATH_DURATION = 0.5;
const STATUS_CHIP_SIZE = 10;
const STATUS_CHIP_GAP = 3;
const STATUS_ROW_Y = HP_BAR_Y + HP_BAR_H + 4;
const CHIP_GLYPH = 0xfaf3e3;
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
  /**
   * PRESENTATION state — what is on screen right now, mutated only by sequencer clips (and
   * settle). The visual never reads the simulation's position/HP per frame: the simulation
   * commits its facts here at the clip beat where the motion says they happen.
   */
  readonly displayPos: { x: number; y: number };
  private shownHp: number;
  private shownMaxHp: number;
  private shownBarrier: number;
  private lastHpRatio: number;
  private facingLeft: boolean;
  private wasSelected = false;
  private readonly scale: number;
  private deathTimer = 0;
  private dead = false;
  private charSprite: CharacterSprite | null = null;
  private readonly statusDots: Graphics;
  private lastStatusSig = "";
  /** Attack-performance pose: a transient offset + squash composed over displayPos each frame
   *  (wind-up backoff, tension shiver, strike lunge). */
  private perfOffset = { x: 0, y: 0 };
  private perfSquash = { x: 1, y: 1 };
  /** Impact flash: a brief lerp-to-color on the body (red = hurt, grey = guard, white =
   *  perfect parry). A ColorMatrixFilter because tint can only darken — white needs additive. */
  private flashFilter: ColorMatrixFilter | null = null;
  private flashTimer = 0;
  private flashDuration = 0;
  private flashColor = { r: 1, g: 0, b: 0 };

  constructor(entity: Entity, mySeatId: string | null = null) {
    this.entityId = entity.id;
    this.entitySprites = entity.sprites;
    this.heightMeters = entity.heightMeters ?? 2;
    this.displayPos = { x: entity.position.x, y: entity.position.y };
    this.shownHp = entity.hp;
    this.shownMaxHp = entity.maxHp;
    this.shownBarrier = entity.barrier;
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

    this.redrawVitals();
    this.drawStatusChips(entity.statusEffects);

    const label = new Text({
      text: entity.name,
      style: { fontSize: 9, fill: 0x4a3728, fontFamily: "Georgia, serif" },
    });
    label.anchor.set(0.5);
    label.position.set(0, entity.collisionRadius + 12);
    this.container.addChild(label);
  }

  update(entity: Entity, isSelected: boolean, dt: number): void {
    if (this.dead) {
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

    this.container.position.set(this.displayPos.x + this.perfOffset.x, this.displayPos.y + this.perfOffset.y);

    if (this.animTimer > 0) {
      this.animTimer -= dt;
      if (this.animTimer <= 0) {
        this.setAnimState("idle");
      }
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.detachFlash();
      else this.applyFlash();
    }

    const statusSig = entity.statusEffects?.map((s) => `${s.type}:${s.duration}`).join() ?? "";
    if (statusSig !== this.lastStatusSig) {
      this.drawStatusChips(entity.statusEffects);
      this.lastStatusSig = statusSig;
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
    if (this.dead) return this.deathTimer < DEATH_DURATION;
    return this.animTimer > 0 || this.flashTimer > 0;
  }

  get isDead(): boolean {
    return this.dead;
  }

  triggerDeath(): void {
    if (this.dead) return;
    this.dead = true;
    this.deathTimer = 0;
    this.flashTimer = 0;
    this.detachFlash();
    this.setAnimState("hit");
    this.selectionRing.visible = false;
    this.hpBar.visible = false;
    this.hpBg.visible = false;
    this.hpPreview.visible = false;
  }

  /** Settle-time death for an entity whose death clip never played (resync/reconnect). */
  forceDead(): void {
    if (this.dead) return;
    this.triggerDeath();
    this.deathTimer = DEATH_DURATION;
    this.container.visible = false;
  }

  /** Move the on-screen body (sequencer clips only). */
  moveDisplayTo(x: number, y: number): void {
    if (Math.abs(x - this.displayPos.x) > 0.5) this.setFacing(x < this.displayPos.x);
    this.displayPos.x = x;
    this.displayPos.y = y;
  }

  /** Commit the on-screen HP/barrier (sequencer clips at impact beats, or settle). */
  commitVitals(hp: number, maxHp: number, barrier: number): void {
    if (this.dead) return;
    if (hp === this.shownHp && maxHp === this.shownMaxHp && barrier === this.shownBarrier) return;
    this.shownHp = hp;
    this.shownMaxHp = maxHp;
    this.shownBarrier = barrier;
    this.redrawVitals();
  }

  startMovePose(): void {
    this.setAnimState("move");
  }

  endMovePose(): void {
    if (this.animState === "move" && this.animTimer <= 0) this.setAnimState("idle");
  }

  /** Knockback/pull reaction: face the shove's origin and flinch. */
  triggerShoved(originX: number): void {
    const dx = originX - this.displayPos.x;
    if (Math.abs(dx) > 1) this.setFacing(dx < 0);
    this.setAnimState("hit");
    this.animTimer = 0.6;
  }

  triggerAttack(targetX: number): void {
    const dx = targetX - this.displayPos.x;
    if (Math.abs(dx) > 1) {
      this.setFacing(dx < 0);
    }
    this.setAnimState("attack");
    this.animTimer = 0.7;
  }

  /** Compose an attack-performance pose over the authoritative position/scale. Squash is
   *  applied to the body sprites only (never the HP bar / rings). */
  setPerformancePose(offsetX: number, offsetY: number, squashX: number, squashY: number): void {
    this.perfOffset.x = offsetX;
    this.perfOffset.y = offsetY;
    if (squashX !== this.perfSquash.x || squashY !== this.perfSquash.y) {
      this.perfSquash = { x: squashX, y: squashY };
      this.applySquash();
    }
  }

  clearPerformancePose(): void {
    this.setPerformancePose(0, 0, 1, 1);
  }

  private applySquash(): void {
    const sx = (this.facingLeft ? -this.scale : this.scale) * this.perfSquash.x;
    const sy = this.scale * this.perfSquash.y;
    for (const s of Object.values(this.sprites)) {
      s.scale.set(sx, sy);
    }
  }

  triggerHit(): void {
    this.setAnimState("hit");
    this.animTimer = 0.6;
  }

  /** Red flash: a hit landed. Long and saturated enough to survive the bright shockwave
   *  front passing over the sprite on the same beat. */
  flashHit(): void {
    this.startFlash(1, 0.26, 0.2, 0.35);
  }

  /** Grey flash: a decent guard — absorbed most of it. */
  flashGuard(): void {
    this.startFlash(0.62, 0.62, 0.68, 0.3);
  }

  /** White flash: a perfect parry. */
  flashPerfect(): void {
    this.startFlash(1, 1, 1, 0.35);
  }

  private startFlash(r: number, g: number, b: number, duration: number): void {
    this.flashColor = { r, g, b };
    this.flashDuration = duration;
    this.flashTimer = duration;
    if (!this.flashFilter) this.flashFilter = new ColorMatrixFilter();
    // Body + weapon for character sprites; the loose body sprites for enemies.
    const targets: Container[] = this.charSprite ? [this.charSprite.container] : Object.values(this.sprites);
    for (const t of targets) t.filters = [this.flashFilter];
    this.applyFlash();
  }

  /** out = pixel·(1−a) + color·a, with `a` decaying from a strong peak over the flash. */
  private applyFlash(): void {
    if (!this.flashFilter) return;
    const a = 0.8 * (this.flashTimer / this.flashDuration);
    const { r, g, b } = this.flashColor;
    // prettier-ignore
    this.flashFilter.matrix = [
      1 - a, 0, 0, 0, r * a,
      0, 1 - a, 0, 0, g * a,
      0, 0, 1 - a, 0, b * a,
      0, 0, 0, 1, 0,
    ];
  }

  /** Remove the filter entirely when idle — an attached identity filter still costs a pass. */
  private detachFlash(): void {
    const targets: Container[] = this.charSprite ? [this.charSprite.container] : Object.values(this.sprites);
    for (const t of targets) t.filters = null;
  }

  /** Turn to face a world x (used at wind-up start so the telegraph reads immediately). */
  faceToward(targetX: number): void {
    const dx = targetX - this.displayPos.x;
    if (Math.abs(dx) > 1) this.setFacing(dx < 0);
  }

  triggerBlock(attackerX: number, holdSeconds = 0.55): void {
    this.playBlockAnimation(attackerX, holdSeconds);
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
    const dx = attackerX - this.displayPos.x;
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
    if (this.lastHpRatio >= 1 && this.shownBarrier === 0) {
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
    if (this.perfSquash.x !== 1 || this.perfSquash.y !== 1) this.applySquash();
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

  private redrawVitals(): void {
    this.lastHpRatio = this.shownHp / this.shownMaxHp;
    const full = this.lastHpRatio >= 1 && this.shownBarrier === 0;
    this.hpBg.visible = !full;
    this.hpBar.visible = !full;
    if (full) return;

    this.redrawBarBase(barLayout(this.shownHp, this.shownMaxHp, this.shownBarrier));
  }

  /** Status chips: a color-filled tag per active status with a small glyph in the sketch
   *  vocabulary (the slowed chevrons match the "status applied" rain), plus one tick per
   *  remaining turn beneath it. */
  private drawStatusChips(statuses: readonly StatusEffect[] | undefined): void {
    const g = this.statusDots;
    g.clear();
    if (!statuses || statuses.length === 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const n = statuses.length;
    const totalW = n * STATUS_CHIP_SIZE + (n - 1) * STATUS_CHIP_GAP;
    for (let i = 0; i < n; i++) {
      const status = statuses[i]!;
      const color = STATUS_META[status.type]?.color ?? 0xffffff;
      const x = -totalW / 2 + i * (STATUS_CHIP_SIZE + STATUS_CHIP_GAP);
      const y = STATUS_ROW_Y;
      g.roundRect(x, y, STATUS_CHIP_SIZE, STATUS_CHIP_SIZE, 2.5);
      g.fill({ color, alpha: 0.92 });
      g.stroke({ color: 0x3c2f1c, alpha: 0.75, width: 1 });
      this.drawStatusGlyph(g, status.type, x + STATUS_CHIP_SIZE / 2, y + STATUS_CHIP_SIZE / 2);
      // Duration ticks — one per remaining turn (capped so the row can't sprawl).
      const ticks = Math.min(status.duration, 3);
      for (let t = 0; t < ticks; t++) {
        g.rect(x + 1.5 + t * 3, y + STATUS_CHIP_SIZE + 1.5, 2, 2);
        g.fill({ color, alpha: 0.9 });
      }
    }
  }

  private drawStatusGlyph(g: Graphics, type: StatusEffect["type"], cx: number, cy: number): void {
    switch (type) {
      case "slowed":
        // Double down-chevron — same vocabulary as the status-applied rain.
        g.moveTo(cx - 2.8, cy - 2.8);
        g.lineTo(cx, cy - 0.8);
        g.lineTo(cx + 2.8, cy - 2.8);
        g.moveTo(cx - 2.8, cy + 0.6);
        g.lineTo(cx, cy + 2.6);
        g.lineTo(cx + 2.8, cy + 0.6);
        g.stroke({ color: CHIP_GLYPH, width: 1.3 });
        break;
      case "rooted":
        // A trunk splitting into roots.
        g.moveTo(cx, cy - 3);
        g.lineTo(cx, cy + 0.5);
        g.moveTo(cx, cy + 0.5);
        g.lineTo(cx - 2.6, cy + 3);
        g.moveTo(cx, cy + 0.5);
        g.lineTo(cx + 2.6, cy + 3);
        g.stroke({ color: CHIP_GLYPH, width: 1.3 });
        break;
      case "suppressed":
        // A crossed-out pip — the attack pool is being drained.
        g.circle(cx, cy, 2.3);
        g.stroke({ color: CHIP_GLYPH, width: 1.2 });
        g.moveTo(cx - 3, cy + 3);
        g.lineTo(cx + 3, cy - 3);
        g.stroke({ color: CHIP_GLYPH, width: 1.2 });
        break;
      case "winded":
        // Wind dashes — the move pool is being drained.
        g.moveTo(cx - 3, cy - 2);
        g.lineTo(cx + 2, cy - 2);
        g.moveTo(cx - 2, cy);
        g.lineTo(cx + 3, cy);
        g.moveTo(cx - 3, cy + 2);
        g.lineTo(cx + 1.5, cy + 2);
        g.stroke({ color: CHIP_GLYPH, width: 1.2 });
        break;
    }
  }
}
