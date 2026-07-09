import type { CoopStatusPayload, GameEvent, GameState } from "shared";
import { clientWireLog } from "../net/wire-log.js";

interface QueuedBatch {
  state: GameState;
  events: readonly GameEvent[];
}

/** Snapshots AND coop flips share one queue so phase changes land in display-time, in wire
 *  order relative to the animations around them (no "YOUR TURN" before the enemies finish). */
type QueueItem = { kind: "batch"; batch: QueuedBatch } | { kind: "coop"; coop: CoopStatusPayload };

export interface DisplayQueueDeps {
  /** Commit a drained batch: set the display state and hand its events to the renderer. */
  commitBatch(state: GameState, events: readonly GameEvent[]): void;
  commitCoop(coop: CoopStatusPayload): void;
  /** Call `cb` once the renderer reports no in-flight animations. */
  waitForAnimations(cb: () => void): void;
  now(): number;
  schedule(cb: () => void, ms: number): void;
}

/**
 * The display-time drain: wire batches queue here and commit one at a time, waiting for the
 * renderer's animations between drains. Framework-free — the rune store injects the commit
 * callbacks — so the ordering rules (nothing dropped, nothing reordered) are unit-testable.
 */
export class DisplayQueue {
  private queue: QueueItem[] = [];
  private draining = false;
  /** Display-queue pause: batches never drain before this timestamp (phase slates use it). */
  private holdUntil = 0;
  /** Async pre-batch hook (camera pans to the actor, per-enemy beats). One registrant (BoardHost). */
  private batchGate: ((state: GameState, events: readonly GameEvent[]) => Promise<void>) | null = null;

  constructor(private deps: DisplayQueueDeps) {}

  enqueueBatch(state: GameState, events: readonly GameEvent[]): void {
    this.queue.push({ kind: "batch", batch: { state, events } });
    this.drain();
  }

  /** Coop flips ride the queue while it is busy (wire order preserved); otherwise commit now. */
  enqueueCoop(coop: CoopStatusPayload): void {
    if (this.draining || this.queue.length > 0) {
      this.queue.push({ kind: "coop", coop });
      return;
    }
    this.deps.commitCoop(coop);
  }

  depth(): number {
    return this.queue.length;
  }

  /** True once every received batch has finished animating: queue empty and not mid-drain. */
  isIdle(): boolean {
    return this.queue.length === 0 && !this.draining;
  }

  /** Pause the drain (not the wire) until `ms` from now — lets a phase slate land first. */
  holdFor(ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, this.deps.now() + ms);
  }

  setBatchGate(gate: ((state: GameState, events: readonly GameEvent[]) => Promise<void>) | null): void {
    this.batchGate = gate;
  }

  reset(): void {
    this.queue = [];
    this.draining = false;
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    this.processNext();
  }

  private processNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.draining = false;
      return;
    }
    if (next.kind === "coop") {
      this.deps.commitCoop(next.coop);
      this.processNext();
      return;
    }
    clientWireLog.note("drain", { actionCount: next.batch.state.actionCount, queueDepth: this.queue.length });
    const wait = this.holdUntil - this.deps.now();
    if (wait > 0) {
      // Still inside a slate hold — keep `draining` true so new batches queue behind us.
      this.deps.schedule(() => this.applyBatch(next.batch), wait);
      return;
    }
    this.applyBatch(next.batch);
  }

  private applyBatch(batch: QueuedBatch): void {
    const gated = this.batchGate?.(batch.state, batch.events);
    if (gated) {
      void gated.then(() => {
        this.deps.commitBatch(batch.state, batch.events);
        this.deps.waitForAnimations(() => this.processNext());
      });
      return;
    }
    this.deps.commitBatch(batch.state, batch.events);
    this.deps.waitForAnimations(() => this.processNext());
  }
}
