/**
 * Client-only dev toggles (DevLayer). Never shipped in prod — the layer that reads this
 * is gated on import.meta.env.DEV.
 */
const STORAGE_KEY = "dev.autoWin";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const devOptions = $state({
  /** When on, the host auto-sends debugWin as soon as a combat starts. */
  autoWin: readStored(),
});

export function setAutoWin(on: boolean): void {
  devOptions.autoWin = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // private mode / blocked storage — toggle still works for this session
  }
}
