import type { GatewayInfo, HexMapState } from "shared";
import { contractById, getHexIcon, hexDistance, hexKey, isRetreatHex, threatMultiplier, REST_BARRIER_HP } from "shared";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import { THEME, FONT, btn, progressBar } from "../screens/ui-kit.js";

/**
 * The overworld contract HUD (docs/meta-loop/02-contracts.md §6.2, gateway block per
 * 04-portals.md §6.3, threat/rested readouts per 05-difficulty.md §6.2). A floating top-right
 * panel under the Leave button, constructed once in main.ts (VotePanel precedent). Shows the
 * run's contract name + progress (when a contract exists), a rested chip, a gateway block
 * (destination + Descend/Retreat proposals) while the party stands on a gateway hex, a
 * client-computed threat multiplier, and the seat's pending-XP chip. Visible iff the room is
 * in the overworld phase.
 */
export class ContractHud {
  private container: HTMLDivElement;
  private pending = 0;

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private getHexMap: () => HexMapState | null,
    private getGateways: () => Record<string, GatewayInfo>,
  ) {
    this.container = document.createElement("div");
    this.container.id = "contract-hud";
    this.container.style.cssText = `
      position: fixed; top: 52px; right: 10px; z-index: 110;
      width: 240px; box-sizing: border-box; display: none;
      flex-direction: column; gap: 7px;
      padding: 10px 14px; border-radius: 8px;
      background: rgba(17,13,9,0.85); border: 1px solid ${THEME.goldLine};
      font-family: ${FONT.body}; color: ${THEME.parch};
    `;
    document.body.appendChild(this.container);
    this.seat.subscribe(() => this.render());
    this.render();
  }

  /** Re-render on a hexMapState push (playerPos drives the bearing + retreat stance). */
  setHexMap(_hexMap: HexMapState): void {
    this.render();
  }

  /** Fed from main.ts's xpAward/xpBanked handlers; reset to 0 on run change. */
  setPending(pending: number): void {
    if (pending === this.pending) return;
    this.pending = pending;
    this.render();
  }

  /** Re-render on a gatewayUpdate push (attunement changes the Descend affordance). */
  refresh(): void {
    this.render();
  }

  private render(): void {
    const room = this.seat.room;
    if (room?.phase !== "overworld") {
      this.container.style.display = "none";
      return;
    }
    const contract = room.contract;
    const hexMap = this.getHexMap();
    this.container.innerHTML = "";
    this.container.style.display = "flex";

    if (contract) {
      const label = document.createElement("div");
      label.textContent = "Contract";
      label.style.cssText = `font:700 10px ${FONT.cinzel}; letter-spacing:.14em; text-transform:uppercase; color:${THEME.goldDeep};`;
      this.container.appendChild(label);
    }

    if (room.rested) {
      const rested = document.createElement("div");
      rested.style.cssText = `font:12px ${FONT.body}; color:${THEME.green};`;
      rested.append("Rested — fortified for the next battle");
      const bonus = document.createElement("span");
      bonus.textContent = ` +${REST_BARRIER_HP}`;
      bonus.style.color = THEME.faint;
      rested.appendChild(bonus);
      this.container.appendChild(rested);
    }

    if (contract) {
      const def = contractById(contract.type);

      const name = document.createElement("div");
      name.textContent = def.name;
      name.style.cssText = `font:700 15px ${FONT.cinzel}; color:${THEME.gold};`;
      this.container.appendChild(name);

      if (contract.completed) {
        const done = document.createElement("div");
        done.textContent = "✓ Fulfilled";
        done.style.cssText = `font:13px ${FONT.body}; color:${THEME.green};`;
        this.container.appendChild(done);
      } else if (contract.type === "chart-hexes") {
        const line = document.createElement("div");
        line.textContent = `Cleared ${contract.progress}/${contract.required}`;
        line.style.cssText = `font:13px ${FONT.body}; color:${THEME.parch};`;
        this.container.appendChild(line);
        this.container.appendChild(progressBar(contract.progress / contract.required));
      } else {
        const line = document.createElement("div");
        line.textContent = def.description;
        line.style.cssText = `font:13px/1.45 ${FONT.body}; color:${THEME.parch};`;
        this.container.appendChild(line);
        if (contract.targetHex && hexMap) {
          const t = contract.targetHex;
          const bearing = document.createElement("div");
          bearing.textContent = `Target: (${t.q}, ${t.r}) — ${hexDistance(hexMap.playerPos, t)} hexes`;
          bearing.style.cssText = `font:12px ${FONT.body}; color:${THEME.muted};`;
          this.container.appendChild(bearing);
        }
      }
    }

    if (hexMap && isRetreatHex(getHexIcon(hexMap.playerPos, hexMap.icons))) {
      const gateway = this.getGateways()[hexKey(hexMap.playerPos)];

      const dest = document.createElement("div");
      if (gateway) {
        dest.textContent = `Gateway → ${gateway.toName} · Tier ${gateway.toTier}`;
        dest.style.cssText = `font:13px ${FONT.body}; color:${THEME.gold};`;
      } else {
        dest.textContent = "Gateway unattuned — nothing lies beyond yet";
        dest.style.cssText = `font:italic 13px ${FONT.body}; color:${THEME.faint};`;
      }
      this.container.appendChild(dest);

      if (gateway) {
        const descend = btn("Descend…", "primary");
        descend.style.width = "100%";
        descend.style.padding = "9px 14px";
        descend.style.fontSize = "14px";
        descend.addEventListener("click", () => this.conn.send({ type: "proposeTravel" }));
        this.container.appendChild(descend);

        const sub = document.createElement("div");
        sub.textContent = `Travel deeper — the run continues at Tier ${gateway.toTier}`;
        sub.style.cssText = `font:11px ${FONT.body}; color:${THEME.faint}; text-align:center;`;
        this.container.appendChild(sub);
      }

      const retreat = btn("Retreat…", "secondary");
      retreat.style.width = "100%";
      retreat.style.padding = "9px 14px";
      retreat.style.fontSize = "14px";
      retreat.style.borderColor = THEME.dangerDeep;
      retreat.style.color = THEME.danger;
      retreat.addEventListener("click", () => this.conn.send({ type: "proposeRetreat" }));
      this.container.appendChild(retreat);

      const caption = document.createElement("div");
      caption.textContent = "Banks 50% of pending XP · forfeits the contract";
      caption.style.cssText = `font:11px ${FONT.body}; color:${THEME.faint}; text-align:center;`;
      this.container.appendChild(caption);
    }

    if (hexMap) {
      const t = threatMultiplier(room.dimensionTier, hexDistance(hexMap.playerPos, { q: 0, r: 0 }));
      const color = t >= 2 ? THEME.danger : t >= 1.5 ? THEME.gold : THEME.muted;
      const threat = document.createElement("div");
      threat.textContent = `Threat ×${t.toFixed(1)}`;
      threat.style.cssText = `font:12px ${FONT.body}; color:${color};`;
      this.container.appendChild(threat);
    }

    const chip = document.createElement("div");
    chip.textContent = `Pending: ${this.pending} XP`;
    chip.style.cssText = `font:12px ${FONT.body}; color:${THEME.muted};`;
    this.container.appendChild(chip);
  }
}
