import { Container, Graphics } from "pixi.js";

export interface FlashOptions {
  /** Peak alpha at the start of the flash. Default 0.6. */
  intensity?: number;
  /** Seconds for the flash to fade from intensity to 0. Default 0.25. */
  duration?: number;
  /** Tint color. Default white. */
  color?: number;
}

/**
 * A reusable full-screen flash overlay. Drop one on top of the scene, call `trigger()` whenever
 * you want a quick light burst (perfect block, big hit confirm, level-up cue), then `tick(dt)`
 * each frame from the main update loop. Multiple triggers stack on the maximum, not the sum,
 * so rapid retriggers don't blow out the screen.
 */
export class ScreenFlash {
  private gfx = new Graphics();
  private timer = 0;
  private duration = 0.25;
  private intensity = 0;
  private color = 0xffffff;
  private width = 0;
  private height = 0;

  constructor(parent: Container) {
    this.gfx.alpha = 0;
    parent.addChild(this.gfx);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.redraw();
  }

  trigger(opts: FlashOptions = {}) {
    const intensity = opts.intensity ?? 0.6;
    const duration = opts.duration ?? 0.25;
    const color = opts.color ?? 0xffffff;

    if (intensity * (duration > 0 ? 1 : 0) > this.intensity * Math.max(0, this.timer / this.duration)) {
      this.intensity = intensity;
      this.duration = duration;
      this.timer = duration;
      this.color = color;
      this.redraw();
    }
  }

  tick(dt: number) {
    if (this.timer <= 0) {
      if (this.gfx.alpha !== 0) this.gfx.alpha = 0;
      return;
    }
    this.timer = Math.max(0, this.timer - dt);
    const t = this.timer / this.duration;
    this.gfx.alpha = this.intensity * t;
  }

  get active(): boolean {
    return this.timer > 0;
  }

  destroy() {
    this.gfx.destroy();
  }

  private redraw() {
    this.gfx.clear();
    if (this.width === 0 || this.height === 0) return;
    this.gfx.rect(0, 0, this.width, this.height);
    this.gfx.fill({ color: this.color, alpha: 1 });
  }
}
