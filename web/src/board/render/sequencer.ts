/**
 * The presentation clock: every visual that unfolds over time — move tweens, attack
 * performances, impact reactions, knockbacks — is a Clip scheduled here, on one shared
 * timeline. Simulation facts (positions, HP, deaths) are committed to the presentation
 * layer inside clip callbacks, at the beat the motion says they happen — never at the
 * moment a server message arrives. The renderer draws what clips have committed; nothing
 * else mutates presentation state.
 */
export interface Clip {
  /** Seconds from schedule time until the clip starts. */
  delay: number;
  /** Seconds of active run; 0 = fire onStart/onEnd on the same frame it becomes due. */
  duration: number;
  onStart?: () => void;
  /** t in [0, 1], monotone, always ends with exactly 1 before onEnd. */
  onUpdate?: (t: number) => void;
  onEnd?: () => void;
}

interface Scheduled {
  clip: Clip;
  elapsed: number;
  started: boolean;
}

export class Sequencer {
  private items: Scheduled[] = [];

  schedule(clip: Clip): void {
    this.items.push({ clip, elapsed: 0, started: false });
  }

  get busy(): boolean {
    return this.items.length > 0;
  }

  update(dt: number): void {
    // Iterate a snapshot: callbacks may schedule follow-up clips (they run from next frame).
    const batch = this.items;
    const survivors: Scheduled[] = [];
    this.items = [];
    for (const item of batch) {
      item.elapsed += dt;
      if (item.elapsed < item.clip.delay) {
        survivors.push(item);
        continue;
      }
      if (!item.started) {
        item.started = true;
        item.clip.onStart?.();
      }
      const t = item.clip.duration <= 0 ? 1 : Math.min(1, (item.elapsed - item.clip.delay) / item.clip.duration);
      item.clip.onUpdate?.(t);
      if (t >= 1) {
        item.clip.onEnd?.();
      } else {
        survivors.push(item);
      }
    }
    // Follow-ups scheduled during callbacks landed in this.items — keep them.
    this.items = survivors.concat(this.items);
  }

  clear(): void {
    this.items = [];
  }
}
