import type { ServerEnvelope, ServerMessageType, WireLogRecord } from "shared";
import { summarizeEvent } from "shared";

const CAPACITY = 2000;

/**
 * Client-side mirror of the server's wire event log (`server/src/event-log.ts`): every received
 * envelope becomes a `WireLogRecord`, and store-level drain decisions are recorded as notes
 * stamped with the envelope they reacted to. The two timelines line up by `seq`/`t` when
 * debugging ordering bugs.
 */
class ClientWireLog {
  private records: WireLogRecord[] = [];
  private lastSeq = 0;
  private lastT = 0;

  recordEnvelope(env: ServerEnvelope): void {
    this.lastSeq = env.seq;
    this.lastT = env.t;
    const stateMsg = env.msg.type === "state" ? env.msg : null;
    this.record({
      dir: "recv",
      seq: env.seq,
      t: env.t,
      type: env.msg.type,
      actionCount: stateMsg?.state.actionCount,
      events: stateMsg?.events.map(summarizeEvent),
    });
  }

  /** A local decision about already-received data (drop/wipe/drain), tied to the last envelope. */
  note(note: string, extra?: { type?: ServerMessageType; actionCount?: number; queueDepth?: number }): void {
    this.record({
      dir: "recv",
      seq: this.lastSeq,
      t: this.lastT,
      type: extra?.type ?? "state",
      actionCount: extra?.actionCount,
      queueDepth: extra?.queueDepth,
      note,
    });
  }

  record(r: WireLogRecord): void {
    this.records.push(r);
    if (this.records.length > CAPACITY) this.records.splice(0, this.records.length - CAPACITY);
  }

  recent(limit?: number): WireLogRecord[] {
    return limit === undefined ? [...this.records] : this.records.slice(-limit);
  }

  clear(): void {
    this.records.length = 0;
    this.lastSeq = 0;
    this.lastT = 0;
  }
}

export const clientWireLog = new ClientWireLog();

/**
 * Per-connection `seq` monotonicity guard. The server stamps each socket's envelopes 1,2,3,…
 * (`server/src/wire-transport.ts`), so on an intact connection every arrival is `lastSeq + 1`.
 * A gap means a dropped message, a regression means reordering — both are protocol violations:
 * record + structured warn, and throw in dev (no silent fallback). Reset on every (re)connect —
 * the server's counter restarts with the socket.
 */
export class SeqTracker {
  private lastSeq = 0;

  constructor(private dev: boolean) {}

  reset(): void {
    this.lastSeq = 0;
  }

  verify(env: ServerEnvelope): void {
    const expected = this.lastSeq + 1;
    if (env.seq > this.lastSeq) this.lastSeq = env.seq;
    if (env.seq === expected) return;
    const note = env.seq > expected ? "seq-gap" : "seq-regress";
    clientWireLog.record({ dir: "recv", seq: env.seq, t: env.t, type: env.msg.type, note });
    console.warn("[wire] server message sequence anomaly", { note, expected, got: env.seq, type: env.msg.type });
    if (this.dev) throw new Error(`Server message sequence anomaly (${note}): expected ${expected}, got ${env.seq}`);
  }
}
