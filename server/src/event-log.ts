import type { RoomCode, WireLogRecord } from "shared";

const CAPACITY = 2000;
type Sink = "off" | "ring" | "stdout" | "db";
type Persister = {
  save(record: WireLogRecord): void;
  recent(filter?: { room?: RoomCode; limit?: number }): WireLogRecord[];
  clear(): void;
};

function sink(): Sink {
  const configured = process.env.MP_EVENT_LOG as Sink | undefined;
  if (configured === "off" || configured === "ring" || configured === "stdout" || configured === "db") return configured;
  return process.env.NODE_ENV === "production" ? "off" : "ring";
}

class EventLog {
  private records: WireLogRecord[] = [];
  private persister: Persister | null = null;

  setPersister(persister: Persister): void {
    this.persister = persister;
  }

  record(record: WireLogRecord): void {
    const mode = sink();
    if (mode === "off") return;
    this.records.push(record);
    if (this.records.length > CAPACITY) this.records.splice(0, this.records.length - CAPACITY);
    if (mode === "db") this.persister?.save(record);
    if (mode === "stdout") console.log(format(record));
  }

  recent(filter?: { room?: RoomCode; limit?: number }): WireLogRecord[] {
    let out = this.records;
    if (filter?.room) out = out.filter((r) => r.room === filter.room);
    if (filter?.limit !== undefined) out = out.slice(-filter.limit);
    return [...out];
  }

  persisted(filter?: { room?: RoomCode; limit?: number }): WireLogRecord[] {
    return this.persister?.recent(filter) ?? [];
  }

  clear(): void {
    this.records.length = 0;
    this.persister?.clear();
  }
}

function format(record: WireLogRecord): string {
  const events = record.events?.map((e) => `${e.kind}${e.actor ? `:${e.actor}` : ""}${e.target ? `>${e.target}` : ""}${e.amount !== undefined ? `#${e.amount}` : ""}`).join(",") ?? "";
  return [
    `[wire:${record.dir}]`,
    `t=${record.t}`,
    `seq=${record.seq}`,
    record.room ? `room=${record.room}` : "",
    record.runId !== undefined ? `run=${record.runId}` : "",
    record.seatId ? `seat=${record.seatId}` : "",
    `type=${record.type}`,
    record.actionCount !== undefined ? `ac=${record.actionCount}` : "",
    record.combatPhase ? `phase=${record.combatPhase}` : "",
    events ? `events=${events}` : "",
    record.note ? `note=${record.note}` : "",
  ].filter(Boolean).join(" ");
}

export const eventLog = new EventLog();
