import type { Screen } from "./screen-manager.js";
import type { Connection } from "../net/connection.js";
import type {
  InventoryState,
  ItemDefinition,
  AttachmentData,
  WeaponItem,
  ShieldItem,
  ConsumableItem,
  AccessoryItem,
} from "shared";
import { ShapeKind } from "shared";
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
import { loadCharacterAnchors, getFrameAnchors } from "../renderer/anchor-loader.js";
import { computeAttachment, type CharacterAnchors, type AnchorSet } from "../renderer/bone-transform.js";

export class InventoryScreen implements Screen {
  private container: HTMLDivElement;
  private inventory: InventoryState | null = null;
  private onCloseCallback: (() => void) | null = null;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private statsPanel!: HTMLDivElement;

  private built = false;
  private panelImage: HTMLImageElement | null = null;
  private charImage: HTMLImageElement | null = null;

  private positions = new Map<string, ItemPosition>();
  private selectedItemId: string | null = null;

  private renderer!: InventoryRenderer;
  private input!: InventoryInput;
  private characterAnchors: CharacterAnchors | null = null;

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
    if (!this.characterAnchors) {
      loadCharacterAnchors("char1").then((data) => {
        this.characterAnchors = data;
      });
    }
    this.container.style.display = "flex";
    this.draw();
  }

  exit() {
    this.container.style.display = "none";
    if (this.statsPanel) this.statsPanel.style.display = "none";
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

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, { position: "relative" });
    this.container.appendChild(wrapper);

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
    wrapper.appendChild(this.canvas);

    this.statsPanel = document.createElement("div");
    Object.assign(this.statsPanel.style, {
      display: "none",
      position: "absolute",
      top: "0",
      left: "100%",
      marginLeft: "16px",
      width: "220px",
      maxHeight: "100%",
      padding: "16px",
      background: "rgba(42, 37, 32, 0.95)",
      border: "2px solid #6b5c4a",
      borderRadius: "8px",
      color: "#d4c4a8",
      fontFamily: "sans-serif",
      fontSize: "14px",
      lineHeight: "1.5",
      boxSizing: "border-box",
    });
    wrapper.appendChild(this.statsPanel);

    this.renderer = new InventoryRenderer(() => this.draw());
    this.input = new InventoryInput(this.canvas, {
      getInventory: () => this.inventory,
      getPosition: (item, idx) => this.getPosition(item, idx),
      getSelectedItemId: () => this.selectedItemId,
      setSelectedItemId: (id) => { this.selectedItemId = id; },
      getPositionById: (id) => this.positions.get(id),
      setPosition: (id, pos) => this.positions.set(id, pos),
      loadSprite: (id) => this.renderer.loadSprite(id),
      sendEquip: (bagIndex) => this.conn.send({ type: "equip", bagIndex }),
      sendUnequip: (idx) => this.conn.send({ type: "unequip", equippedIndex: idx }),
      deletePosition: (id) => this.positions.delete(id),
      updateAttachment: (id, pos, item) => this.updateAttachment(id, pos, item),
      close: () => this.onCloseCallback?.(),
      draw: () => this.draw(),
    });
  }

  private updateAttachment(itemId: string, panelPos: ItemPosition, item: ItemDefinition) {
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

    const spriteImg = this.renderer.loadSprite(item.sprite);
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

    this.conn.send({ type: "updateAttachment", itemId, attachment });
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

    let statsHtml = "";
    switch (item.type) {
      case "weapon": {
        const w = item as WeaponItem;
        const attacks = w.abilities.filter(a => a.kind === "attack") as import("shared").AttackAbility[];
        const lines = attacks.map(a => {
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
            <div><span style="color:#8b8b7a">Damage:</span> ${a.damage}</div>
            <div><span style="color:#8b8b7a">Range:</span> ${rangeText}</div>
            ${a.onHit?.length ? `<div><span style="color:#8b8b7a">On Hit:</span> ${a.onHit.map(e => `${e.type} (${e.distance})`).join(", ")}</div>` : ""}`;
        });
        statsHtml = `<div style="margin-top:8px">${lines.join("")}</div>`;
        break;
      }
      case "shield": {
        const s = item as ShieldItem;
        const lines = s.abilities
          .filter(a => a.kind === "barrier")
          .map(a => `<div><strong>${a.name}</strong> +${a.barrierHp} barrier HP</div>`);
        statsHtml = lines.length > 0 ? `<div style="margin-top:8px">${lines.join("")}</div>` : "";
        break;
      }
      case "consumable": {
        const c = item as ConsumableItem;
        if (c.effect.kind === "heal") {
          statsHtml = `<div style="margin-top:8px"><div><span style="color:#8b8b7a">Heals:</span> ${c.effect.amount} HP</div></div>`;
        } else {
          statsHtml = `<div style="margin-top:8px"><div><span style="color:#8b8b7a">Damage:</span> ${c.effect.amount}</div><div><span style="color:#8b8b7a">Radius:</span> ${c.effect.radius}</div></div>`;
        }
        break;
      }
      case "accessory": {
        const a = item as AccessoryItem;
        const bonuses = Object.entries(a.statBonus)
          .filter(([, v]) => v !== 0)
          .map(([k, v]) => `<div><span style="color:#8b8b7a">${k}:</span> +${v}</div>`)
          .join("");
        statsHtml = bonuses ? `<div style="margin-top:8px">${bonuses}</div>` : "";
        break;
      }
    }

    this.statsPanel.innerHTML = `
      <div style="font-size:16px;font-weight:bold;color:${rarityColor};margin-bottom:4px">${item.name}</div>
      <div style="font-size:11px;text-transform:uppercase;color:#8b8b7a;letter-spacing:1px">${item.rarity} ${item.type}</div>
      <div style="margin-top:8px;font-size:13px;color:#a89880">${item.description}</div>
      <div style="margin-top:8px;font-size:12px;color:#8b8b7a">Slots: ${slotText}</div>
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
