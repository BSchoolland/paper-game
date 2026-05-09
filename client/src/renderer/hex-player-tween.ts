import { Sprite } from "pixi.js";
import type { HexCoord, AnimSet } from "shared";
import { hexToPixel } from "shared";
import { getPlayerTexture } from "./sprite-assets.js";

const TARGET_MAP_HEIGHT = 50;
const MOVE_SPEED = 1.2;
const DEFAULT_ANIM_SET: AnimSet = "sword";

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export class HexPlayerTween {
  readonly idleSprite: Sprite;
  readonly moveSprite: Sprite;

  private tweenFrom: { x: number; y: number } | null = null;
  private tweenTo: { x: number; y: number } | null = null;
  private tweenProgress = 1;
  private _animating = false;
  private pendingCallbacks: (() => void)[] = [];
  private animSet: AnimSet = DEFAULT_ANIM_SET;

  private scale: number;

  constructor(private hexSize: number) {
    const idleTex = getPlayerTexture(DEFAULT_ANIM_SET, "idle");
    this.scale = TARGET_MAP_HEIGHT / idleTex.height;
    this.idleSprite = new Sprite(idleTex);
    this.idleSprite.anchor.set(0.5, 0.75);
    this.idleSprite.scale.set(this.scale);

    const moveTex = getPlayerTexture(DEFAULT_ANIM_SET, "move");
    this.moveSprite = new Sprite(moveTex);
    this.moveSprite.anchor.set(0.5, 0.75);
    this.moveSprite.scale.set(this.scale);
    this.moveSprite.visible = false;
  }

  setAnimSet(animSet: AnimSet) {
    if (animSet === this.animSet) return;
    this.animSet = animSet;
    this.idleSprite.texture = getPlayerTexture(animSet, "idle");
    this.moveSprite.texture = getPlayerTexture(animSet, "move");
  }

  get animating(): boolean {
    return this._animating;
  }

  startMove(fromCoord: HexCoord, target: HexCoord) {
    const from = hexToPixel(fromCoord, this.hexSize);
    const to = hexToPixel(target, this.hexSize);

    this.tweenFrom = from;
    this.tweenTo = to;
    this.tweenProgress = 0;
    this._animating = true;

    if (to.x < from.x) {
      this.moveSprite.scale.x = -this.scale;
    } else {
      this.moveSprite.scale.x = this.scale;
    }

    this.idleSprite.visible = false;
    this.moveSprite.visible = true;
    this.moveSprite.position.set(from.x, from.y);
  }

  onComplete(cb: () => void) {
    if (!this._animating) {
      cb();
    } else {
      this.pendingCallbacks.push(cb);
    }
  }

  placeIdle(x: number, y: number) {
    this.idleSprite.position.set(x, y);
    this.idleSprite.visible = true;
    this.moveSprite.visible = false;
  }

  tick(dt: number): { x: number; y: number } | null {
    if (!this._animating || !this.tweenFrom || !this.tweenTo) return null;

    this.tweenProgress = Math.min(1, this.tweenProgress + dt * MOVE_SPEED);
    const t = easeInOutQuad(this.tweenProgress);

    const x = this.tweenFrom.x + (this.tweenTo.x - this.tweenFrom.x) * t;
    const y = this.tweenFrom.y + (this.tweenTo.y - this.tweenFrom.y) * t;
    this.moveSprite.position.set(x, y);

    if (this.tweenProgress >= 1) {
      this._animating = false;
      this.moveSprite.visible = false;
      this.idleSprite.visible = true;
      this.idleSprite.position.set(this.tweenTo.x, this.tweenTo.y);
      this.tweenFrom = null;
      this.tweenTo = null;

      const cbs = this.pendingCallbacks.splice(0);
      for (const cb of cbs) cb();
    }

    return { x, y };
  }
}
