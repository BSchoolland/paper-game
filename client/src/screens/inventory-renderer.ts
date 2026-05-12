import type { InventoryState, ItemDefinition } from "shared";
import { PLAYER_SLOTS } from "shared";
import { itemSpriteUrl } from "../renderer/item-sprites.js";
import type { SlotType } from "shared";
import { canEquip } from "shared";
import {
  type ItemPosition,
  type InteractionMode,
  type InfoTarget,
  type Region,
  PANEL_W,
  PANEL_H,
  UI_SCALE,
  HANDLE_STEM,
  HANDLE_RADIUS,
  SLOT_REGIONS,
  CLOSE_REGION,
  CHAR_REGION,
  RARITY_COLORS,
  SLOT_LABELS,
  hitRegion,
  getItemSize,
} from "./inventory-layout.js";

export interface RenderState {
  inventory: InventoryState | null;
  positions: Map<string, ItemPosition>;
  selectedItemId: string | null;
  mode: InteractionMode;
  hoveredSlot: number;
  hoveredClose: boolean;
  panelImage: HTMLImageElement | null;
  charImage: HTMLImageElement | null;
  infoTarget: InfoTarget;
}

export class InventoryRenderer {
  private spriteImages = new Map<string, HTMLImageElement>();
  private onSpriteLoad: () => void;
  private _lastLogTime = 0;

  constructor(onSpriteLoad: () => void) {
    this.onSpriteLoad = onSpriteLoad;
  }

  loadSprite(spriteId: string, dimensionId: number): HTMLImageElement | null {
    const key = `${dimensionId}/${spriteId}`;
    if (this.spriteImages.has(key)) {
      const img = this.spriteImages.get(key)!;
      return img.naturalWidth > 0 ? img : null;
    }
    const img = new Image();
    img.src = itemSpriteUrl({ sprite: spriteId, dimensionId });
    img.onload = () => this.onSpriteLoad();
    this.spriteImages.set(key, img);
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: RenderState) {
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(UI_SCALE, UI_SCALE);

    if (state.panelImage) {
      ctx.drawImage(state.panelImage, 0, 0);
    }

    this.drawCharacter(ctx, state);
    this.drawPlacedItems(ctx, state);
    this.drawSlotContents(ctx, state);
    this.drawSlotSummary(ctx, state);

    if (state.hoveredSlot >= 0) {
      this.drawSlotHighlight(ctx, SLOT_REGIONS[state.hoveredSlot]!);
    }
    if (state.hoveredClose) {
      this.drawSlotHighlight(ctx, CLOSE_REGION);
    }

    if (state.selectedItemId !== null && state.inventory) {
      const idx = state.inventory.equipped.findIndex((it) => it.id === state.selectedItemId);
      if (idx >= 0) {
        const item = state.inventory.equipped[idx]!;
        const pos = state.positions.get(item.id);
        if (pos) this.drawSelection(ctx, pos, item);
      }
    }

  }

  private drawCharacter(ctx: CanvasRenderingContext2D, state: RenderState) {
    if (!state.charImage) return;
    const r = CHAR_REGION;
    const aspect = state.charImage.naturalWidth / state.charImage.naturalHeight;
    let dw = r.w;
    let dh = dw / aspect;
    if (dh > r.h) {
      dh = r.h;
      dw = dh * aspect;
    }
    const dx = r.x + (r.w - dw) / 2;
    const dy = r.y + (r.h - dh) / 2;
    ctx.drawImage(state.charImage, dx, dy, dw, dh);
  }

  private drawPlacedItems(ctx: CanvasRenderingContext2D, state: RenderState) {
    if (!state.inventory) return;

    for (let i = 0; i < state.inventory.equipped.length; i++) {
      const item = state.inventory.equipped[i]!;
      const pos = state.positions.get(item.id);
      if (!pos) continue;
      const sprite = this.loadSprite(item.sprite, item.dimensionId);
      const { w, h } = getItemSize(pos, item, sprite);
      const now = performance.now();
      if (now - this._lastLogTime > 2000) {
        this._lastLogTime = now;
        const charH = state.charImage?.naturalHeight ?? 0;
        const charDrawH = state.charImage ? (() => {
          const r = CHAR_REGION;
          const aspect = state.charImage!.naturalWidth / state.charImage!.naturalHeight;
          let dh = r.w / aspect;
          if (dh > r.h) dh = r.h;
          return dh;
        })() : 0;
      }
      const wouldUnequip =
        state.mode.type === "dragging" &&
        item.id === state.selectedItemId &&
        !hitRegion(pos.x, pos.y, CHAR_REGION);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.rotation * (Math.PI / 180));

      if (sprite) {
        ctx.shadowColor = "black";
        ctx.shadowBlur = 0;
        const o = 2;
        for (let sx = -o; sx <= o; sx++) {
          for (let sy = -o; sy <= o; sy++) {
            if (sx === 0 && sy === 0) continue;
            if (sx * sx + sy * sy > o * o) continue;
            ctx.shadowOffsetX = sx;
            ctx.shadowOffsetY = sy;
          ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
          }
        }
        ctx.shadowColor = "transparent";
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
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

  private drawSelection(ctx: CanvasRenderingContext2D, pos: ItemPosition, item: ItemDefinition) {
    const sprite = this.loadSprite(item.sprite, item.dimensionId);
    const { w, h } = getItemSize(pos, item, sprite);

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(pos.rotation * (Math.PI / 180));

    ctx.strokeStyle = "rgba(196, 112, 48, 0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
    ctx.setLineDash([]);

    const stemStart = -h / 2 - 3;
    const stemEnd = stemStart - HANDLE_STEM;
    const handleY = stemEnd - HANDLE_RADIUS;

    ctx.strokeStyle = "rgba(196, 112, 48, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, stemStart);
    ctx.lineTo(0, stemEnd);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, handleY, HANDLE_RADIUS, 0, Math.PI * 2);
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

  private drawSlotContents(ctx: CanvasRenderingContext2D, state: RenderState) {
    if (!state.inventory) return;

    for (let i = 0; i < SLOT_REGIONS.length; i++) {
      const r = SLOT_REGIONS[i]!;
      if (i >= state.inventory.bag.length) break;
      const item = state.inventory.bag[i];
      if (!item) continue;

      const equipable = canEquip(state.inventory.equipped, item);
      const img = this.loadSprite(item.sprite, item.dimensionId);

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

      const selected = state.infoTarget?.source === "bag" && state.infoTarget.index === i;
      const borderColor = selected ? "#c47030" : (RARITY_COLORS[item.rarity] ?? "#8b8b7a");
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      if (selected) {
        ctx.fillStyle = "rgba(196, 112, 48, 0.12)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
  }

  private drawSlotHighlight(ctx: CanvasRenderingContext2D, r: Region) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  private drawSlotSummary(ctx: CanvasRenderingContext2D, state: RenderState) {
    if (!state.inventory) return;
    const used: Record<SlotType, number> = { hand: 0, hat: 0, utility: 0, accessory: 0 };
    for (const item of state.inventory.equipped) {
      for (const [slot, count] of Object.entries(item.slotCost) as [SlotType, number][]) {
        used[slot] += count;
      }
    }
    const text = SLOT_LABELS
      .map(({ type, label }) => `${label}: ${used[type]}/${PLAYER_SLOTS[type]}`)
      .join("   ");

    ctx.fillStyle = "#4a4035";
    ctx.font = "18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, PANEL_W / 2, 490);
  }
}
