import type { AttachmentData, InventoryState, ItemDefinition, WeaponItem, ShieldItem, ConsumableItem, AccessoryItem } from "shared";
import { ShapeKind, describeWeaponEffect } from "shared";
import {
  type ItemPosition,
  PANEL_W,
  PANEL_H,
  UI_SCALE,
  CHAR_REGION,
  type InfoTarget,
  RARITY_COLORS,
  TARGET_SIZE,
  TYPE_BASE_SCALE,
} from "./inventory-layout.js";
import { InventoryRenderer } from "./inventory-renderer.js";
import { InventoryInput } from "./inventory-input.js";
import { loadCharacterAnchors, getFrameAnchors } from "../render/anchor-loader.js";
import { computeAttachment, type CharacterAnchors, type AnchorSet } from "../render/bone-transform.js";
import { assetUrl } from "../../lib/urls.js";

export interface PackEditorHooks {
  canEdit(): boolean;
  sendEquip(bagIndex: number): void;
  sendUnequip(equippedIndex: number): void;
  sendAttachment(itemId: string, attachment: AttachmentData): void;
  onClose(): void;
}

/**
 * The paper-doll pack editor (ported from the prototype's InventoryScreen): the painted panel
 * canvas where dragging an item out of the bag equips it ONTO the character, free placement /
 * wheel-scale / handle-rotate author its AttachmentData, and dragging it off the character
 * stows it. The placement you draw here is exactly what the combat/overworld dolls wear.
 * Editor item positions are session-local (prototype parity) — the authored attachment itself
 * is durable on the server.
 */
export class PackEditor {
  private inventory: InventoryState | null = null;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private statsPanel!: HTMLDivElement;

  private panelImage: HTMLImageElement | null = null;
  private charImage: HTMLImageElement | null = null;

  private positions = new Map<string, ItemPosition>();
  private selectedItemId: string | null = null;

  private renderer!: InventoryRenderer;
  private input!: InventoryInput;
  private characterAnchors: CharacterAnchors | null = null;

  constructor(
    private root: HTMLElement,
    private hooks: PackEditorHooks,
  ) {
    this.buildUI();
    const panel = new Image();
    panel.src = assetUrl("sprites/ui/inventory-panel.png");
    panel.onload = () => {
      this.panelImage = panel;
      this.draw();
    };
    const char = new Image();
    char.src = assetUrl("sprites/char1/inventory-idle.png");
    char.onload = () => {
      this.charImage = char;
      this.draw();
    };
    void loadCharacterAnchors("char1").then((data) => {
      this.characterAnchors = data;
    });
  }

  setInventory(inv: InventoryState | null): void {
    this.inventory = inv;
    this.draw();
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
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(PANEL_W * UI_SCALE);
    this.canvas.height = Math.round(PANEL_H * UI_SCALE);
    Object.assign(this.canvas.style, {
      maxWidth: "min(90vw, 625px)",
      maxHeight: "90vh",
      cursor: "default",
      display: "block",
    });
    this.ctx = this.canvas.getContext("2d")!;
    this.root.appendChild(this.canvas);

    this.statsPanel = document.createElement("div");
    Object.assign(this.statsPanel.style, {
      display: "none",
      position: "absolute",
      top: "0",
      left: "100%",
      marginLeft: "16px",
      width: "230px",
      maxHeight: "100%",
      overflowY: "auto",
      padding: "16px",
      background: "linear-gradient(168deg, #f8efd3, #f3e7c1 46%, #e7d5a4)",
      border: "1px solid rgba(60, 47, 28, 0.55)",
      borderRadius: "4px",
      color: "#3c2f1c",
      fontFamily: '"IM Fell English", serif',
      fontSize: "14px",
      lineHeight: "1.5",
      boxSizing: "border-box",
      boxShadow: "0 14px 28px -18px rgba(56, 40, 16, 0.55)",
    });
    this.root.appendChild(this.statsPanel);

    this.renderer = new InventoryRenderer(() => this.draw());
    this.input = new InventoryInput(this.canvas, {
      getInventory: () => this.inventory,
      getPosition: (item, idx) => this.getPosition(item, idx),
      getSelectedItemId: () => this.selectedItemId,
      setSelectedItemId: (id) => {
        this.selectedItemId = id;
      },
      getPositionById: (id) => this.positions.get(id),
      setPosition: (id, pos) => this.positions.set(id, pos),
      loadSprite: (id, dimId) => this.renderer.loadSprite(id, dimId),
      sendEquip: (bagIndex) => {
        if (this.hooks.canEdit()) this.hooks.sendEquip(bagIndex);
      },
      sendUnequip: (idx) => {
        if (this.hooks.canEdit()) this.hooks.sendUnequip(idx);
      },
      deletePosition: (id) => this.positions.delete(id),
      updateAttachment: (id, pos, item) => this.updateAttachment(id, pos, item),
      close: () => this.hooks.onClose(),
      draw: () => this.draw(),
    });
  }

