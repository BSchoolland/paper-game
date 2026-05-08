import type { Screen } from "./screen-manager.js";
import type { Connection } from "../net/connection.js";
import type { InventoryState, ItemDefinition } from "shared";
import { PLAYER_SLOTS, canEquip } from "shared";
import type { SlotType } from "shared";

const SLOT_SIZE = 72;
const SLOT_GAP = 8;
const BAG_COLS = 4;

const RARITY_COLORS: Record<string, string> = {
  common: "#8b8b7a",
  uncommon: "#5a7a3a",
  rare: "#4a6ab0",
  epic: "#8a4ab0",
  legendary: "#c47030",
};

const SLOT_LABELS: { type: SlotType; label: string }[] = [
  { type: "hand", label: "Hand" },
  { type: "hat", label: "Hat" },
  { type: "utility", label: "Utility" },
  { type: "accessory", label: "Accessory" },
];

export class InventoryScreen implements Screen {
  private container: HTMLDivElement;
  private inventory: InventoryState | null = null;
  private onCloseCallback: (() => void) | null = null;

  constructor(private conn: Connection) {
    this.container = document.createElement("div");
    this.container.style.display = "none";
    document.body.appendChild(this.container);

    conn.on("inventory", (msg) => {
      this.inventory = msg.inventory;
      if (this.container.style.display !== "none") {
        this.renderUI();
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
    this.container.style.display = "flex";
    this.renderUI();
  }

  exit() {
    this.container.style.display = "none";
  }

  private renderUI() {
    if (!this.inventory) return;
    const inv = this.inventory;

    this.container.innerHTML = "";
    Object.assign(this.container.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(26, 20, 14, 0.6)",
      zIndex: "100",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "#e8dcc8",
      border: "3px solid #b8a888",
      borderRadius: "12px",
      padding: "24px",
      minWidth: "380px",
      maxWidth: "520px",
      boxShadow: "0 8px 32px rgba(26, 20, 14, 0.4)",
      fontFamily: "Georgia, 'Times New Roman', serif",
      color: "#2a2520",
    });

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "16px",
    });

    const title = document.createElement("h2");
    title.textContent = "Inventory";
    Object.assign(title.style, { margin: "0", fontSize: "20px", fontWeight: "500" });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    Object.assign(closeBtn.style, {
      background: "#d4c4a8",
      border: "1px solid #b8a888",
      borderRadius: "5px",
      padding: "4px 12px",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "13px",
      color: "#2a2520",
    });
    closeBtn.addEventListener("click", () => this.onCloseCallback?.());

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Equipped section
    const equippedSection = document.createElement("div");
    Object.assign(equippedSection.style, {
      marginBottom: "16px",
      padding: "12px",
      background: "rgba(90, 122, 58, 0.1)",
      border: "1px solid rgba(90, 122, 58, 0.3)",
      borderRadius: "8px",
    });

    const equippedLabel = document.createElement("div");
    equippedLabel.textContent = "Equipped";
    Object.assign(equippedLabel.style, {
      fontSize: "12px",
      color: "#6b6358",
      marginBottom: "4px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    });
    equippedSection.appendChild(equippedLabel);

    const slotSummary = document.createElement("div");
    Object.assign(slotSummary.style, {
      fontSize: "10px",
      color: "#8b8b7a",
      marginBottom: "8px",
    });
    const used = this.getUsedSlots(inv.equipped);
    slotSummary.textContent = SLOT_LABELS
      .map(({ type, label }) => `${label}: ${used[type]}/${PLAYER_SLOTS[type]}`)
      .join("  ");
    equippedSection.appendChild(slotSummary);

    if (inv.equipped.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No items equipped";
      Object.assign(empty.style, { fontSize: "12px", color: "#b8a888", fontStyle: "italic" });
      equippedSection.appendChild(empty);
    } else {
      const equippedGrid = document.createElement("div");
      Object.assign(equippedGrid.style, {
        display: "grid",
        gridTemplateColumns: `repeat(${BAG_COLS}, ${SLOT_SIZE}px)`,
        gap: `${SLOT_GAP}px`,
      });
      for (let i = 0; i < inv.equipped.length; i++) {
        equippedGrid.appendChild(this.createItemSlot(inv.equipped[i]!, () => {
          this.conn.send({ type: "unequip", equippedIndex: i });
        }, "Unequip"));
      }
      equippedSection.appendChild(equippedGrid);
    }

    panel.appendChild(equippedSection);

    // Bag section
    const bagLabel = document.createElement("div");
    bagLabel.textContent = "Bag";
    Object.assign(bagLabel.style, {
      fontSize: "12px",
      color: "#6b6358",
      marginBottom: "8px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    });
    panel.appendChild(bagLabel);

    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${BAG_COLS}, ${SLOT_SIZE}px)`,
      gap: `${SLOT_GAP}px`,
    });

    for (let i = 0; i < inv.bag.length; i++) {
      const item = inv.bag[i];
      if (item) {
        const equipable = canEquip(inv.equipped, item);
        grid.appendChild(this.createItemSlot(item, equipable ? () => {
          this.conn.send({ type: "equip", bagIndex: i });
        } : null, "Equip", !equipable));
      } else {
        grid.appendChild(this.createEmptySlot());
      }
    }

    panel.appendChild(grid);
    this.container.appendChild(panel);
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

  private createItemSlot(
    item: ItemDefinition,
    onClick: (() => void) | null,
    actionLabel: string,
    dimmed = false,
  ): HTMLDivElement {
    const slot = document.createElement("div");
    const borderColor = RARITY_COLORS[item.rarity] ?? "#8b8b7a";
    Object.assign(slot.style, {
      width: `${SLOT_SIZE}px`,
      height: `${SLOT_SIZE}px`,
      background: dimmed ? "rgba(180, 168, 136, 0.4)" : "#d4c4a8",
      border: `1.5px solid ${borderColor}`,
      borderRadius: "6px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      cursor: onClick ? "pointer" : "default",
      gap: "2px",
      opacity: dimmed ? "0.5" : "1",
    });

    const name = document.createElement("div");
    name.textContent = item.name;
    Object.assign(name.style, {
      fontSize: "10px",
      color: "#2a2520",
      textAlign: "center",
      lineHeight: "1.2",
    });
    slot.appendChild(name);

    const typeBadge = document.createElement("div");
    typeBadge.textContent = item.type;
    Object.assign(typeBadge.style, {
      fontSize: "9px",
      color: "#6b6358",
      textTransform: "capitalize",
    });
    slot.appendChild(typeBadge);

    if (item.type === "weapon") {
      const dmg = document.createElement("div");
      dmg.textContent = `${item.weapon.damage} dmg`;
      Object.assign(dmg.style, { fontSize: "9px", color: borderColor });
      slot.appendChild(dmg);
    }

    const slotInfo = document.createElement("div");
    const costs = Object.entries(item.slotCost)
      .map(([s, n]) => `${n}${s.slice(0, 3)}`)
      .join("+");
    slotInfo.textContent = costs;
    Object.assign(slotInfo.style, { fontSize: "8px", color: "#a09888" });
    slot.appendChild(slotInfo);

    if (onClick) {
      slot.title = `${actionLabel} ${item.name}`;
      slot.addEventListener("click", onClick);
      slot.addEventListener("mouseenter", () => { slot.style.background = "#c8b898"; });
      slot.addEventListener("mouseleave", () => { slot.style.background = dimmed ? "rgba(180, 168, 136, 0.4)" : "#d4c4a8"; });
    }

    return slot;
  }

  private createEmptySlot(): HTMLDivElement {
    const slot = document.createElement("div");
    Object.assign(slot.style, {
      width: `${SLOT_SIZE}px`,
      height: `${SLOT_SIZE}px`,
      background: "rgba(180, 168, 136, 0.3)",
      border: "1.5px solid rgba(184, 168, 136, 0.5)",
      borderRadius: "6px",
    });
    return slot;
  }
}
