import type { ClientState } from "../state/client-state.js";
import type { GameRenderer } from "./game-renderer.js";

const SWEEP_DURATION_MS = 1200;
const RESULT_HOLD_MS = 400;
const BAR_WIDTH = 80;
const BAR_HEIGHT = 8;
const OFFSET_Y = -90;

export class TimingBar {
  private animFrame = 0;
  private startTime = 0;
  private resolve: ((power: number) => void) | null = null;
  private onClickBound: (e: MouseEvent) => void;
  private onKeyBound: (e: KeyboardEvent) => void;
  private renderer: GameRenderer | null = null;

  private container: HTMLDivElement;
  private marker: HTMLDivElement;
  private label: HTMLDivElement;

  constructor(private clientState: ClientState) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: fixed;
      z-index: 200;
      display: none;
      pointer-events: none;
      transform: translateX(-50%);
    `;

    const track = document.createElement("div");
    track.style.cssText = `
      position: relative;
      width: ${BAR_WIDTH}px;
      height: ${BAR_HEIGHT}px;
      border: 2px solid #5a4a38;
      border-radius: 3px;
      overflow: hidden;
      background: linear-gradient(to right,
        #7a3a2a 0%,
        #9a7a40 20%,
        #6a8a45 40%,
        #5a9a3a 50%,
        #6a8a45 60%,
        #9a7a40 80%,
        #7a3a2a 100%
      );
      box-shadow: 0 1px 4px rgba(20, 15, 8, 0.5);
    `;

    this.marker = document.createElement("div");
    this.marker.style.cssText = `
      position: absolute;
      top: -2px;
      width: 3px;
      height: ${BAR_HEIGHT + 4}px;
      background: #3a2a18;
      border-radius: 1px;
      box-shadow: 0 0 2px rgba(30, 20, 10, 0.5);
      pointer-events: none;
    `;
    track.appendChild(this.marker);
    this.container.appendChild(track);

    this.label = document.createElement("div");
    this.container.appendChild(this.label);

    document.body.appendChild(this.container);

    this.onClickBound = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.stop();
    };
    this.onKeyBound = (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        this.stop();
      }
    };
  }

  setRenderer(renderer: GameRenderer) {
    this.renderer = renderer;
  }

  run(): Promise<number> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.startTime = performance.now();
      this.clientState.timingPower = 0;
      this.label.textContent = "";
      this.container.style.display = "block";

      window.addEventListener("click", this.onClickBound, true);
      document.addEventListener("keydown", this.onKeyBound);

      const tick = () => {
        const elapsed = performance.now() - this.startTime;
        const t = (elapsed % SWEEP_DURATION_MS) / SWEEP_DURATION_MS;
        const pos = Math.abs(2 * t - 1);
        const power = 1 - Math.abs(2 * pos - 1);
        this.clientState.timingPower = power;
        this.marker.style.left = `${pos * (BAR_WIDTH - 3)}px`;
        this.updatePosition();
        this.clientState.notify();
        this.animFrame = requestAnimationFrame(tick);
      };
      this.animFrame = requestAnimationFrame(tick);
    });
  }

  private updatePosition() {
    if (!this.renderer) return;
    const entityId = this.clientState.selectedEntityId;
    if (!entityId) return;
    const state = this.clientState.getState();
    if (!state) return;
    const entity = state.entities.get(entityId);
    if (!entity) return;

    const screen = this.renderer.worldToScreen(entity.position);
    this.container.style.left = `${screen.x}px`;
    this.container.style.top = `${screen.y + OFFSET_Y}px`;
  }

  private stop() {
    cancelAnimationFrame(this.animFrame);
    window.removeEventListener("click", this.onClickBound, true);
    document.removeEventListener("keydown", this.onKeyBound);

    const power = this.clientState.timingPower ?? 0;

    setTimeout(() => {
      this.container.style.display = "none";
      this.clientState.timingPower = null;
      this.clientState.timingAim = null;
      this.clientState.notify();
      this.resolve?.(power);
      this.resolve = null;
    }, RESULT_HOLD_MS);
  }
}
