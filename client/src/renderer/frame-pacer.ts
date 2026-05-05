import type { Ticker } from "pixi.js";

const IDLE_FPS = 15;

export type PacerToken = number;

export class FramePacer {
  private nextId = 0;
  private active = new Map<PacerToken, number>();

  constructor(private ticker: Ticker) {
    this.ticker.maxFPS = IDLE_FPS;
  }

  request(fps = 60): PacerToken {
    const token = this.nextId++;
    this.active.set(token, fps);
    this.apply();
    return token;
  }

  release(token: PacerToken) {
    this.active.delete(token);
    this.apply();
  }

  private apply() {
    let max = IDLE_FPS;
    for (const fps of this.active.values()) {
      if (fps > max) max = fps;
    }
    this.ticker.maxFPS = max;
  }
}
