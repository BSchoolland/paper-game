import type { InventoryState, VoteStatePayload } from "shared";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import { THEME, FONT, RARITY_COLOR, designChip } from "../screens/ui-kit.js";

/**
 * The overworld party-spoils HUD (docs/meta-loop/03-loot-codex.md §6.2). A floating top-left
 * panel constructed once in main.ts (VotePanel/ContractHud precedent — PartyHud is combat-only,
 * so the top-left overworld slot is free). One row per unclaimed pool drop with a Claim button
 * that opens a loot vote (`claimLoot`). Visible iff the room is in the overworld phase with a
 * non-empty pool; pool truth rides roomState (flag #13), so SeatContext notify re-renders it.
 */
export class LootPanel {
  private container: HTMLDivElement;
  private vote: VoteStatePayload | null = null;
  private inventory: InventoryState | null = null;

  constructor(private conn: RoomConnection, private seat: SeatContext) {
    this.container = document.createElement("div");
    this.container.id = "loot-panel";
    this.container.style.cssText = `
      position: fixed; top: 52px; left: 10px; z-index: 110;
      width: 264px; box-sizing: border-box; display: none;
      flex-direction: column; gap: 8px;
      padding: 10px 12px; border-radius: 8px;
      background: rgba(17,13,9,0.85); border: 1px solid ${THEME.goldLine};
      font-family: ${FONT.body}; color: ${THEME.parch};
    `;
    document.body.appendChild(this.container);

    this.seat.subscribe(() => this.render());
    this.conn.on("voteState", (msg) => {
      this.vote = msg.vote;
      this.render();
    });
    this.conn.on("moveResolved", () => {
      this.vote = null;
      this.render();
    });
    this.conn.on("inventory", (msg) => {
      this.inventory = msg.inventory;
      this.render();
    });
    this.render();
  }

  private render(): void {
    const room = this.seat.room;
    if (!room || room.phase !== "overworld" || room.lootPool.length === 0) {
      this.container.style.display = "none";
      return;
    }
    this.container.innerHTML = "";
    this.container.style.display = "flex";

    const header = document.createElement("div");
    header.textContent = `Party Spoils · ${room.lootPool.length}`;
    header.style.cssText = `font:700 10px ${FONT.cinzel}; letter-spacing:.14em; text-transform:uppercase; color:${THEME.goldDeep};`;
    this.container.appendChild(header);

    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; gap:7px; max-height:300px; overflow-y:auto;";

    const bagFull = this.inventory !== null && this.inventory.bag.indexOf(null) === -1;
    const voteOpen = this.vote !== null;
    for (const entry of room.lootPool) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; gap:8px;";
      row.appendChild(designChip(entry.item, 34));

      const name = document.createElement("div");
      name.textContent = entry.item.name;
      name.style.cssText = `
        flex:1; min-width:0; font:13px ${FONT.body}; color:${RARITY_COLOR[entry.item.rarity]};
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      `;
      row.appendChild(name);

      const claim = document.createElement("button");
      claim.tabIndex = -1;
      claim.textContent = "Claim";
      const disabled = voteOpen || bagFull;
      claim.disabled = disabled;
      claim.style.cssText = `
        flex:0 0 auto; font:600 11px ${FONT.cinzel}; letter-spacing:.04em;
        color:${THEME.gold}; background:transparent;
        border:1px solid ${THEME.goldLine}; border-radius:6px; padding:3px 10px;
        ${disabled ? "opacity:.5; cursor:default;" : "cursor:pointer;"}
      `;
      if (bagFull) claim.title = "Bag full";
      if (!disabled) {
        claim.addEventListener("click", () => this.conn.send({ type: "claimLoot", lootId: entry.lootId }));
      }
      row.appendChild(claim);
      list.appendChild(row);
    }
    this.container.appendChild(list);
  }
}
