import type { HexCoord, AnimSet, ItemDefinition, AttachmentData } from "shared";
import { hexToPixel } from "shared";
import { CharacterSprite } from "./character-sprite.js";
import type { AnimState } from "./sprite-assets.js";

const TARGET_MAP_HEIGHT = 50;
const MOVE_SPEED = 1.2;
const DEFAULT_ANIM_SET: AnimSet = "sword";
const MAP_STATES: AnimState[] = ["idle", "move"];

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export class HexPlayerTween {
  readonly charSprite: CharacterSprite;

  private tweenFrom: { x: number; y: number } | null = null;
  private tweenTo: { x: number; y: number } | null = null;
  private tweenProgress = 1;
  private _animating = false;
  private pendingCallbacks: (() => void)[] = [];

  constructor(private hexSize: number) {
    this.charSprite = new CharacterSprite(
      DEFAULT_ANIM_SET,
      MAP_STATES,
      TARGET_MAP_HEIGHT,
    );
  }

  setAnimSet(animSet: AnimSet) {
    this.charSprite.setAnimSet(animSet);
  }

  setEquipment(
    equipped: readonly ItemDefinition[],
    attachments: Record<string, AttachmentData>,
  ): void {
    this.charSprite.setEquipment(equipped, attachments);
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

    this.charSprite.setFacing(to.x < from.x);
    this.charSprite.setAnimState("move");
    this.charSprite.container.position.set(from.x, from.y);
  }

  onComplete(cb: () => void) {
    if (!this._animating) {
      cb();
    } else {
      this.pendingCallbacks.push(cb);
    }
  }

  placeIdle(x: number, y: number) {
    this.charSprite.container.position.set(x, y);
    this.charSprite.setAnimState("idle");
  }

  tick(dt: number): { x: number; y: number } | null {
    if (!this._animating || !this.tweenFrom || !this.tweenTo) return null;

    this.tweenProgress = Math.min(1, this.tweenProgress + dt * MOVE_SPEED);
    const t = easeInOutQuad(this.tweenProgress);

    const x = this.tweenFrom.x + (this.tweenTo.x - this.tweenFrom.x) * t;
    const y = this.tweenFrom.y + (this.tweenTo.y - this.tweenFrom.y) * t;
    this.charSprite.container.position.set(x, y);

    if (this.tweenProgress >= 1) {
      this._animating = false;
      this.charSprite.setAnimState("idle");
      this.tweenFrom = null;
      this.tweenTo = null;

      const cbs = this.pendingCallbacks.splice(0);
      for (const cb of cbs) cb();
    }

    return { x, y };
  }
}
