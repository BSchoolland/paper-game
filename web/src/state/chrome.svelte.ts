import type { CodexEntryPayload, PartyBagEntry, RoomCode, ServerMessage } from "shared";

type XpBanked = Extract<ServerMessage, { type: "xpBanked" }>;

/** Transient celebration/notice surfaces. Everything here is dismissible and non-authoritative. */
export type Toast =
  | { id: number; kind: "invite"; from: string; code: RoomCode; dimensionId: number }
  | { id: number; kind: "titles"; titleIds: readonly string[] }
  | { id: number; kind: "loot"; drops: readonly PartyBagEntry[] }
  | { id: number; kind: "xpBanked"; banked: XpBanked }
  | { id: number; kind: "codexBanked"; entries: readonly CodexEntryPayload[]; firstItemIds: readonly string[] }
  | { id: number; kind: "error"; message: string };

export type AccountDialogMode = "claim" | "login" | "register";

interface ChromeStore {
  toasts: Toast[];
  /** The create-account/login overlay; opened from the header, friends pane, or an auth rejection. */
  accountDialog: AccountDialogMode | null;
}

function initial(): ChromeStore {
  return { toasts: [], accountDialog: null };
}

export const chrome = $state<ChromeStore>(initial());

let nextToastId = 1;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function pushToast(toast: DistributiveOmit<Toast, "id">): void {
  chrome.toasts.push({ ...toast, id: nextToastId++ } as Toast);
}

export function dismissToast(id: number): void {
  chrome.toasts = chrome.toasts.filter((t) => t.id !== id);
}

export function resetChrome(): void {
  Object.assign(chrome, initial());
}
