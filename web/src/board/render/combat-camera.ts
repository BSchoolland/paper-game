import type { Vec2 } from "shared";

const ZOOM_STEP = 1.12;
const MAX_ZOOM_OVER_COVER = 3;
const DRAG_THRESHOLD = 4;
const KEY_PAN_SPEED = 9;

/**
 * The combat board camera: the map always covers the full screen (min zoom = cover fit, pan
 * clamped to the map edges), so there is no letterbox. Gestures: wheel zooms at the cursor,
 * dragging pans (a drag past the threshold suppresses the click that follows it), WASD/arrows
 * pan. Pure math + DOM listeners; the owner applies `scale`/`offsetX`/`offsetY` to its world
 * container via the `onViewChanged` callback.
 */
export class CombatCamera {
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  private worldW = 0;
  private worldH = 0;
  /** View centre in world coordinates. */
  private centerX = 0;
  private centerY = 0;

  private enabled = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private draggingPointerId: number | null = null;
  private movedDuringDrag = false;
  private suppressNextClick = false;
  private keysDown = new Set<string>();
  private keyPanRAF: number | null = null;
  private panAnimId = 0;
  /** Set by any user gesture (drag/wheel/keys); consumers poll it to suspend auto-follow. */
  private userMoved = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private screenSize: () => { width: number; height: number },
    private onViewChanged: () => void,
  ) {
    this.bind();
  }

  setEnabled(val: boolean) {
    this.enabled = val;
    if (!val) {
      this.keysDown.clear();
      this.draggingPointerId = null;
      this.movedDuringDrag = false;
    }
  }

  /** (Re)fit to a world; keeps the current view when the world is unchanged (a resize). */
  setWorld(worldW: number, worldH: number) {
    const changed = worldW !== this.worldW || worldH !== this.worldH;
    this.worldW = worldW;
    this.worldH = worldH;
    if (changed) {
      this.scale = this.coverScale();
      this.centerX = worldW / 2;
      this.centerY = worldH / 2;
    }
    this.apply();
  }

  /** Pan the view centre to a world point (clamped). Used to open on the player's hero. */
  centerOn(world: Vec2) {
    this.panAnimId++; // cancel any eased pan
    this.centerX = world.x;
    this.centerY = world.y;
    this.apply();
  }

  /** Eased pan to a world point. Resolves when done; a user drag or a newer pan cancels it. */
  panTo(world: Vec2, ms: number): Promise<void> {
    const id = ++this.panAnimId;
    const fromX = this.centerX;
    const fromY = this.centerY;
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (id !== this.panAnimId || this.draggingPointerId !== null || !this.enabled) return resolve();
        const t = Math.min(1, (performance.now() - start) / ms);
        const e = t * t * (3 - 2 * t);
        this.centerX = fromX + (world.x - fromX) * e;
        this.centerY = fromY + (world.y - fromY) * e;
        this.apply();
        if (t >= 1) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** True if the user has panned/zoomed since the last call — read-and-clear. */
  consumeUserMoved(): boolean {
    const moved = this.userMoved;
    this.userMoved = false;
    return moved;
  }

  /** Smallest zoom at which the map still fills the whole screen. */
  private coverScale(): number {
    const { width, height } = this.screenSize();
    if (this.worldW === 0 || this.worldH === 0) return 1;
    return Math.max(width / this.worldW, height / this.worldH);
  }

  /** One drag past the threshold suppresses exactly one following click. */
  consumeSuppressedClick(): boolean {
    const suppress = this.suppressNextClick;
    this.suppressNextClick = false;
    return suppress;
  }

  screenToWorld(screen: Vec2): Vec2 {
    return { x: (screen.x - this.offsetX) / this.scale, y: (screen.y - this.offsetY) / this.scale };
  }

  worldToScreen(world: Vec2): Vec2 {
    return { x: world.x * this.scale + this.offsetX, y: world.y * this.scale + this.offsetY };
  }

  /** Clamp zoom + centre so the map always covers the screen, then recompute offsets. */
  private apply() {
    const { width, height } = this.screenSize();
    const cover = this.coverScale();
    this.scale = Math.min(Math.max(this.scale, cover), cover * MAX_ZOOM_OVER_COVER);

    const halfW = width / 2 / this.scale;
    const halfH = height / 2 / this.scale;
    this.centerX = Math.min(Math.max(this.centerX, halfW), this.worldW - halfW);
    this.centerY = Math.min(Math.max(this.centerY, halfH), this.worldH - halfH);

    this.offsetX = width / 2 - this.centerX * this.scale;
    this.offsetY = height / 2 - this.centerY * this.scale;
    this.onViewChanged();
  }

  private bind() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.enabled || (e.button !== 0 && e.button !== 1)) return;
      this.draggingPointerId = e.pointerId;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.movedDuringDrag = false;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (this.draggingPointerId !== e.pointerId) return;
      const totalDx = e.clientX - this.dragStartX;
      const totalDy = e.clientY - this.dragStartY;
      if (!this.movedDuringDrag && Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD) return;
      this.movedDuringDrag = true;
      this.panBy(e.clientX - this.lastPointerX, e.clientY - this.lastPointerY);
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    const endDrag = (e: PointerEvent) => {
      if (this.draggingPointerId !== e.pointerId) return;
      if (this.movedDuringDrag) this.suppressNextClick = true;
      this.draggingPointerId = null;
      this.movedDuringDrag = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      },
      { passive: false },
    );

    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        this.keysDown.add(key);
        this.startKeyPan();
      }
    });
    window.addEventListener("keyup", (e) => this.keysDown.delete(e.key.toLowerCase()));
  }

  private panBy(dx: number, dy: number) {
    this.userMoved = true;
    this.panAnimId++;
    this.centerX -= dx / this.scale;
    this.centerY -= dy / this.scale;
    this.apply();
  }

  private zoomAt(clientX: number, clientY: number, factor: number) {
    const rect = this.canvas.getBoundingClientRect();
    const anchor = this.screenToWorld({ x: clientX - rect.left, y: clientY - rect.top });
    const cover = this.coverScale();
    const next = Math.min(Math.max(this.scale * factor, cover), cover * MAX_ZOOM_OVER_COVER);
    if (Math.abs(next - this.scale) < 0.0001) return;
    this.userMoved = true;
    this.panAnimId++;
    // Keep the world point under the cursor fixed: shift the centre by the anchor's apparent move.
    const { width, height } = this.screenSize();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    this.scale = next;
    this.centerX = anchor.x - (sx - width / 2) / this.scale;
    this.centerY = anchor.y - (sy - height / 2) / this.scale;
    this.apply();
  }

  private startKeyPan() {
    if (this.keyPanRAF !== null) return;
    const tick = () => {
      let dx = 0;
      let dy = 0;
      if (this.keysDown.has("a") || this.keysDown.has("arrowleft")) dx += KEY_PAN_SPEED;
      if (this.keysDown.has("d") || this.keysDown.has("arrowright")) dx -= KEY_PAN_SPEED;
      if (this.keysDown.has("w") || this.keysDown.has("arrowup")) dy += KEY_PAN_SPEED;
      if (this.keysDown.has("s") || this.keysDown.has("arrowdown")) dy -= KEY_PAN_SPEED;
      if (dx !== 0 || dy !== 0) this.panBy(dx, dy);
      if (this.keysDown.size > 0 && this.enabled) this.keyPanRAF = requestAnimationFrame(tick);
      else this.keyPanRAF = null;
    };
    this.keyPanRAF = requestAnimationFrame(tick);
  }
}
