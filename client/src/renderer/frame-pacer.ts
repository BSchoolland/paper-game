import type { Ticker } from "pixi.js";

const ACTIVE_FPS = 60;
const IDLE_FPS = 15;

export class FramePacer {
  private activeCount = 0;

  constructor(private ticker: Ticker) {
    this.ticker.maxFPS = IDLE_FPS;
  }

  request() {
    this.activeCount++;
    if (this.activeCount === 1) this.ticker.maxFPS = ACTIVE_FPS;
  }

  release() {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.activeCount === 0) this.ticker.maxFPS = IDLE_FPS;
  }
}
