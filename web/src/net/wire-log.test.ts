import { describe, it, expect, beforeEach } from "bun:test";
import type { ServerEnvelope } from "shared";
import { clientWireLog, SeqTracker } from "./wire-log.js";

function env(seq: number, t = seq * 10): ServerEnvelope {
  return { seq, t, msg: { type: "leftRoom" } };
}

beforeEach(() => clientWireLog.clear());

describe("SeqTracker", () => {
  it("accepts a strictly contiguous sequence without recording anomalies", () => {
    const tracker = new SeqTracker(false);
    for (let i = 1; i <= 5; i++) tracker.verify(env(i));
    expect(clientWireLog.recent().filter((r) => r.note)).toEqual([]);
  });

  it("records a seq-gap and keeps counting from the received seq (non-dev)", () => {
    const tracker = new SeqTracker(false);
    tracker.verify(env(1));
    tracker.verify(env(4)); // 2 and 3 dropped
    const anomalies = clientWireLog.recent().filter((r) => r.note);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.note).toBe("seq-gap");
    expect(anomalies[0]!.seq).toBe(4);
    // The stream continues from the gap without a second anomaly.
    tracker.verify(env(5));
    expect(clientWireLog.recent().filter((r) => r.note)).toHaveLength(1);
  });

  it("records a seq-regress without moving the high-water mark backwards (non-dev)", () => {
    const tracker = new SeqTracker(false);
    tracker.verify(env(1));
    tracker.verify(env(2));
    tracker.verify(env(1)); // reordered duplicate
    const anomalies = clientWireLog.recent().filter((r) => r.note);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.note).toBe("seq-regress");
    // 3 is still the next expected value — the regression must not reset the counter.
    tracker.verify(env(3));
    expect(clientWireLog.recent().filter((r) => r.note)).toHaveLength(1);
  });

  it("throws in dev on a gap and on a regression", () => {
    const gap = new SeqTracker(true);
    gap.verify(env(1));
    expect(() => gap.verify(env(3))).toThrow(/seq-gap/);

    const regress = new SeqTracker(true);
    regress.verify(env(1));
    regress.verify(env(2));
    expect(() => regress.verify(env(1))).toThrow(/seq-regress/);
  });

  it("reset() restarts the per-connection counter (server restarts at 1 on reconnect)", () => {
    const tracker = new SeqTracker(true);
    tracker.verify(env(1));
    tracker.verify(env(2));
    tracker.reset();
    tracker.verify(env(1)); // must not be treated as a regression
    expect(clientWireLog.recent().filter((r) => r.note)).toEqual([]);
  });
});

describe("clientWireLog", () => {
  it("records received envelopes and stamps later notes with the last envelope's seq/t", () => {
    clientWireLog.recordEnvelope(env(7, 42));
    clientWireLog.note("drain", { queueDepth: 3 });
    const records = clientWireLog.recent();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ dir: "recv", seq: 7, t: 42, type: "leftRoom" });
    expect(records[1]).toMatchObject({ dir: "recv", seq: 7, t: 42, note: "drain", queueDepth: 3 });
  });
});
