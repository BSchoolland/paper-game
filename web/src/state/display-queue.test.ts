/// <reference types="bun" />
import { describe, it, expect } from "bun:test";
import type { CoopStatusPayload, GameEvent, GameState } from "shared";
import { DisplayQueue, type DisplayQueueDeps } from "./display-queue.js";

// The queue only reads actionCount off the state; a stub is enough.
function state(actionCount: number): GameState {
  return { actionCount } as GameState;
}

function coop(phase: "player" | "enemy"): CoopStatusPayload {
  return { phase, seats: [], pendingDefends: [] };
}

const move: GameEvent = { type: "move", entityId: "s0-hero", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } };

/**
 * A harness where animations complete only when the test says so: each commitBatch is followed
 * by a captured waitForAnimations callback (`pending`), released via `finishAnimation()`.
 */
function harness(nowStart = 1000) {
  const commits: Array<{ kind: "batch"; actionCount: number; events: readonly GameEvent[] } | { kind: "coop"; phase: string }> = [];
  const pending: (() => void)[] = [];
  const scheduled: Array<{ cb: () => void; ms: number }> = [];
  let now = nowStart;
  const deps: DisplayQueueDeps = {
    commitBatch(s, events) {
      commits.push({ kind: "batch", actionCount: s.actionCount, events });
    },
    commitCoop(c) {
      commits.push({ kind: "coop", phase: c.phase });
    },
    waitForAnimations(cb) {
      pending.push(cb);
    },
    now: () => now,
    schedule(cb, ms) {
      scheduled.push({ cb, ms });
    },
  };
  const queue = new DisplayQueue(deps);
  return {
    queue,
    commits,
    scheduled,
    finishAnimation() {
      pending.shift()!();
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("DisplayQueue", () => {
  it("commits batches strictly in wire order, one animation at a time", () => {
    const h = harness();
    h.queue.enqueueBatch(state(1), [move]);
    h.queue.enqueueBatch(state(2), [move]);
    expect(h.commits).toHaveLength(1); // first drains immediately, second waits on its animation
    h.finishAnimation();
    h.finishAnimation();
    expect(h.commits.map((c) => (c.kind === "batch" ? c.actionCount : -1))).toEqual([1, 2]);
    expect(h.queue.isIdle()).toBe(true);
  });

  it("regression (plan.md bug 1): an empty-events re-sync never drops queued animation batches", () => {
    const h = harness();
    // Two animated batches in flight...
    h.queue.enqueueBatch(state(1), [move]);
    h.queue.enqueueBatch(state(2), [move]);
    // ...when the server re-syncs with an empty-events snapshot (e.g. a reconnect snap).
    h.queue.enqueueBatch(state(3), []);

    h.finishAnimation(); // batch 1's animation completes -> batch 2 commits
    h.finishAnimation(); // batch 2's animation completes -> the snap commits
    h.finishAnimation();

    // Old behavior wiped batch 2 (its events never reached the renderer) and snapped to 3.
    const batches = h.commits.filter((c) => c.kind === "batch");
    expect(batches.map((c) => c.actionCount)).toEqual([1, 2, 3]);
    expect(batches[1]!.events).toEqual([move]); // the previously-wiped batch still animated
    expect(h.queue.isIdle()).toBe(true);
  });

  it("keeps queued coop flips in wire order instead of collapsing them to the newest", () => {
    const h = harness();
    h.queue.enqueueBatch(state(1), [move]);
    h.queue.enqueueCoop(coop("enemy"));
    h.queue.enqueueBatch(state(2), [move]);
    h.queue.enqueueCoop(coop("player"));
    h.queue.enqueueBatch(state(3), []); // re-sync snap arrives behind everything

    h.finishAnimation();
    h.finishAnimation();
    h.finishAnimation();

    expect(h.commits.map((c) => (c.kind === "coop" ? c.phase : c.actionCount))).toEqual([1, "enemy", 2, "player", 3]);
  });

  it("commits a coop status immediately when idle", () => {
    const h = harness();
    h.queue.enqueueCoop(coop("player"));
    expect(h.commits).toEqual([{ kind: "coop", phase: "player" }]);
  });

  it("holdFor defers the next batch by the remaining hold, keeping later batches queued behind it", () => {
    const h = harness();
    h.queue.holdFor(500);
    h.queue.enqueueBatch(state(1), [move]);
    expect(h.commits).toHaveLength(0);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]!.ms).toBe(500);
    expect(h.queue.isIdle()).toBe(false); // still draining: new batches must queue, not race

    h.advance(500);
    h.scheduled[0]!.cb();
    expect(h.commits).toEqual([{ kind: "batch", actionCount: 1, events: [move] }]);
  });

  it("waits for the batch gate before committing", async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.queue.setBatchGate(() => gate);
    h.queue.enqueueBatch(state(1), [move]);
    expect(h.commits).toHaveLength(0);
    release();
    await gate;
    expect(h.commits).toEqual([{ kind: "batch", actionCount: 1, events: [move] }]);
  });

  it("reset() empties the queue and returns to idle", () => {
    const h = harness();
    h.queue.enqueueBatch(state(1), [move]);
    h.queue.enqueueBatch(state(2), [move]);
    h.queue.reset();
    expect(h.queue.isIdle()).toBe(true);
    h.queue.enqueueBatch(state(3), []);
    h.finishAnimation();
    expect(h.commits.filter((c) => c.kind === "batch").map((c) => c.actionCount)).toEqual([1, 3]);
  });
});
