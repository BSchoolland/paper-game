import type { ChatEntry } from "shared";

type Listener = () => void;

/** Mirrors the server's per-room in-memory cap. */
const CHAT_CAP = 100;

/**
 * The room chat log mirror: `chat` appends, `chatHistory` (reconnect replay) replaces,
 * and main.ts clears it whenever the bound room changes or is left.
 */
export class ChatStore {
  entries: readonly ChatEntry[] = [];
  private listeners: Listener[] = [];

  append(entry: ChatEntry): void {
    const next = [...this.entries, entry];
    this.entries = next.length > CHAT_CAP ? next.slice(next.length - CHAT_CAP) : next;
    this.notify();
  }

  replaceAll(entries: readonly ChatEntry[]): void {
    this.entries = entries.slice(-CHAT_CAP);
    this.notify();
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
