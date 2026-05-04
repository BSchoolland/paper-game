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
const SPRITE_Y_OFFSET = -8;

export interface EntityVisual {
  container: Container;
  sprites: Record<AnimState, Sprite>;
  hpBar: Graphics;
  hpBg: Graphics;
  selectionRing: Graphics;
  label: Text;
  animState: AnimState;
  animTimer: number;
  entityId: string;
  lastHp: number;
  lastPosition: { x: number; y: number };
  tweenFrom: { x: number; y: number } | null;
  tweenProgress: number;
  facingLeft: boolean;
}

export function createEntityVisual(entity: Entity): EntityVisual {
  const container = new Container();
  container.position.set(entity.position.x, entity.position.y);

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
    container.addChild(sprite);
    sprites[state] = sprite;
  }

  const facingLeft = entity.teamId === "blue";
  if (facingLeft) {
    for (const s of Object.values(sprites)) {
      s.scale.x = -SPRITE_SCALE;
    }
  }

  const selectionRing = new Graphics();
  selectionRing.visible = false;
  container.addChildAt(selectionRing, 0);

  const hpBg = new Graphics();
  container.addChild(hpBg);

  const hpBar = new Graphics();
  container.addChild(hpBar);

  drawHpBar(hpBg, hpBar, entity);

  const label = new Text({
    text: entity.name,
    style: { fontSize: 9, fill: 0x4a3728, fontFamily: "Georgia, serif" },
  });
  label.anchor.set(0.5);
  label.position.set(0, entity.collisionRadius + 12);
  container.addChild(label);

  return {
    container,
    sprites: sprites as Record<AnimState, Sprite>,
    hpBar,
    hpBg,
    selectionRing,
    label,
    animState: "idle",
    animTimer: 0,
    entityId: entity.id,
    lastHp: entity.hp,
    lastPosition: { x: entity.position.x, y: entity.position.y },
    tweenFrom: null,
    tweenProgress: 1,
    facingLeft,
  };
}

export function updateEntityVisual(
  visual: EntityVisual,
  entity: Entity,
  isSelected: boolean,
  dt: number
): void {
  if (visual.tweenProgress < 1) {
    visual.tweenProgress = Math.min(1, visual.tweenProgress + dt * 1.6);
    const t = easeOutQuad(visual.tweenProgress);
    const from = visual.tweenFrom!;
    visual.container.position.set(
      from.x + (entity.position.x - from.x) * t,
      from.y + (entity.position.y - from.y) * t
    );
  } else {
    visual.container.position.set(entity.position.x, entity.position.y);
  }

  if (visual.animTimer > 0) {
    visual.animTimer -= dt;
    if (visual.animTimer <= 0) {
      setAnimState(visual, "idle");
    }
  }

  if (visual.tweenProgress < 1 && visual.animState !== "move") {
    setAnimState(visual, "move");
  }
  if (visual.tweenProgress >= 1 && visual.animState === "move") {
    setAnimState(visual, "idle");
  }

  for (const s of Object.values(visual.sprites)) {
    s.alpha = 1.0;
  }

  drawHpBar(visual.hpBg, visual.hpBar, entity);

  visual.selectionRing.visible = isSelected;
  if (isSelected) {
    visual.selectionRing.clear();
    const ringColor = entity.teamId === "red" ? 0x8b3a3a : 0x3a5a8b;
    drawRoughEllipse(
      visual.selectionRing,
      0,
      3,
      entity.collisionRadius + 6,
      entity.collisionRadius * 0.7,
      1,
      24,
      entity.id.length
    );
    visual.selectionRing.stroke({ color: ringColor, width: 1.5 });
  }

  visual.lastHp = entity.hp;
  visual.lastPosition = { x: entity.position.x, y: entity.position.y };
}

export function triggerMove(
  visual: EntityVisual,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): void {
  visual.tweenFrom = { x: fromX, y: fromY };
  visual.tweenProgress = 0;

  const dx = toX - fromX;
  if (Math.abs(dx) > 1) {
    const shouldFaceLeft = dx < 0;
    if (shouldFaceLeft !== visual.facingLeft) {
      visual.facingLeft = shouldFaceLeft;
      for (const s of Object.values(visual.sprites)) {
        s.scale.x = shouldFaceLeft ? -SPRITE_SCALE : SPRITE_SCALE;
      }
    }
  }
}

export function triggerAttack(visual: EntityVisual, targetX: number): void {
  const dx = targetX - visual.container.position.x;
  if (Math.abs(dx) > 1) {
    const shouldFaceLeft = dx < 0;
    if (shouldFaceLeft !== visual.facingLeft) {
      visual.facingLeft = shouldFaceLeft;
      for (const s of Object.values(visual.sprites)) {
        s.scale.x = shouldFaceLeft ? -SPRITE_SCALE : SPRITE_SCALE;
      }
    }
  }
  setAnimState(visual, "attack");
  visual.animTimer = 0.7;
}

export function triggerHit(visual: EntityVisual): void {
  setAnimState(visual, "hit");
  visual.animTimer = 0.6;
}

function setAnimState(visual: EntityVisual, state: AnimState): void {
  if (visual.animState === state) return;
  visual.sprites[visual.animState].visible = false;
  visual.sprites[state].visible = true;
  visual.animState = state;
}

function drawHpBar(bg: Graphics, bar: Graphics, entity: Entity): void {
  bg.clear();
  bg.roundRect(-HP_BAR_W / 2 - 1, HP_BAR_Y - 1, HP_BAR_W + 2, HP_BAR_H + 2, 1);
  bg.fill({ color: 0x3d3528, alpha: 0.7 });

  const hpRatio = entity.hp / entity.maxHp;
  const hpColor =
    hpRatio > 0.6 ? 0x5a7a3a : hpRatio > 0.3 ? 0x8b7a3a : 0x8b3a3a;

  bar.clear();
  if (hpRatio > 0) {
    bar.roundRect(-HP_BAR_W / 2, HP_BAR_Y, HP_BAR_W * hpRatio, HP_BAR_H, 1);
    bar.fill({ color: hpColor });
  }
}

function easeOutQuad(t: number): number {
  return t * (2 - t);
}
