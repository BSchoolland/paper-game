import { Application, Graphics } from "pixi.js";

const WASH_COLOR = 0x1a140e;
const FADE_IN_DURATION = 0.45;
const HOLD_DURATION = 0.3;
const FADE_OUT_DURATION = 0.5;

type Phase = "fadeIn" | "hold" | "fadeOut" | "idle";

export class IrisTransition {
  private gfx = new Graphics();
  private phase: Phase = "idle";
  private timer = 0;
  private onMidpoint: (() => void) | null = null;
  private onComplete: (() => void) | null = null;

  constructor(private app: Application) {
    this.gfx.visible = false;
    this.app.stage.addChild(this.gfx);

    this.app.ticker.add((ticker) => {
      if (this.phase === "idle") return;
      this.tick(ticker.deltaTime / 60);
    });
  }

  bringToFront() {
    this.app.stage.removeChild(this.gfx);
    this.app.stage.addChild(this.gfx);
  }

  play(
    _cx: number,
    _cy: number,
    onMidpoint: () => void,
    onComplete: () => void
  ) {
    this.onMidpoint = onMidpoint;
    this.onComplete = onComplete;
    this.phase = "fadeIn";
    this.timer = 0;
    this.gfx.visible = true;
    this.drawFrame(0);
  }

  private tick(dt: number) {
    this.timer += dt;

    if (this.phase === "fadeIn") {
      const t = Math.min(1, this.timer / FADE_IN_DURATION);
      this.drawFrame(easeInQuad(t));
      if (t >= 1) {
        this.phase = "hold";
        this.timer = 0;
        this.drawFrame(1);
        if (this.onMidpoint) {
          this.onMidpoint();
          this.onMidpoint = null;
        }
      }
    } else if (this.phase === "hold") {
      if (this.timer >= HOLD_DURATION) {
        this.phase = "fadeOut";
        this.timer = 0;
      }
    } else if (this.phase === "fadeOut") {
      const t = Math.min(1, this.timer / FADE_OUT_DURATION);
      this.drawFrame(1 - easeOutQuad(t));
      if (t >= 1) {
        this.phase = "idle";
        this.gfx.visible = false;
        this.gfx.clear();
        if (this.onComplete) {
          this.onComplete();
          this.onComplete = null;
        }
      }
    }
  }

  private drawFrame(alpha: number) {
    this.gfx.clear();
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    this.gfx.rect(0, 0, screenW, screenH);
    this.gfx.fill({ color: WASH_COLOR, alpha });
  }
}

function easeInQuad(t: number): number {
  return t * t;
}

function easeOutQuad(t: number): number {
  return t * (2 - t);
}
