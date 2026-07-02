import type { WireLogRecord } from "shared";

const CAPACITY = 2000;

class ClientEventLog {
  private records: WireLogRecord[] = [];

  record(record: WireLogRecord): void {
    this.records.push(record);
    if (this.records.length > CAPACITY) this.records.splice(0, this.records.length - CAPACITY);
    if (import.meta.env.DEV && record.note) console.debug("[wire:client]", record);
  }

  recent(limit?: number): WireLogRecord[] {
    return limit === undefined ? [...this.records] : this.records.slice(-limit);
  }

  clear(): void {
    this.records.length = 0;
  }
}

export const clientEventLog = new ClientEventLog();
