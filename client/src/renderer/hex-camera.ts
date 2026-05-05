import { Application, Container, Graphics, Sprite, Texture, Assets } from "pixi.js";

const DEFAULT_MAP_ZOOM = 2;
const MIN_MAP_ZOOM = 0.85;
const MAX_MAP_ZOOM = 3.5;
const ZOOM_STEP = 1.12;
const DRAG_THRESHOLD = 4;

export class HexCamera {
  private bgSprite: Sprite | null = null;
  private maskGfx = new Graphics();
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private centeredWorldX = 0;
  private centeredWorldY = 0;
  private userOffsetX = 0;
  private userOffsetY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private draggingPointerId: number | null = null;
  private movedDuringDrag = false;
  private suppressNextClick = false;
  private viewChangedCallback: (() => void) | null = null;

  constructor(private app: Application, private worldContainer: Container) {}

  init() {
    const bgTex: Texture = Assets.get("map-background");
    this.bgSprite = new Sprite(bgTex);
    this.bgSprite.anchor.set(0.5);
    this.app.stage.addChild(this.bgSprite);

    this.app.stage.addChild(this.worldContainer);

    this.worldContainer.mask = this.maskGfx;
    this.app.stage.addChild(this.maskGfx);

    this.app.canvas.addEventListener("pointerdown", (e) => {
      if (!this.worldContainer.visible || e.button !== 0) return;
      this.draggingPointerId = e.pointerId;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.movedDuringDrag = false;
      this.app.canvas.setPointerCapture(e.pointerId);
    });

    this.app.canvas.addEventListener("pointermove", (e) => {
      if (this.draggingPointerId !== e.pointerId) return;

      const totalDx = e.clientX - this.dragStartX;
      const totalDy = e.clientY - this.dragStartY;
      if (!this.movedDuringDrag && Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD) {
        return;
      }

      this.movedDuringDrag = true;
      this.panBy(e.clientX - this.lastPointerX, e.clientY - this.lastPointerY);
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    this.app.canvas.addEventListener("pointerup", (e) => this.endDrag(e));
    this.app.canvas.addEventListener("pointercancel", (e) => this.endDrag(e));
    this.app.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.worldContainer.visible) return;
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        this.zoomAt(e.clientX, e.clientY, zoomFactor);
      },
      { passive: false }
    );
  }

  show() {
    if (this.bgSprite) this.bgSprite.visible = true;
    this.worldContainer.visible = true;
  }

  hide() {
    if (this.bgSprite) this.bgSprite.visible = false;
    this.worldContainer.visible = false;
  }

  centerOn(worldX: number, worldY: number) {
    this.centeredWorldX = worldX;
    this.centeredWorldY = worldY;
    if (this.scale === 1) {
      this.scale = DEFAULT_MAP_ZOOM;
    }
    this.applyTransform();
    this.updateMask();
  }

  resetView() {
    this.scale = DEFAULT_MAP_ZOOM;
    this.userOffsetX = 0;
    this.userOffsetY = 0;
    this.applyTransform();
    this.notifyViewChanged();
  }

  hasUserChangedView(): boolean {
    return (
      Math.abs(this.scale - DEFAULT_MAP_ZOOM) > 0.01 ||
      Math.abs(this.userOffsetX) > 0.5 ||
      Math.abs(this.userOffsetY) > 0.5
    );
  }

  onViewChanged(cb: () => void) {
    this.viewChangedCallback = cb;
  }

  consumeSuppressedClick(): boolean {
    const shouldSuppress = this.suppressNextClick;
    this.suppressNextClick = false;
    return shouldSuppress;
  }

  private panBy(dx: number, dy: number) {
    this.userOffsetX += dx;
    this.userOffsetY += dy;
    this.applyTransform();
    this.notifyViewChanged();
  }

  zoomIn() {
    const rect = this.app.canvas.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ZOOM_STEP);
  }

  zoomOut() {
    const rect = this.app.canvas.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / ZOOM_STEP);
  }

  private zoomAt(clientX: number, clientY: number, factor: number) {
    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const world = this.screenToWorld(clientX, clientY);
    const nextScale = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, this.scale * factor));
    if (Math.abs(nextScale - this.scale) < 0.001) return;

    this.scale = nextScale;
    this.userOffsetX =
      screenX - world.x * this.scale - (this.app.screen.width / 2 - this.centeredWorldX * this.scale);
    this.userOffsetY =
      screenY - world.y * this.scale - (this.app.screen.height / 2 - this.centeredWorldY * this.scale);
    this.applyTransform();
    this.notifyViewChanged();
  }

  private endDrag(e: PointerEvent) {
    if (this.draggingPointerId !== e.pointerId) return;
    if (this.movedDuringDrag) {
      this.suppressNextClick = true;
    }
    this.draggingPointerId = null;
    this.movedDuringDrag = false;
    if (this.app.canvas.hasPointerCapture(e.pointerId)) {
      this.app.canvas.releasePointerCapture(e.pointerId);
    }
  }

  private applyTransform() {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    if (this.bgSprite) {
      this.bgSprite.position.set(screenW / 2, screenH / 2);
    }

    this.offsetX = screenW / 2 - this.centeredWorldX * this.scale + this.userOffsetX;
    this.offsetY = screenH / 2 - this.centeredWorldY * this.scale + this.userOffsetY;
    this.worldContainer.scale.set(this.scale);
    this.worldContainer.position.set(this.offsetX, this.offsetY);
  }

  private updateMask() {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    this.maskGfx.clear();
    if (this.bgSprite) {
      const bgW = this.bgSprite.texture.width;
      const bgH = this.bgSprite.texture.height;
      const bgLeft = screenW / 2 - bgW / 2;
      const bgTop = screenH / 2 - bgH / 2;
      this.maskGfx.rect(bgLeft, bgTop, bgW, bgH);
    } else {
      this.maskGfx.rect(0, 0, screenW, screenH);
    }
    this.maskGfx.fill({ color: 0xffffff });
  }

  private notifyViewChanged() {
    this.viewChangedCallback?.();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.offsetX) / this.scale,
      y: (sy - rect.top - this.offsetY) / this.scale,
    };
  }
}
