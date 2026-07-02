import type { Ticker } from "pixi.js";

const IDLE_FPS = 15;

/** Asked every frame for the FPS this subsystem needs *right now* — `0` means "no demand".
 *  Derive the answer from the same state that drives the animation (e.g. `isAnimating()`), so
 *  "I'm animating" and "render me fast" are one fact, read at one instant. */
export type FpsProvider = () => number;

/**
 * Caps the pixi ticker at {@link IDLE_FPS}, raising it only while a registered provider asks for
 * more. The rate is recomputed every frame from the live providers (level-triggered) — there is
 * deliberately no per-animation `request`/`release`. A boost can't outlive the animation that
 * needs it (nothing to forget to release) and can't be dropped mid-animation (the provider that
 * keeps it up *is* the animation's own state), so "animating but throttled" is unrepresentable.
 */
export class FramePacer {
  private providers = new Set<FpsProvider>();

  constructor(private ticker: Ticker) {
    this.ticker.maxFPS = IDLE_FPS;
    this.ticker.add(() => this.apply());
  }

  /** Register a pull-function and get back an unregister fn. */
  register(provider: FpsProvider): () => void {
    this.providers.add(provider);
    return () => {
      this.providers.delete(provider);
    };
  }

  private apply() {
    let fps = IDLE_FPS;
    for (const need of this.providers) {
      const n = need();
      if (n > fps) fps = n;
    }
    this.ticker.maxFPS = fps;
  }
}
