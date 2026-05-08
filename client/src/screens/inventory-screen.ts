import type { Screen } from "./screen-manager.js";
import type { Connection } from "../net/connection.js";
import type { InventoryState, ItemDefinition, WeaponItem } from "shared";

const SLOT_SIZE = 72;
const SLOT_GAP = 8;
const COLS = 4;
const EQUIPPED_SIZE = 80;

const RARITY_COLORS: Record<string, string> = {
  common: "#8b8b7a",
  uncommon: "#5a7a3a",
  rare: "#4a6ab0",
  epic: "#8a4ab0",
  legendary: "#c47030",
};

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
      maxWidth: "480px",
      boxShadow: "0 8px 32px rgba(26, 20, 14, 0.4)",
      fontFamily: "Georgia, 'Times New Roman', serif",
      color: "#2a2520",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "16px",
    });

    const title = document.createElement("h2");
    title.textContent = "Inventory";
    Object.assign(title.style, {
      margin: "0",
      fontSize: "20px",
      fontWeight: "500",
    });

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

    // Equipped weapon section
    const equippedSection = document.createElement("div");
    Object.assign(equippedSection.style, {
      marginBottom: "16px",
      padding: "12px",
      background: "rgba(90, 122, 58, 0.1)",
      border: "1px solid rgba(90, 122, 58, 0.3)",
      borderRadius: "8px",
    });

    const equippedLabel = document.createElement("div");
    equippedLabel.textContent = "Equipped Weapon";
    Object.assign(equippedLabel.style, {
      fontSize: "12px",
      color: "#6b6358",
      marginBottom: "8px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    });
    equippedSection.appendChild(equippedLabel);

    const equippedSlot = this.createEquippedSlot(inv.equippedWeapon);
    equippedSection.appendChild(equippedSlot);
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
      gridTemplateColumns: `repeat(${COLS}, ${SLOT_SIZE}px)`,
      gap: `${SLOT_GAP}px`,
    });

    for (let i = 0; i < inv.slots.length; i++) {
      const slot = this.createBagSlot(inv.slots[i] ?? null, i);
      grid.appendChild(slot);
    }

    panel.appendChild(grid);
    this.container.appendChild(panel);
  }

  private createEquippedSlot(weapon: WeaponItem | null): HTMLDivElement {
    const slot = document.createElement("div");
    Object.assign(slot.style, {
      width: `${EQUIPPED_SIZE}px`,
      height: `${EQUIPPED_SIZE}px`,
      background: "#d4c4a8",
      border: weapon ? `2px solid ${RARITY_COLORS[weapon.rarity] ?? "#8b8b7a"}` : "2px dashed #b8a888",
      borderRadius: "8px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      cursor: weapon ? "pointer" : "default",
      position: "relative",
    });

    if (weapon) {
      const name = document.createElement("div");
      name.textContent = weapon.name;
      Object.assign(name.style, {
        fontSize: "11px",
        color: "#2a2520",
        textAlign: "center",
        lineHeight: "1.2",
      });
      slot.appendChild(name);

      const dmg = document.createElement("div");
      dmg.textContent = `${weapon.weapon.damage} dmg`;
      Object.assign(dmg.style, {
        fontSize: "10px",
        color: "#6b6358",
      });
      slot.appendChild(dmg);

      slot.addEventListener("click", () => {
        this.conn.send({ type: "unequip" });
      });
      slot.addEventListener("mouseenter", () => {
        slot.style.background = "#c8b898";
      });
      slot.addEventListener("mouseleave", () => {
        slot.style.background = "#d4c4a8";
      });
    } else {
      const empty = document.createElement("div");
      empty.textContent = "Empty";
      Object.assign(empty.style, {
        fontSize: "11px",
        color: "#b8a888",
        fontStyle: "italic",
      });
      slot.appendChild(empty);
    }

    return slot;
  }

  private createBagSlot(item: ItemDefinition | null, index: number): HTMLDivElement {
    const slot = document.createElement("div");
    Object.assign(slot.style, {
      width: `${SLOT_SIZE}px`,
      height: `${SLOT_SIZE}px`,
      background: item ? "#d4c4a8" : "rgba(180, 168, 136, 0.3)",
      border: item ? `1.5px solid ${RARITY_COLORS[item.rarity] ?? "#8b8b7a"}` : "1.5px solid rgba(184, 168, 136, 0.5)",
      borderRadius: "6px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      cursor: item ? "pointer" : "default",
      gap: "2px",
    });

    if (item) {
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
        Object.assign(dmg.style, {
          fontSize: "9px",
          color: RARITY_COLORS[item.rarity] ?? "#6b6358",
        });
        slot.appendChild(dmg);
      }

      if (item.type === "weapon") {
        slot.title = `Click to equip ${item.name}`;
        slot.addEventListener("click", () => {
          this.conn.send({ type: "equip", slotIndex: index });
        });
      }

      slot.addEventListener("mouseenter", () => {
        slot.style.background = "#c8b898";
      });
      slot.addEventListener("mouseleave", () => {
        slot.style.background = "#d4c4a8";
      });
    }

    return slot;
  }
}
