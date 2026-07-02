import type { CodexEntryPayload } from "shared";

interface CodexStore {
  /** Null = never fetched this connection; [] = fetched, empty (no codex tab yet). */
  entries: CodexEntryPayload[] | null;
}

function initial(): CodexStore {
  return { entries: null };
}

export const codex = $state<CodexStore>(initial());

export function resetCodex(): void {
  Object.assign(codex, initial());
}
