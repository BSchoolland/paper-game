import type { InventoryState, ItemDefinition } from "shared";
import { canEquip } from "shared";
import {
  type ItemPosition,
  type InteractionMode,
  type InfoTarget,
  PANEL_W,
  PANEL_H,
  UI_SCALE,
  HANDLE_RADIUS,
  SLOT_REGIONS,
  CLOSE_REGION,
  CHAR_REGION,
  hitRegion,
  getItemSize,
  getRotateHandlePos,
} from "./inventory-layout.js";

export interface InputCallbacks {
  getInventory(): InventoryState | null;
  getPosition(item: ItemDefinition, index: number): ItemPosition;
  getSelectedItemId(): string | null;
  setSelectedItemId(id: string | null): void;
  getPositionById(id: string): ItemPosition | undefined;
  setPosition(id: string, pos: ItemPosition): void;
  loadSprite(spriteId: string): HTMLImageElement | null;
  sendEquip(bagIndex: number): void;
  sendUnequip(equippedIndex: number): void;
  deletePosition(id: string): void;
  updateAttachment(id: string, pos: ItemPosition): void;
  close(): void;
  draw(): void;
}

export class InventoryInput {
  private mode: InteractionMode = { type: "idle" };
  private hoveredSlot = -1;
  private hoveredClose = false;
  private _infoTarget: InfoTarget = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: InputCallbacks,
  ) {
    this.attach();
  }

  getHoveredSlot() { return this.hoveredSlot; }
  getHoveredClose() { return this.hoveredClose; }
  getMode() { return this.mode; }
  getInfoTarget() { return this._infoTarget; }

  resetState() {
    this.mode = { type: "idle" };
    this.hoveredSlot = -1;
    this.hoveredClose = false;
  }

  private attach() {
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(this.toPanel(e)));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(this.toPanel(e)));
    this.canvas.addEventListener("mouseup", () => this.onMouseUp());
    this.canvas.addEventListener("mouseleave", () => this.onMouseLeave());
    this.canvas.addEventListener("click", (e) => this.onClick(this.toPanel(e)));
    this.canvas.addEventListener("wheel", (e) => {
      const selectedId = this.cb.getSelectedItemId();
      if (selectedId === null) return;
      const itemPos = this.cb.getPositionById(selectedId);
      if (!itemPos) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      itemPos.scale = Math.max(0.75, Math.min(1.25, itemPos.scale + delta));
      this.cb.draw();
    }, { passive: false });
  }

  private toPanel(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const canvasW = PANEL_W * UI_SCALE;
    const canvasH = PANEL_H * UI_SCALE;
    return {
      x: ((e.clientX - rect.left) * (canvasW / rect.width)) / UI_SCALE,
      y: ((e.clientY - rect.top) * (canvasH / rect.height)) / UI_SCALE,
    };
  }

  private alphaCache = new Map<string, ImageData>();

  private getSpriteAlpha(sprite: HTMLImageElement, spriteId: string): ImageData {
    let data = this.alphaCache.get(spriteId);
    if (data) return data;
    const c = document.createElement("canvas");
    c.width = sprite.naturalWidth;
    c.height = sprite.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(sprite, 0, 0);
    data = ctx.getImageData(0, 0, c.width, c.height);
    this.alphaCache.set(spriteId, data);
    return data;
  }

  private hitTestItem(x: number, y: number, pos: ItemPosition, item: ItemDefinition): boolean {
    const sprite = this.cb.loadSprite(item.sprite);
    const { w, h } = getItemSize(pos, item, sprite);
    const dx = x - pos.x;
    const dy = y - pos.y;
    const angle = -pos.rotation * (Math.PI / 180);
    const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (Math.abs(lx) >= w / 2 + 5 || Math.abs(ly) >= h / 2 + 5) return false;
    if (!sprite) return true;
    const imgData = this.getSpriteAlpha(sprite, item.sprite);
    const sx = Math.round(((lx + w / 2) / w) * sprite.naturalWidth);
    const sy = Math.round(((ly + h / 2) / h) * sprite.naturalHeight);
    if (sx < 0 || sy < 0 || sx >= sprite.naturalWidth || sy >= sprite.naturalHeight) return false;
    const alpha = imgData.data[(sy * sprite.naturalWidth + sx) * 4 + 3]!;
    return alpha > 10;
  }

  private hitRotateHandle(mx: number, my: number, pos: ItemPosition, item: ItemDefinition): boolean {
    const sprite = this.cb.loadSprite(item.sprite);
    const { h } = getItemSize(pos, item, sprite);
    const hp = getRotateHandlePos(pos, h);
    const dx = mx - hp.x;
    const dy = my - hp.y;
    return dx * dx + dy * dy <= (HANDLE_RADIUS + 4) ** 2;
  }

  private onMouseDown(pos: { x: number; y: number }) {
    const inventory = this.cb.getInventory();
    if (!inventory) return;

    const selectedId = this.cb.getSelectedItemId();
    if (selectedId !== null) {
      const idx = inventory.equipped.findIndex((it) => it.id === selectedId);
      if (idx >= 0) {
        const item = inventory.equipped[idx]!;
        const itemPos = this.cb.getPosition(item, idx);
        if (this.hitRotateHandle(pos.x, pos.y, itemPos, item)) {
          this.mode = {
            type: "rotating",
            startAngle: Math.atan2(pos.x - itemPos.x, -(pos.y - itemPos.y)),
            startRotation: itemPos.rotation,
          };
          return;
        }
      }
    }

    for (let i = 0; i < SLOT_REGIONS.length; i++) {
      if (!hitRegion(pos.x, pos.y, SLOT_REGIONS[i]!)) continue;
      if (i >= inventory.bag.length) break;
      const item = inventory.bag[i];
      if (item) {
        this.mode = { type: "bag-pending", bagIndex: i, startX: pos.x, startY: pos.y };
        return;
      }
    }

    for (let i = inventory.equipped.length - 1; i >= 0; i--) {
      const item = inventory.equipped[i]!;
      const itemPos = this.cb.getPosition(item, i);
      if (this.hitTestItem(pos.x, pos.y, itemPos, item)) {
        this.cb.setSelectedItemId(item.id);
        this._infoTarget = { source: "equipped", id: item.id };
        this.mode = {
          type: "dragging",
          offsetX: pos.x - itemPos.x,
          offsetY: pos.y - itemPos.y,
        };
        this.cb.draw();
        return;
      }
    }

    this.cb.setSelectedItemId(null);
    this._infoTarget = null;
    this.cb.draw();
  }

  private static readonly DRAG_THRESHOLD = 6;

  private onMouseMove(pos: { x: number; y: number }) {
    if (this.mode.type === "bag-pending") {
      const dx = pos.x - this.mode.startX;
      const dy = pos.y - this.mode.startY;
      if (dx * dx + dy * dy > InventoryInput.DRAG_THRESHOLD ** 2) {
        const inventory = this.cb.getInventory();
        if (inventory) {
          const item = inventory.bag[this.mode.bagIndex];
          if (item && canEquip(inventory.equipped, item)) {
            this.cb.setPosition(item.id, { x: pos.x, y: pos.y, scale: 1, rotation: 0 });
            this.cb.sendEquip(this.mode.bagIndex);
            this.cb.setSelectedItemId(item.id);
            this._infoTarget = { source: "equipped", id: item.id };
            this.mode = { type: "dragging", offsetX: 0, offsetY: 0 };
            this.cb.draw();
            return;
          }
        }
        this.mode = { type: "idle" };
      }
      return;
    }

    const selectedId = this.cb.getSelectedItemId();
    if (selectedId !== null) {
      const itemPos = this.cb.getPositionById(selectedId);
      if (itemPos) {
        if (this.mode.type === "rotating") {
          const angle = Math.atan2(pos.x - itemPos.x, -(pos.y - itemPos.y));
          const delta = (angle - this.mode.startAngle) * (180 / Math.PI);
          itemPos.rotation = this.mode.startRotation + delta;
          this.cb.draw();
          return;
        }
        if (this.mode.type === "dragging") {
          itemPos.x = pos.x - this.mode.offsetX;
          itemPos.y = pos.y - this.mode.offsetY;
          this.cb.draw();
          return;
        }
      }
    }

    this.updateHover(pos);
  }

  private onMouseUp() {
    if (this.mode.type === "bag-pending") {
      const inventory = this.cb.getInventory();
      if (inventory) {
        const item = inventory.bag[this.mode.bagIndex];
        if (item) {
          this.cb.setSelectedItemId(null);
          this._infoTarget = { source: "bag", index: this.mode.bagIndex };
        }
      }
      this.mode = { type: "idle" };
      this.cb.draw();
      return;
    }

    const selectedId = this.cb.getSelectedItemId();
    if (this.mode.type === "dragging" && selectedId !== null) {
      const inventory = this.cb.getInventory();
      if (inventory) {
        const idx = inventory.equipped.findIndex((it) => it.id === selectedId);
        if (idx >= 0) {
          const itemPos = this.cb.getPosition(inventory.equipped[idx]!, idx);
          if (!hitRegion(itemPos.x, itemPos.y, CHAR_REGION)) {
            this.cb.sendUnequip(idx);
            this.cb.deletePosition(selectedId);
            this.cb.setSelectedItemId(null);
            this._infoTarget = null;
          } else {
            this.cb.updateAttachment(selectedId, itemPos);
          }
        }
      }
    }
    if (this.mode.type === "rotating" && selectedId !== null) {
      const inventory = this.cb.getInventory();
      if (inventory) {
        const idx = inventory.equipped.findIndex((it) => it.id === selectedId);
        if (idx >= 0) {
          const itemPos = this.cb.getPosition(inventory.equipped[idx]!, idx);
          this.cb.updateAttachment(selectedId, itemPos);
        }
      }
    }
    this.mode = { type: "idle" };
    this.cb.draw();
  }

  private onMouseLeave() {
    this.mode = { type: "idle" };
    this.hoveredSlot = -1;
    this.hoveredClose = false;
    this.cb.draw();
  }

  private onClick(pos: { x: number; y: number }) {
    if (hitRegion(pos.x, pos.y, CLOSE_REGION)) {
      this.cb.close();
      return;
    }
  }

  private updateHover(pos: { x: number; y: number }) {
    this.hoveredClose = hitRegion(pos.x, pos.y, CLOSE_REGION);

    let newHovered = -1;
    for (let i = 0; i < SLOT_REGIONS.length; i++) {
      if (hitRegion(pos.x, pos.y, SLOT_REGIONS[i]!)) {
        newHovered = i;
        break;
      }
    }

    let cursor = "default";
    if (this.hoveredClose) cursor = "pointer";
    else if (newHovered >= 0) {
      const inventory = this.cb.getInventory();
      if (inventory && newHovered < inventory.bag.length) {
        const item = inventory.bag[newHovered];
        if (item) cursor = canEquip(inventory.equipped, item) ? "grab" : "pointer";
      }
    }

    const selectedId = this.cb.getSelectedItemId();
    if (selectedId !== null) {
      const inventory = this.cb.getInventory();
      if (inventory) {
        const idx = inventory.equipped.findIndex((it) => it.id === selectedId);
        if (idx >= 0) {
          const item = inventory.equipped[idx]!;
          const itemPos = this.cb.getPosition(item, idx);
          if (this.hitRotateHandle(pos.x, pos.y, itemPos, item)) {
            cursor = "grab";
          }
        }
      }
    }

    if (cursor === "default") {
      const inventory = this.cb.getInventory();
      if (inventory) {
        for (let i = inventory.equipped.length - 1; i >= 0; i--) {
          const item = inventory.equipped[i]!;
          const itemPos = this.cb.getPosition(item, i);
          if (this.hitTestItem(pos.x, pos.y, itemPos, item)) {
            cursor = "grab";
            break;
          }
        }
      }
    }

    this.canvas.style.cursor = cursor;

    if (newHovered !== this.hoveredSlot) {
      this.hoveredSlot = newHovered;
      this.cb.draw();
    }
  }
}
