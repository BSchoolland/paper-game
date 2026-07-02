import { ShapeKind } from "shared";
import type { ClientState } from "./client-state.svelte.js";
import type { GameRenderer } from "./render/game-renderer.js";

const SWEEP_DURATION_MS = 1200;
const ONESHOT_DURATION_MS = 800;
const CHARGE_DURATION_MS = 900;
const RESULT_HOLD_MS = 400;
const BAR_WIDTH = 80;
const BAR_HEIGHT = 8;
const OFFSET_Y = -90;

const GRADIENT_SYMMETRIC = `linear-gradient(to right,
  #7a3a2a 0%, #9a7a40 20%, #6a8a45 40%, #5a9a3a 50%,
  #6a8a45 60%, #9a7a40 80%, #7a3a2a 100%)`;

const GRADIENT_ONESHOT = `linear-gradient(to right,
  #7a3a2a 0%, #9a7a40 30%, #6a8a45 60%, #5a9a3a 85%,
  #5a9a3a 95%, #7a3a2a 100%)`;

type TimingMode = "symmetric" | "oneshot" | "charge";

export class TimingBar {
  private animFrame = 0;
  private startTime = 0;
  private resolve: ((power: number) => void) | null = null;
  private renderer: GameRenderer | null = null;
  private mode: TimingMode = "symmetric";
  private stopped = false;
  private charging = false;
  private chargeStart = 0;
  private chargePower = 0;

  private container: HTMLDivElement;
  private track: HTMLDivElement;
  private marker: HTMLDivElement;

  constructor(private clientState: ClientState) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: fixed;
      z-index: 200;
      display: none;
      pointer-events: none;
      transform: translateX(-50%);
    `;

    this.track = document.createElement("div");
    this.track.style.cssText = `
      position: relative;
      width: ${BAR_WIDTH}px;
      height: ${BAR_HEIGHT}px;
      border: 2px solid #5a4a38;
      border-radius: 3px;
      overflow: hidden;
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
    this.track.appendChild(this.marker);
    this.container.appendChild(this.track);

    document.body.appendChild(this.container);
  }

  setRenderer(renderer: GameRenderer) {
    this.renderer = renderer;
  }

  run(shapeKind: ShapeKind): Promise<number> {
    if (shapeKind === ShapeKind.Sector) this.mode = "oneshot";
    else if (shapeKind === ShapeKind.Rectangle || shapeKind === ShapeKind.Circle) this.mode = "charge";
    else this.mode = "symmetric";

    this.track.style.background = this.mode === "symmetric" ? GRADIENT_SYMMETRIC : GRADIENT_ONESHOT;
    this.stopped = false;
    this.charging = false;
    this.chargePower = 0;

    return new Promise((resolve) => {
      this.resolve = resolve;
      this.clientState.timingPower = 0;
      this.marker.style.left = "0px";
      this.container.style.display = "block";

      if (this.mode === "charge") {
        this.startCharge();
      } else {
        this.startTime = performance.now();
        this.bindStopListeners();
        this.tickAuto();
      }
    });
  }

  // --- Symmetric / Oneshot modes: marker moves automatically, click to stop ---

  private bindStopListeners() {
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      this.stop();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        cleanup();
        this.stop();
      }
    };
    const cleanup = () => {
      window.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
    window.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
  }

  private tickAuto() {
    if (this.stopped) return;
    const elapsed = performance.now() - this.startTime;

    let pos: number;
    let power: number;

    if (this.mode === "oneshot") {
      const t = (elapsed % ONESHOT_DURATION_MS) / ONESHOT_DURATION_MS;
      pos = t;
      power = t <= 0.95 ? t / 0.95 : 1 - (t - 0.95) / 0.05;
    } else {
      const t = (elapsed % SWEEP_DURATION_MS) / SWEEP_DURATION_MS;
      pos = Math.abs(2 * t - 1);
      power = 1 - Math.abs(2 * pos - 1);
    }

    this.clientState.timingPower = power;
    this.marker.style.left = `${pos * (BAR_WIDTH - 3)}px`;
    this.updatePosition();
    this.clientState.notify();
    this.animFrame = requestAnimationFrame(() => this.tickAuto());
  }

  // --- Charge mode: hold to fill, release to lock in ---

  private startCharge() {
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      beginHold();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        beginHold();
      }
    };
    const onMouseUp = () => {
      if (this.charging) { cleanup(); this.stop(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.key === " " || e.key === "Enter") && this.charging) {
        cleanup();
        this.stop();
      }
    };

    const beginHold = () => {
      if (this.charging || this.stopped) return;
      this.charging = true;
      this.chargeStart = performance.now();
      window.addEventListener("mouseup", onMouseUp);
      document.addEventListener("keyup", onKeyUp);
      this.tickCharge();
    };

    const cleanup = () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
    };

    window.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    this.updatePosition();
    this.clientState.notify();
  }

  private tickCharge() {
    if (this.stopped) return;
    const elapsed = performance.now() - this.chargeStart;
    const t = Math.min(elapsed / CHARGE_DURATION_MS, 1);
    const power = t <= 0.95 ? t / 0.95 : 1 - (t - 0.95) / 0.05;

    this.chargePower = power;
    this.clientState.timingPower = power;
    this.marker.style.left = `${t * (BAR_WIDTH - 3)}px`;
    this.updatePosition();
    this.clientState.notify();

    if (t >= 1) {
      this.stop();
      return;
    }
    this.animFrame = requestAnimationFrame(() => this.tickCharge());
  }

  // --- Shared ---

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
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.animFrame);

    const power = this.clientState.timingPower ?? 0;

    setTimeout(() => {
      this.container.style.display = "none";
      // Resolve while ui is still "attackTiming" so finishAttackTiming can read it and own the
      // transition. The timing bar must not mutate the interaction state machine itself — once
      // finishAttackTiming flips ui to "submittingAction", the timingPower getter returns null
      // on its own, so there is nothing to reset here.
      this.resolve?.(power);
      this.resolve = null;
    }, RESULT_HOLD_MS);
  }
}
