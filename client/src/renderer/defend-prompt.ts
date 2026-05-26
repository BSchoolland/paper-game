import type { ClientState } from "../state/client-state.js";
import type { GameRenderer } from "./game-renderer.js";

const WINDUP_MS = 500;
const WINDOW_MS = 300;
const PERFECT_WINDOW_MS = 100;
const RESULT_HOLD_MS = 300;

export class DefendPrompt {
  private container: HTMLDivElement;
  private flash: HTMLDivElement;
  private renderer: GameRenderer | null = null;
  private resolve: ((power: number) => void) | null = null;
  private windowStart = 0;
  private pressed = false;
  private active = false;
  private targetId: string | null = null;

  constructor(private clientState: ClientState) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: fixed;
      z-index: 200;
      display: none;
      pointer-events: none;
      transform: translate(-50%, -50%);
    `;

    this.flash = document.createElement("div");
    this.flash.style.cssText = `
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 3px solid #d4c8a0;
      box-shadow: 0 0 12px rgba(212, 200, 160, 0.6);
      opacity: 0;
      transition: opacity 0.08s;
    `;
    this.container.appendChild(this.flash);
    document.body.appendChild(this.container);
  }

  setRenderer(renderer: GameRenderer) {
    this.renderer = renderer;
  }

  run(targetId: string): Promise<number> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.targetId = targetId;
      this.pressed = false;
      this.active = true;
      this.container.style.display = "block";
      this.flash.style.opacity = "0";
      this.flash.style.borderColor = "#d4c8a0";
      this.updatePosition();

      const onPress = (e: KeyboardEvent | MouseEvent) => {
        if (this.pressed || !this.active) return;
        if (e instanceof KeyboardEvent && e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        this.pressed = true;

        const now = performance.now();
        const elapsed = now - this.windowStart;

        let power: number;
        if (elapsed < 0) {
          power = 0;
        } else if (elapsed > WINDOW_MS) {
          power = 0;
        } else {
          const center = WINDOW_MS / 2;
          const dist = Math.abs(elapsed - center);
          if (dist <= PERFECT_WINDOW_MS / 2) {
            power = 1;
          } else {
            power = Math.max(0, 1 - (dist - PERFECT_WINDOW_MS / 2) / (WINDOW_MS / 2 - PERFECT_WINDOW_MS / 2));
          }
        }

        this.flash.style.borderColor = power >= 0.8 ? "#5a9a3a" : power >= 0.3 ? "#9a7a40" : "#7a3a2a";

        cleanup();
        setTimeout(() => {
          this.container.style.display = "none";
          this.active = false;
          this.resolve?.(power);
          this.resolve = null;
        }, RESULT_HOLD_MS);
      };

      const cleanup = () => {
        document.removeEventListener("keydown", onPress);
        window.removeEventListener("mousedown", onPress, true);
      };

      document.addEventListener("keydown", onPress);
      window.addEventListener("mousedown", onPress, true);

      setTimeout(() => {
        if (!this.active) return;
        this.flash.style.opacity = "1";
        this.windowStart = performance.now();

        setTimeout(() => {
          if (!this.active || this.pressed) return;
          cleanup();
          this.container.style.display = "none";
          this.active = false;
          this.resolve?.(0);
          this.resolve = null;
        }, WINDOW_MS);
      }, WINDUP_MS);

      this.trackPosition();
    });
  }

  private updatePosition() {
    if (!this.renderer || !this.targetId) return;
    const state = this.clientState.getState();
    if (!state) return;
    const entity = state.entities.get(this.targetId);
    if (!entity) return;

    const screen = this.renderer.worldToScreen(entity.position);
    this.container.style.left = `${screen.x}px`;
    this.container.style.top = `${screen.y - 60}px`;
  }

  private trackPosition() {
    if (!this.active) return;
    this.updatePosition();
    requestAnimationFrame(() => this.trackPosition());
  }
}