  private updateAttachment(itemId: string, panelPos: ItemPosition, item: ItemDefinition) {
    if (!this.hooks.canEdit()) return;
    if (!this.characterAnchors || !this.charImage) return;

    const anchors = getFrameAnchors(this.characterAnchors, "inventory-idle");
    if (!anchors) return;

    const charW = this.charImage.width;
    const charH = this.charImage.height;
    const scale = Math.min(CHAR_REGION.w / charW, CHAR_REGION.h / charH) * 0.85;
    const charX = CHAR_REGION.x + (CHAR_REGION.w - charW * scale) / 2;
    const charY = CHAR_REGION.y + (CHAR_REGION.h - charH * scale) / 2;

    const spriteX = (panelPos.x - charX) / scale;
    const spriteY = (panelPos.y - charY) / scale;

    const spriteImg = this.renderer.loadSprite(item.sprite, item.dimensionId);
    const baseScale = item.visualScale ?? TYPE_BASE_SCALE[item.type] ?? 1;
    const charDrawH = charH * scale;
    let itemDrawH = TARGET_SIZE * baseScale * panelPos.scale;
    if (spriteImg && spriteImg.naturalWidth > 0) {
      const maxDim = Math.max(spriteImg.naturalWidth, spriteImg.naturalHeight);
      itemDrawH = spriteImg.naturalHeight * (TARGET_SIZE / maxDim) * baseScale * panelPos.scale;
    }
    const proportionalScale = itemDrawH / charDrawH;

    const attachment = computeAttachment(
      spriteX,
      spriteY,
      anchors as Partial<AnchorSet>,
      "inventory-idle",
      charH,
      proportionalScale,
      panelPos.rotation,
    );

    this.hooks.sendAttachment(itemId, attachment);
  }

  private lastDisplayedItemId: string | null = null;

