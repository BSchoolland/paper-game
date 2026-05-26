/**
 * Coordinates visual effects between local prediction and authoritative server events.
 *
 * Every effect that can fire from either side (a defended attack, a predicted knockback, a
 * peer-shared animation) is dispatched through one method per source:
 *
 *   - `playLocal(key, fn)` — invoked by client-side prediction. Runs `fn` immediately and marks
 *     `key` as already-played; the next matching `playFromServer` call is silently dropped.
 *   - `playFromServer(key, fn)` — invoked when an authoritative server event arrives. Runs `fn`
 *     unless local prediction already played the same `key`, in which case the duplicate is
 *     consumed and ignored.
 *
 * Keys are caller-defined strings — encode whatever uniquely identifies the logical effect
 * (e.g. `swing:<attackerId>`, `flash:<attackerId>`, `defender:<entityId>`). The dispatcher is
 * source-agnostic, so the same dedup works for replays (only server-side, no suppression),
 * single-player prediction (one local source), or future multiplayer peer predictions.
 */
/** Branded so raw strings can't slip through — callers must build keys via a typed helper
 *  (see `EffectKind` + `makeKey` in entity-manager). The brand has no runtime cost. */
export type EffectKey = string & { readonly _: "EffectKey" };

export class VisualEffectDispatcher {
  private suppressed = new Set<EffectKey>();

  playLocal(key: EffectKey, fn: () => void): void {
    this.suppressed.add(key);
    fn();
  }

  playFromServer(key: EffectKey, fn: () => void): void {
    if (this.suppressed.delete(key)) return;
    fn();
  }

  clear(): void {
    this.suppressed.clear();
  }
}
