import type { Screen } from "./screen-manager.js";
import type { Connection } from "../net/connection.js";
import type { InventoryState, ItemDefinition } from "shared";
import { PLAYER_SLOTS, canEquip } from "shared";
import type { SlotType } from "shared";

import regionsData from "../../public/sprites/ui/inventory-panel-regions.json";

interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ItemPosition {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

type InteractionMode =
  | { type: "idle" }
  | { type: "dragging"; offsetX: number; offsetY: number }
  | { type: "rotating"; startAngle: number; startRotation: number };

const REGIONS: Region[] = regionsData.regions;
const PANEL_W = 806;
const PANEL_H = 895;
const UI_SCALE = 1.25;

const SLOT_REGIONS = REGIONS.filter((r) => r.name.startsWith("slot-"));
const CLOSE_REGION = REGIONS.find((r) => r.name === "close-button")!;
const CHAR_REGION = REGIONS.find((r) => r.name === "character-area")!;

const RARITY_COLORS: Record<string, string> = {
  common: "#8b8b7a",
  uncommon: "#5a7a3a",
  rare: "#4a6ab0",
  epic: "#8a4ab0",
  legendary: "#c47030",
};

const TARGET_SIZE = 64;

const TYPE_BASE_SCALE: Record<string, number> = {
  weapon: 2.5,
  shield: 2.5,
  consumable: 0.7,
  accessory: 0.8,
};

const SLOT_LABELS: { type: SlotType; label: string }[] = [
  { type: "hand", label: "Hand" },
  { type: "hat", label: "Hat" },
  { type: "utility", label: "Util" },
  { type: "accessory", label: "Acc" },
];

export class InventoryScreen implements Screen {
  private container: HTMLDivElement;
  private inventory: InventoryState | null = null;
  private onCloseCallback: (() => void) | null = null;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;

  private built = false;
  private panelImage: HTMLImageElement | null = null;
  private charImage: HTMLImageElement | null = null;
  private spriteImages = new Map<string, HTMLImageElement>();

  private positions = new Map<string, ItemPosition>();
  private selectedItemId: string | null = null;
  private mode: InteractionMode = { type: "idle" };

  private hoveredSlot = -1;
  private hoveredClose = false;

  constructor(private conn: Connection) {
    this.container = document.createElement("div");
    this.container.style.display = "none";
    document.body.appendChild(this.container);

    conn.on("inventory", (msg) => {
      this.inventory = msg.inventory;
      if (this.container.style.display !== "none") {
        this.draw();
      }
    });
  }

  onClose(cb: () => void) {
    this.onCloseCallback = cb;
  }

  setInventory(inv: InventoryState) {
    this.inventory = inv;
  }

  enter() {
    if (!this.built) this.buildUI();
    if (!this.panelImage) {
      const img = new Image();
      img.src = "sprites/ui/inventory-panel.png";
      img.onload = () => {
        this.panelImage = img;
        this.draw();
      };
    }
    if (!this.charImage) {
      const img = new Image();
      img.src = "sprites/char1/inventory-idle.png";
      img.onload = () => {
        this.charImage = img;
        this.draw();
      };
    }
    this.container.style.display = "flex";
    this.draw();
  }

  exit() {
    this.container.style.display = "none";
  }

  private getPosition(item: ItemDefinition, index: number): ItemPosition {
    let pos = this.positions.get(item.id);
    if (!pos) {
      const cx = CHAR_REGION.x + CHAR_REGION.w / 2;
      const cy = CHAR_REGION.y + CHAR_REGION.h / 2;
      const equipped = this.inventory!.equipped;
      pos = {
        x: cx + (index - equipped.length / 2) * 40,
        y: cy,
        scale: 1,
        rotation: 0,
      };
      this.positions.set(item.id, pos);
    }
    return pos;
  }

  private buildUI() {
    this.built = true;

    Object.assign(this.container.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(26, 20, 14, 0.6)",
      zIndex: "100",
    });

    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(PANEL_W * UI_SCALE);
    this.canvas.height = Math.round(PANEL_H * UI_SCALE);
    Object.assign(this.canvas.style, {
      maxWidth: "min(90vw, 625px)",
      maxHeight: "90vh",
      cursor: "default",
    });
    this.ctx = this.canvas.getContext("2d")!;

    this.container.appendChild(this.canvas);
    this.attachEvents();
  }

  private canvasToPanel(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const canvasW = PANEL_W * UI_SCALE;
    const canvasH = PANEL_H * UI_SCALE;
    return {
      x: ((e.clientX - rect.left) * (canvasW / rect.width)) / UI_SCALE,
      y: ((e.clientY - rect.top) * (canvasH / rect.height)) / UI_SCALE,
    };
  }

  private hitRegion(px: number, py: number, r: Region): boolean {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  private getItemSize(pos: ItemPosition, item: ItemDefinition): { w: number; h: number } {
    const baseScale = item.visualScale ?? TYPE_BASE_SCALE[item.type] ?? 1;
    const img = this.loadSprite(item.sprite);
    if (img) {
      const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      const normalize = TARGET_SIZE / maxDim;
      return {
        w: img.naturalWidth * normalize * baseScale * pos.scale,
        h: img.naturalHeight * normalize * baseScale * pos.scale,
      };
    }
    return { w: TARGET_SIZE * baseScale * pos.scale, h: TARGET_SIZE * baseScale * pos.scale };
  }

  private readonly HANDLE_STEM = 28;
  private readonly HANDLE_RADIUS = 11;

  private getRotateHandlePos(pos: ItemPosition, item: ItemDefinition): { x: number; y: number } {
    const { h } = this.getItemSize(pos, item);
    const dist = h / 2 + 3 + this.HANDLE_STEM + this.HANDLE_RADIUS;
    const rad = pos.rotation * (Math.PI / 180);
    return {
      x: pos.x - Math.sin(rad) * dist,
      y: pos.y - Math.cos(rad) * dist,
    };
  }

  private hitRotateHandle(mx: number, my: number, pos: ItemPosition, item: ItemDefinition): boolean {
    const hp = this.getRotateHandlePos(pos, item);
    const dx = mx - hp.x;
    const dy = my - hp.y;
    return dx * dx + dy * dy <= (this.HANDLE_RADIUS + 4) ** 2;
  }

  private itemOverlapsCharArea(pos: ItemPosition): boolean {
    return this.hitRegion(pos.x, pos.y, CHAR_REGION);
  }

  private hitTestItem(x: number, y: number, pos: ItemPosition, item: ItemDefinition): boolean {
    const { w, h } = this.getItemSize(pos, item);
    const dx = x - pos.x;
    const dy = y - pos.y;
    const angle = -pos.rotation * (Math.PI / 180);
    const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(lx) < w / 2 + 5 && Math.abs(ly) < h / 2 + 5;
  }

  private attachEvents() {
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(this.canvasToPanel(e)));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(this.canvasToPanel(e)));
    this.canvas.addEventListener("mouseup", () => this.onMouseUp());
    this.canvas.addEventListener("mouseleave", () => this.onMouseLeave());
    this.canvas.addEventListener("click", (e) => this.onClick(this.canvasToPanel(e)));
    this.canvas.addEventListener("wheel", (e) => {
      if (this.selectedItemId === null) return;
      const itemPos = this.positions.get(this.selectedItemId);
      if (!itemPos) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      itemPos.scale = Math.max(0.75, Math.min(1.25, itemPos.scale + delta));
      this.draw();
    }, { passive: false });
  }

  private onMouseDown(pos: { x: number; y: number }) {
    if (!this.inventory) return;

    if (this.selectedItemId !== null) {
      const idx = this.inventory.equipped.findIndex((it) => it.id === this.selectedItemId);
      if (idx >= 0) {
        const item = this.inventory.equipped[idx]!;
        const itemPos = this.getPosition(item, idx);
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

    for (let i = this.inventory.equipped.length - 1; i >= 0; i--) {
      const item = this.inventory.equipped[i]!;
      const itemPos = this.getPosition(item, i);
      if (this.hitTestItem(pos.x, pos.y, itemPos, item)) {
        this.selectedItemId = item.id;
        this.mode = {
          type: "dragging",
          offsetX: pos.x - itemPos.x,
          offsetY: pos.y - itemPos.y,
        };
        this.draw();
        return;
      }
    }

    this.selectedItemId = null;
    this.draw();
  }

  private onMouseMove(pos: { x: number; y: number }) {
    if (this.selectedItemId !== null) {
      const itemPos = this.positions.get(this.selectedItemId);
      if (itemPos) {
        if (this.mode.type === "rotating") {
          const angle = Math.atan2(pos.x - itemPos.x, -(pos.y - itemPos.y));
          const delta = (angle - this.mode.startAngle) * (180 / Math.PI);
          itemPos.rotation = this.mode.startRotation + delta;
          this.draw();
          return;
        }
        if (this.mode.type === "dragging") {
          itemPos.x = pos.x - this.mode.offsetX;
          itemPos.y = pos.y - this.mode.offsetY;
          this.draw();
          return;
        }
      }
    }

    this.updateHover(pos);
  }

  private onMouseUp() {
    if (this.mode.type === "dragging" && this.selectedItemId !== null && this.inventory) {
      const idx = this.inventory.equipped.findIndex((it) => it.id === this.selectedItemId);
      if (idx >= 0) {
        const itemPos = this.getPosition(this.inventory.equipped[idx]!, idx);
        if (!this.itemOverlapsCharArea(itemPos)) {
          this.conn.send({ type: "unequip", equippedIndex: idx });
          this.positions.delete(this.selectedItemId);
          this.selectedItemId = null;
        }
      }
    }
    this.mode = { type: "idle" };
    this.draw();
  }

  private onMouseLeave() {
    this.mode = { type: "idle" };
    this.hoveredSlot = -1;
    this.hoveredClose = false;
    this.draw();
  }

  private onClick(pos: { x: number; y: number }) {
    if (this.hitRegion(pos.x, pos.y, CLOSE_REGION)) {
      this.onCloseCallback?.();
      return;
    }

    if (!this.inventory) return;

    for (let i = 0; i < SLOT_REGIONS.length; i++) {
      if (!this.hitRegion(pos.x, pos.y, SLOT_REGIONS[i]!)) continue;
      const bagItem = this.getBagItemForSlot(i);
      if (bagItem !== null) {
        this.conn.send({ type: "equip", bagIndex: bagItem.bagIndex });
        return;
      }
    }
  }

  private updateHover(pos: { x: number; y: number }) {
    this.hoveredClose = this.hitRegion(pos.x, pos.y, CLOSE_REGION);

    let newHovered = -1;
    for (let i = 0; i < SLOT_REGIONS.length; i++) {
      if (this.hitRegion(pos.x, pos.y, SLOT_REGIONS[i]!)) {
        newHovered = i;
        break;
      }
    }

    let cursor = "default";
    if (this.hoveredClose) cursor = "pointer";
    else if (newHovered >= 0 && this.getBagItemForSlot(newHovered)) cursor = "pointer";

    if (this.selectedItemId !== null && this.inventory) {
      const idx = this.inventory.equipped.findIndex((it) => it.id === this.selectedItemId);
      if (idx >= 0) {
        const item = this.inventory.equipped[idx]!;
        const itemPos = this.getPosition(item, idx);
        if (this.hitRotateHandle(pos.x, pos.y, itemPos, item)) {
          cursor = "grab";
        }
      }
    }

    if (cursor === "default" && this.inventory) {
      for (let i = this.inventory.equipped.length - 1; i >= 0; i--) {
        const item = this.inventory.equipped[i]!;
        const itemPos = this.getPosition(item, i);
        if (this.hitTestItem(pos.x, pos.y, itemPos, item)) {
          cursor = "grab";
          break;
        }
      }
    }

    this.canvas.style.cursor = cursor;

    if (newHovered !== this.hoveredSlot) {
      this.hoveredSlot = newHovered;
      this.draw();
    }
  }

  private getBagItemForSlot(slotIdx: number): { item: ItemDefinition; bagIndex: number } | null {
    if (!this.inventory) return null;
    if (slotIdx >= 0 && slotIdx < this.inventory.bag.length) {
      const item = this.inventory.bag[slotIdx];
      if (item && canEquip(this.inventory.equipped, item)) {
        return { item, bagIndex: slotIdx };
      }
    }
    return null;
  }

  private loadSprite(spriteId: string): HTMLImageElement | null {
    if (this.spriteImages.has(spriteId)) {
      const img = this.spriteImages.get(spriteId)!;
      return img.naturalWidth > 0 ? img : null;
    }
    const img = new Image();
    img.src = `sprites/items/${spriteId}.webp`;
    img.onload = () => this.draw();
    this.spriteImages.set(spriteId, img);
    return null;
  }

  private draw() {
    const ctx = this.ctx;
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(UI_SCALE, UI_SCALE);

    if (this.panelImage) {
      ctx.drawImage(this.panelImage, 0, 0);
    }

    this.drawCharacter();
    this.drawPlacedItems();
    this.drawSlotContents();
    this.drawSlotSummary();

    if (this.hoveredSlot >= 0) {
      this.drawSlotHighlight(SLOT_REGIONS[this.hoveredSlot]!);
    }
    if (this.hoveredClose) {
      this.drawSlotHighlight(CLOSE_REGION);
    }

    if (this.selectedItemId !== null && this.inventory) {
      const idx = this.inventory.equipped.findIndex((it) => it.id === this.selectedItemId);
      if (idx >= 0) {
        const item = this.inventory.equipped[idx]!;
        const pos = this.getPosition(item, idx);
        this.drawSelection(pos, item);
      }
    }
  }

  private drawCharacter() {
    if (!this.charImage) return;
    const ctx = this.ctx;
    const r = CHAR_REGION;
    const aspect = this.charImage.naturalWidth / this.charImage.naturalHeight;
    let dw = r.w;
    let dh = dw / aspect;
    if (dh > r.h) {
      dh = r.h;
      dw = dh * aspect;
    }
    const dx = r.x + (r.w - dw) / 2;
    const dy = r.y + (r.h - dh) / 2;
    ctx.drawImage(this.charImage, dx, dy, dw, dh);
  }

  private drawPlacedItems() {
    if (!this.inventory) return;
    const ctx = this.ctx;

    for (let i = 0; i < this.inventory.equipped.length; i++) {
      const item = this.inventory.equipped[i]!;
      const pos = this.getPosition(item, i);
      const { w, h } = this.getItemSize(pos, item);
      const img = this.loadSprite(item.sprite);
      const wouldUnequip =
        this.mode.type === "dragging" && item.id === this.selectedItemId && !this.itemOverlapsCharArea(pos);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.rotation * (Math.PI / 180));

      if (img) {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = "#d4c4a8";
        ctx.strokeStyle = RARITY_COLORS[item.rarity] ?? "#8b8b7a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 6 * pos.scale);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#2a2520";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.name, 0, 0);
      }

      if (wouldUnequip) {
        ctx.fillStyle = "rgba(200, 40, 40, 0.35)";
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }

      ctx.restore();
    }
  }

  private drawSelection(pos: ItemPosition, item: ItemDefinition) {
    const ctx = this.ctx;
    const { w, h } = this.getItemSize(pos, item);

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(pos.rotation * (Math.PI / 180));

    ctx.strokeStyle = "rgba(196, 112, 48, 0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
    ctx.setLineDash([]);

    const stemStart = -h / 2 - 3;
    const stemEnd = stemStart - this.HANDLE_STEM;
    const handleY = stemEnd - this.HANDLE_RADIUS;

    ctx.strokeStyle = "rgba(196, 112, 48, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, stemStart);
    ctx.lineTo(0, stemEnd);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, handleY, this.HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(196, 112, 48, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, handleY, 5, -Math.PI * 0.75, Math.PI * 0.5);
    ctx.strokeStyle = "rgba(196, 112, 48, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    const tipAngle = Math.PI * 0.5;
    const tipX = Math.cos(tipAngle) * 5;
    const tipY = handleY + Math.sin(tipAngle) * 5;
    ctx.beginPath();
    ctx.moveTo(tipX - 3, tipY - 3.5);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX + 3.5, tipY - 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawSlotContents() {
    if (!this.inventory) return;
    const ctx = this.ctx;

    for (let i = 0; i < SLOT_REGIONS.length; i++) {
      const r = SLOT_REGIONS[i]!;
      if (i >= this.inventory.bag.length) break;
      const item = this.inventory.bag[i];
      if (!item) continue;

      const equipable = canEquip(this.inventory.equipped, item);
      const img = this.loadSprite(item.sprite);

      if (!equipable) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }

      if (img) {
        const padding = 6;
        const aspect = img.naturalWidth / img.naturalHeight;
        let dw = r.w - padding * 2;
        let dh = dw / aspect;
        if (dh > r.h - padding * 2) {
          dh = r.h - padding * 2;
          dw = dh * aspect;
        }
        const dx = r.x + (r.w - dw) / 2;
        const dy = r.y + (r.h - dh) / 2;

        if (!equipable) ctx.globalAlpha = 0.4;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = equipable ? "#2a2520" : "#8b8b7a";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.name.slice(0, 6), r.x + r.w / 2, r.y + r.h / 2);
      }

      const borderColor = RARITY_COLORS[item.rarity] ?? "#8b8b7a";
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  private drawSlotHighlight(r: Region) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  private drawSlotSummary() {
    if (!this.inventory) return;
    const ctx = this.ctx;
    const used = this.getUsedSlots(this.inventory.equipped);
    const text = SLOT_LABELS
      .map(({ type, label }) => `${label}: ${used[type]}/${PLAYER_SLOTS[type]}`)
      .join("   ");

    ctx.fillStyle = "#4a4035";
    ctx.font = "18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, PANEL_W / 2, 490);
  }

  private getUsedSlots(equipped: readonly ItemDefinition[]): Record<SlotType, number> {
    const used: Record<SlotType, number> = { hand: 0, hat: 0, utility: 0, accessory: 0 };
    for (const item of equipped) {
      for (const [slot, count] of Object.entries(item.slotCost) as [SlotType, number][]) {
        used[slot] += count;
      }
    }
    return used;
  }
}