  private updateStatsPanel(target: InfoTarget) {
    if (!target || !this.inventory) {
      if (this.lastDisplayedItemId !== null) {
        this.statsPanel.style.display = "none";
        this.lastDisplayedItemId = null;
      }
      return;
    }

    let item: ItemDefinition | null = null;
    if (target.source === "bag") {
      item = this.inventory.bag[target.index] ?? null;
    } else {
      item = this.inventory.equipped.find((it) => it.id === target.id) ?? null;
    }

    if (!item) return;
    if (item.id === this.lastDisplayedItemId) return;
    this.lastDisplayedItemId = item.id;

    const rarityColor = RARITY_COLORS[item.rarity] ?? "#8b8b7a";
    const slotText = Object.entries(item.slotCost)
      .map(([slot, count]) => `${slot} ×${count}`)
      .join(", ");

    const MUTED = "#7a6a50";
    let statsHtml = "";
    switch (item.type) {
      case "weapon": {
        const w = item as WeaponItem;
        const attacks = w.abilities.filter((a) => a.kind === "attack") as import("shared").AttackAbility[];
        const lines = attacks.map((a) => {
          const shape = a.shape;
          let rangeText = "";
          if (shape.kind === ShapeKind.Sector) rangeText = `${shape.radius}`;
          else if (shape.kind === ShapeKind.Circle) rangeText = `${shape.range} (${shape.radius} AoE)`;
          else if (shape.kind === ShapeKind.Rectangle) rangeText = `${shape.length}`;
          else if (shape.kind === ShapeKind.Point) rangeText = `${shape.range}`;
          const costParts: string[] = [];
          if (a.cost.red) costParts.push(`${a.cost.red} red`);
          if (a.cost.blue) costParts.push(`${a.cost.blue} blue`);
          return `
            <div style="margin-top:4px"><strong>${a.name}</strong> (${costParts.join(" + ")})</div>
            <div><span style="color:${MUTED}">Damage:</span> ${a.damage}</div>
            <div><span style="color:${MUTED}">Range:</span> ${rangeText}</div>
            ${a.knockback > 0 ? `<div><span style="color:${MUTED}">Knockback:</span> ${a.knockback}</div>` : ""}
            ${a.wallSlamDamage ? `<div><span style="color:${MUTED}">Wall slam:</span> ${a.wallSlamDamage}</div>` : ""}
            ${a.recoil ? `<div><span style="color:${MUTED}">Recoil:</span> ${a.recoil}</div>` : ""}
            ${a.lungeThrough ? `<div><span style="color:${MUTED}">Lunge:</span> ${a.lungeThrough}</div>` : ""}
            ${a.onHit?.length ? `<div><span style="color:${MUTED}">On Hit:</span> ${a.onHit.map((e) => describeWeaponEffect(e)).join(", ")}</div>` : ""}`;
        });
        const zones = w.abilities.filter((a) => a.kind === "zone") as import("shared").ZoneAbility[];
        for (const z of zones) {
          const costParts: string[] = [];
          if (z.cost.red) costParts.push(`${z.cost.red} red`);
          if (z.cost.blue) costParts.push(`${z.cost.blue} blue`);
          lines.push(`
            <div style="margin-top:4px"><strong>${z.name}</strong> (${costParts.join(" + ")})</div>
            <div><span style="color:${MUTED}">Zone:</span> ${z.zone.effect} · radius ${z.zone.radius} · ${z.zone.duration} turns${z.zone.magnitude ? ` · ${z.zone.magnitude}` : ""}</div>
            <div><span style="color:${MUTED}">Place range:</span> ${z.range}</div>`);
        }
        statsHtml = `<div style="margin-top:8px">${lines.join("")}</div>`;
        break;
      }
      case "shield": {
        const s = item as ShieldItem;
        const lines = s.abilities
          .filter((a) => a.kind === "barrier")
          .map((a) => `<div><strong>${a.name}</strong> +${a.barrierHp} barrier HP</div>`);
        statsHtml = lines.length > 0 ? `<div style="margin-top:8px">${lines.join("")}</div>` : "";
        break;
      }
      case "consumable": {
        const c = item as ConsumableItem;
        if (c.effect.kind === "heal") {
          statsHtml = `<div style="margin-top:8px"><div><span style="color:${MUTED}">Heals:</span> ${c.effect.amount} HP</div></div>`;
        } else {
          statsHtml = `<div style="margin-top:8px"><div><span style="color:${MUTED}">Damage:</span> ${c.effect.amount}</div><div><span style="color:${MUTED}">Radius:</span> ${c.effect.radius}</div></div>`;
        }
        break;
      }
      case "accessory": {
        const a = item as AccessoryItem;
        const bonuses = Object.entries(a.statBonus)
          .filter(([, v]) => v !== 0)
          .map(([k, v]) => `<div><span style="color:${MUTED}">${k}:</span> +${v}</div>`)
          .join("");
        statsHtml = bonuses ? `<div style="margin-top:8px">${bonuses}</div>` : "";
        break;
      }
    }

    this.statsPanel.innerHTML = `
      <div style="font-size:16px;font-weight:bold;color:${rarityColor};margin-bottom:4px">${item.name}</div>
      <div style="font-size:11px;text-transform:uppercase;color:${MUTED};letter-spacing:1px">${item.rarity} ${item.type}</div>
      <div style="margin-top:8px;font-size:13px">${item.description}</div>
      <div style="margin-top:8px;font-size:12px;color:${MUTED}">Slots: ${slotText}</div>
      ${statsHtml}
    `;
    this.statsPanel.style.display = "block";
  }

  private draw() {
    if (!this.ctx) return;
    this.updateStatsPanel(this.input.getInfoTarget());
    this.renderer.draw(this.ctx, this.canvas, {
      inventory: this.inventory,
      positions: this.positions,
      selectedItemId: this.selectedItemId,
      mode: this.input.getMode(),
      hoveredSlot: this.input.getHoveredSlot(),
      hoveredClose: this.input.getHoveredClose(),
      panelImage: this.panelImage,
      charImage: this.charImage,
      infoTarget: this.input.getInfoTarget(),
    });
  }
}
