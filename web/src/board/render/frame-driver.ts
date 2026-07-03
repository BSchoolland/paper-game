import type { Application } from "pixi.js";

/** A per-frame animation step. Receives real elapsed seconds; returns whether it still needs frames
 *  (return `false` to unregister, e.g. once a tween reaches its end). */
export type FrameUpdater = (dtSeconds: number) => boolean;

// Clamp long gaps (tab switch, GC pause) so tweens advance a sane amount instead of teleporting —
// mirrors Pixi's own default maxElapsedMS of 100ms.
const MAX_DT = 0.1;

// Cap sustained painting on high-refresh displays. rAF fires per vsync, and presenting a
// fullscreen canvas costs the iGPU compositor work per frame regardless of content — uncapped
// animation pegs the GPU at max clock (docs/gpu-profiling.md). 11ms skips every 2nd vsync at
// 120Hz+ (82fps on a 165Hz panel — halves the GPU cost, visually near-native) and never skips
// at 60–90Hz.
const MIN_PAINT_MS = 11;

/**
 * Owns every paint for the board. There is no free-running loop: the GPU is drawn only when asked,
 * so a static board costs nothing. Two roles share ONE rAF and ONE dirty flag — that sharing is the
 * point, because a discrete repaint requested mid-animation must fold into the animation's own frame
 * rather than double-render or land a frame late:
 *
 *  - `invalidate()` — a discrete change needs one repaint. Schedules a single frame; then idle.
 *  - `requestFrames(update)` — continuous animation. While any updater is registered, a self-stopping
 *    loop advances each by real delta-seconds and paints once per frame; when they all return `false`
 *    the loop stops and the GPU sleeps.
 */
export class FrameDriver {
  private updaters = new Set<FrameUpdater>();
  private dirty = false;
  private rafId = 0;
  private lastTime = 0;
  private lastPaint = 0;
  private inFrame = false;

  constructor(private app: Application) {}

  /** Request one repaint on the next frame. Safe to call from anywhere, including inside an updater. */
  invalidate(): void {
    this.dirty = true;
    this.ensureRunning();
  }

  /** Register a per-frame updater and start the loop. Idempotent — re-adding the same fn is a no-op. */
  requestFrames(update: FrameUpdater): void {
    this.updaters.add(update);
    this.ensureRunning();
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.updaters.clear();
    this.dirty = false;
  }

  private ensureRunning(): void {
    // inFrame guard: a call from within the loop lets the frame's own tail schedule the next rAF,
    // so we never end up with two in flight.
    if (this.rafId || this.inFrame) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.rafId = 0;
    this.inFrame = true;
    // Frame-rate cap: skip the whole tick (updaters untouched, so their dt keeps accumulating)
    // until enough time has passed since the last paint. A paint after an idle stretch is
    // unaffected — only sustained repainting is throttled.
    if (now - this.lastPaint < MIN_PAINT_MS) {
      this.inFrame = false;
      if (this.updaters.size > 0 || this.dirty) this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, MAX_DT) : 0;
    this.lastTime = now;

    const hadUpdaters = this.updaters.size > 0;
    for (const update of this.updaters) {
      if (!update(dt)) this.updaters.delete(update);
    }

    if (hadUpdaters || this.dirty) {
      this.dirty = false;
      this.app.render();
      this.lastPaint = now;
    }
    this.inFrame = false;

    if (this.updaters.size > 0 || this.dirty) {
      this.rafId = requestAnimationFrame(this.frame);
    } else {
      this.lastTime = 0; // fresh dt baseline on the next wake
    }
  };
}
