import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Entity } from "shared";
import {
  type AnimState,
  getSpriteTexture,
  weaponToUnitType,
} from "./sprite-assets.js";
import { drawRoughEllipse } from "./sketch-utils.js";

const HP_BAR_W = 40;
const HP_BAR_H = 5;
const HP_BAR_Y = -42;
const SPRITE_SCALE = 0.2;

function easeOutQuad(t: number): number {
  return t * (2 - t);
}

export class EntityVisual {
  readonly container: Container;
  readonly sprites: Record<AnimState, Sprite>;
  private readonly hpBar: Graphics;
  private readonly hpBg: Graphics;
  private readonly selectionRing: Graphics;
  private animState: AnimState = "idle";
  private animTimer = 0;
  readonly entityId: string;
  private lastHp: number;
  private tweenFrom: { x: number; y: number } | null = null;
  private tweenProgress = 1;
  private facingLeft: boolean;
  private wasSelected = false;

  constructor(entity: Entity) {
    this.entityId = entity.id;
    this.lastHp = entity.hp;
    this.facingLeft = entity.teamId === "blue";

    this.container = new Container();
    this.container.position.set(entity.position.x, entity.position.y);

    const unitType = weaponToUnitType(entity.weapon.id);
    const team = entity.teamId as "red" | "blue";
    const states: AnimState[] = ["idle", "attack", "hit", "move"];
    const sprites: Record<string, Sprite> = {};

    for (const state of states) {
      const tex = getSpriteTexture(team, unitType, state);
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 0.75);
      sprite.scale.set(SPRITE_SCALE);
      sprite.position.set(0, 0);
      sprite.visible = state === "idle";
      this.container.addChild(sprite);
      sprites[state] = sprite;
    }

    if (this.facingLeft) {
      for (const s of Object.values(sprites)) {
        s.scale.x = -SPRITE_SCALE;
      }
    }

    this.sprites = sprites as Record<AnimState, Sprite>;

    this.selectionRing = new Graphics();
    this.selectionRing.visible = false;
    this.container.addChildAt(this.selectionRing, 0);

    this.hpBg = new Graphics();
    this.container.addChild(this.hpBg);

    this.hpBar = new Graphics();
    this.container.addChild(this.hpBar);

    this.drawHpBar(entity);

    const label = new Text({
      text: entity.name,
      style: { fontSize: 9, fill: 0x4a3728, fontFamily: "Georgia, serif" },
    });
    label.anchor.set(0.5);
    label.position.set(0, entity.collisionRadius + 12);
    this.container.addChild(label);
  }

  update(entity: Entity, isSelected: boolean, dt: number): void {
    if (this.tweenProgress < 1) {
      this.tweenProgress = Math.min(1, this.tweenProgress + dt * 1.6);
      const t = easeOutQuad(this.tweenProgress);
      const from = this.tweenFrom!;
      this.container.position.set(
        from.x + (entity.position.x - from.x) * t,
        from.y + (entity.position.y - from.y) * t
      );
    } else {
      this.container.position.set(entity.position.x, entity.position.y);
    }

    if (this.animTimer > 0) {
      this.animTimer -= dt;
      if (this.animTimer <= 0) {
        this.setAnimState("idle");
      }
    }

    if (this.tweenProgress < 1 && this.animState !== "move") {
      this.setAnimState("move");
    }
    if (this.tweenProgress >= 1 && this.animState === "move") {
      this.setAnimState("idle");
    }

    if (entity.hp !== this.lastHp) {
      this.drawHpBar(entity);
      this.lastHp = entity.hp;
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

  triggerMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): void {
    this.tweenFrom = { x: fromX, y: fromY };
    this.tweenProgress = 0;

    const dx = toX - fromX;
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

  private setFacing(left: boolean): void {
    if (left === this.facingLeft) return;
    this.facingLeft = left;
    for (const s of Object.values(this.sprites)) {
      s.scale.x = left ? -SPRITE_SCALE : SPRITE_SCALE;
    }
  }

  private setAnimState(state: AnimState): void {
    if (this.animState === state) return;
    this.sprites[this.animState].visible = false;
    this.sprites[state].visible = true;
    this.animState = state;
  }

  private drawHpBar(entity: Entity): void {
    this.hpBg.clear();
    this.hpBg.roundRect(
      -HP_BAR_W / 2 - 1,
      HP_BAR_Y - 1,
      HP_BAR_W + 2,
      HP_BAR_H + 2,
      1
    );
    this.hpBg.fill({ color: 0x3d3528, alpha: 0.7 });

    const hpRatio = entity.hp / entity.maxHp;
    const hpColor =
      hpRatio > 0.6 ? 0x5a7a3a : hpRatio > 0.3 ? 0x8b7a3a : 0x8b3a3a;

    this.hpBar.clear();
    if (hpRatio > 0) {
      this.hpBar.roundRect(
        -HP_BAR_W / 2,
        HP_BAR_Y,
        HP_BAR_W * hpRatio,
        HP_BAR_H,
        1
      );
      this.hpBar.fill({ color: hpColor });
    }
  }
}
