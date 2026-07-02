import type { CoopStatusPayload, Entity, GameState, SeatCombatStatus } from "shared";
import type { SeatContext } from "../state/seat-context.js";
import type { ClientState } from "../state/client-state.js";

/**
 * The in-combat party panel. Reads per-seat status from `coopStatus` (connected / ready /
 * exhausted / controller) and hero HP from the live `GameState`. Owns the local seat's
 * Pass/Ready toggle (the End-Turn affordance moved here from the ability bar) and
 * surfaces a "waiting on X" banner plus a passive "X is defending" indicator from pendingDefends.
 */
export class PartyHud {
  private container: HTMLDivElement;
  private banner: HTMLDivElement;
  private rows: HTMLDivElement;
  private passBtn: HTMLButtonElement;
  private unsubSeat: (() => void) | null = null;
  private unsubState: (() => void) | null = null;

  constructor(private seat: SeatContext, private clientState: ClientState) {
    this.container = document.createElement("div");
    this.container.id = "party-hud";
    this.container.style.cssText = `
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 100;
      display: none;
      flex-direction: column;
      gap: 8px;
      font-family: monospace;
      pointer-events: none;
    `;

    this.banner = document.createElement("div");
    this.banner.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      color: #4a3728;
      background: rgba(245, 235, 215, 0.92);
      border: 1px solid rgba(74, 55, 40, 0.4);
      border-radius: 6px;
      padding: 6px 10px;
      display: none;
    `;
    this.container.appendChild(this.banner);

    this.rows = document.createElement("div");
    this.rows.style.cssText = "display:flex; flex-direction:column; gap:6px;";
    this.container.appendChild(this.rows);

    this.passBtn = document.createElement("button");
    this.passBtn.tabIndex = -1;
    this.passBtn.style.cssText = `
      align-self: flex-start;
      margin-top: 4px;
      padding: 8px 18px;
      font-family: monospace;
      font-size: 14px;
      font-weight: bold;
      color: #4a3728;
      background: #d4c8a0;
      border: 2px solid #6b5b4a;
      border-radius: 6px;
      cursor: pointer;
      pointer-events: auto;
    `;
    this.passBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Drop focus so a later space/Enter press defends rather than re-toggling readiness.
      this.passBtn.blur();
      const mine = this.seat.mySeat();
      this.clientState.setReady(!(mine?.ready ?? false));
    });
    this.container.appendChild(this.passBtn);

    document.body.appendChild(this.container);
  }

  show() {
    this.container.style.display = "flex";
    this.unsubSeat = this.seat.subscribe(() => this.render());
    this.unsubState = this.clientState.subscribe(() => this.render());
    this.render();
  }

  hide() {
    this.container.style.display = "none";
    this.unsubSeat?.();
    this.unsubState?.();
    this.unsubSeat = null;
    this.unsubState = null;
  }

  private render() {
    const coop = this.seat.coop;
    if (!coop) {
      this.rows.innerHTML = "";
      this.banner.style.display = "none";
      this.passBtn.style.display = "none";
      return;
    }

    const state = this.clientState.getState();
    const defendingSeats = new Set(coop.pendingDefends.filter((d) => !d.answered).map((d) => d.seatId));

    this.rows.innerHTML = "";
    for (const s of coop.seats) {
      const hero = state ? heroOf(state, s.heroEntityId) : null;
      const isMe = s.seatId === this.seat.mySeatId;
      this.rows.appendChild(this.seatRow(s, hero, isMe, defendingSeats.has(s.seatId)));
    }

    this.renderBanner(coop, defendingSeats);
    this.renderPassButton(coop);
  }

  private seatRow(
    s: SeatCombatStatus,
    hero: Entity | null,
    isMe: boolean,
    defending: boolean,
  ): HTMLDivElement {
    const row = document.createElement("div");
    const dead = hero?.dead ?? false;
    const tag = !s.connected && s.controller === "human" ? " (dropped)" : s.controller === "ai" ? " (bot)" : "";
    const statusMark = dead ? "X" : defending ? "shield" : s.ready ? "ready" : s.exhausted ? "done" : "...";
    const statusColor = dead ? "#8b3a3a" : defending ? "#2980b9" : s.ready || s.exhausted ? "#5a7a3a" : "#8a7a68";

    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 9px;
      font-size: 12px;
      color: #4a3728;
      background: rgba(245, 235, 215, ${isMe ? "0.96" : "0.85"});
      border: ${isMe ? "2px solid #4caf50" : "1px solid rgba(74, 55, 40, 0.35)"};
      border-radius: 6px;
      min-width: 168px;
      opacity: ${dead ? "0.6" : "1"};
    `;

    const name = document.createElement("span");
    name.style.cssText = "flex:1; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
    name.textContent = `${s.displayName}${tag}`;
    row.appendChild(name);

    if (hero) {
      const hp = document.createElement("span");
      hp.style.cssText = "color:#8b3a3a; min-width:54px; text-align:right;";
      hp.textContent = `${Math.max(0, Math.ceil(hero.hp))}/${hero.maxHp}`;
      row.appendChild(hp);
    }

    const mark = document.createElement("span");
    mark.style.cssText = `color:${statusColor}; min-width:46px; text-align:right;`;
    mark.textContent = statusMark;
    row.appendChild(mark);

    return row;
  }

  private renderBanner(coop: CoopStatusPayload, defendingSeats: Set<string>): void {
    if (defendingSeats.size > 0) {
      const names = coop.seats.filter((s) => defendingSeats.has(s.seatId)).map((s) => s.displayName);
      this.banner.textContent = `Defending: ${names.join(", ")}`;
      this.banner.style.display = "block";
      return;
    }
    if (coop.phase === "enemy") {
      this.banner.textContent = "Enemy phase";
      this.banner.style.display = "block";
      return;
    }
    const waiting = coop.seats.filter((s) => s.connected && !s.ready && !s.exhausted && s.controller === "human");
    if (waiting.length > 0 && waiting.every((s) => s.seatId !== this.seat.mySeatId)) {
      this.banner.textContent = `Waiting on ${waiting.map((s) => s.displayName).join(", ")}`;
      this.banner.style.display = "block";
      return;
    }
    this.banner.style.display = "none";
  }

  private renderPassButton(coop: CoopStatusPayload): void {
    const mine = this.seat.mySeat();
    if (coop.phase !== "player" || !mine || mine.exhausted) {
      this.passBtn.style.display = "none";
      return;
    }
    this.passBtn.style.display = "block";
    this.passBtn.textContent = mine.ready ? "Un-ready" : "Pass / Ready";
    this.passBtn.style.opacity = "1";
  }
}

function heroOf(state: GameState, heroEntityId: string) {
  return state.entities.get(heroEntityId) ?? null;
}
