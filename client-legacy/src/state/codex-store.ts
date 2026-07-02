import type { CodexEntryPayload } from "shared";

type Listener = () => void;

/**
 * The live holder for this account's banked designs (docs/meta-loop/03-loot-codex.md §6.7).
 * Fed from `codex` responses by main.ts; HomeScreen and LobbyScreen send `getCodex` on enter
 * and render from here, so the response needs no per-screen routing.
 */
export class CodexStore {
  entries: readonly CodexEntryPayload[] = [];
  private listeners: Listener[] = [];

  setEntries(entries: readonly CodexEntryPayload[]): void {
    this.entries = entries;
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
