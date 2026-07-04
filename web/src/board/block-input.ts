/**
 * Always-on tracker for the block input (Space / Enter / mouse button). The defend prompt can
 * only attach listeners once the server opens a round — but players naturally start holding
 * their guard while the enemy is still winding up. This singleton watches the keys from page
 * load, so a prompt can ask "is the player ALREADY holding?" the moment it opens, instead of
 * forcing a release-and-re-press.
 *
 * While a prompt is active it calls setCapturing(true) and block keys are swallowed
 * (preventDefault/stopPropagation); outside a prompt the tracker only observes.
 */
type BlockInputListener = (at: number) => void;

class BlockInput {
  /** Every currently-held source ("key: ", "key:Enter", "mouse:0", …). Held = non-empty. */
  private sources = new Set<string>();
  private heldSinceMs: number | null = null;
  private downListeners: BlockInputListener[] = [];
  private upListeners: BlockInputListener[] = [];
  private capturing = false;

  constructor() {
    document.addEventListener("keydown", (e) => this.onDown(e), true);
    document.addEventListener("keyup", (e) => this.onUp(e), true);
    window.addEventListener("mousedown", (e) => this.onDown(e), true);
    window.addEventListener("mouseup", (e) => this.onUp(e), true);
    window.addEventListener("blur", () => this.releaseAll());
  }

  /** When the hold began, or null if nothing is held. Survives from before a prompt opened. */
  heldSince(): number | null {
    return this.heldSinceMs;
  }

  /** Swallow block keys while a defend prompt owns them. */
  setCapturing(on: boolean): void {
    this.capturing = on;
  }

  onBlockDown(listener: BlockInputListener): () => void {
    this.downListeners.push(listener);
    return () => {
      this.downListeners = this.downListeners.filter((l) => l !== listener);
    };
  }

  onBlockUp(listener: BlockInputListener): () => void {
    this.upListeners.push(listener);
    return () => {
      this.upListeners = this.upListeners.filter((l) => l !== listener);
    };
  }

  private sourceOf(e: KeyboardEvent | MouseEvent): string | null {
    if (e instanceof KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return null;
      if (e.key !== " " && e.key !== "Enter") return null;
      return `key:${e.key}`;
    }
    return `mouse:${e.button}`;
  }

  private onDown(e: KeyboardEvent | MouseEvent): void {
    const source = this.sourceOf(e);
    if (source === null) return;
    if (e instanceof KeyboardEvent && e.repeat) return;
    if (this.capturing) {
      e.preventDefault();
      e.stopPropagation();
    }
    const wasHeld = this.sources.size > 0;
    this.sources.add(source);
    if (wasHeld) return;
    this.heldSinceMs = performance.now();
    for (const l of this.downListeners) l(this.heldSinceMs);
  }

  private onUp(e: KeyboardEvent | MouseEvent): void {
    const source = this.sourceOf(e);
    if (source === null) return;
    if (this.capturing) {
      e.preventDefault();
      e.stopPropagation();
    }
    this.sources.delete(source);
    if (this.sources.size === 0) this.releaseAll();
  }

  private releaseAll(): void {
    this.sources.clear();
    if (this.heldSinceMs === null) return;
    this.heldSinceMs = null;
    const at = performance.now();
    for (const l of this.upListeners) l(at);
  }
}

export const blockInput = new BlockInput();
