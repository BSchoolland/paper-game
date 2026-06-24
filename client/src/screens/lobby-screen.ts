import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import type { RoomStatePayload, SeatInfo } from "shared";
import { panelCard, btn } from "./ui-kit.js";

/**
 * The in-room STAGING screen (RoomPhase "lobby"): room code, seat roster, a per-seat ready toggle,
 * a loadout button (opens the inventory in loadout mode pre-Start), a host-only Start that bot-fills
 * empty seats server-side, and Leave. The out-of-room entry + matchmaking lives in HomeScreen. All
 * roster data comes from `roomState` via the SeatContext; readiness/start are server-authoritative.
 */
export class LobbyScreen implements Screen {
  private container: HTMLDivElement;
  private unsub: (() => void) | null = null;

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private onOpenLoadout: () => void,
  ) {
    this.container = document.createElement("div");
    this.container.id = "lobby-screen";
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 90;
      display: none;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      color: #4a3728;
      background: rgba(26, 20, 14, 0.55);
    `;
    document.body.appendChild(this.container);
  }

  enter() {
    this.container.style.display = "flex";
    this.unsub = this.seat.subscribe(() => this.render());
    this.render();
  }

  exit() {
    this.container.style.display = "none";
    this.unsub?.();
    this.unsub = null;
  }

  private render() {
    const room = this.seat.room;
    if (room && room.phase === "lobby") this.renderRoster(room);
    else this.container.innerHTML = ""; // room-less / past-lobby: the screen manager switches away
  }

  private renderRoster(room: RoomStatePayload) {
    this.container.innerHTML = "";
    const card = panelCard();
    card.style.minWidth = "340px";

    const codeRow = document.createElement("div");
    codeRow.style.cssText = "text-align:center;";
    codeRow.innerHTML = `<div style="font-size:12px; color:#8a7a68;">ROOM CODE</div>` +
      `<div style="font-size:30px; font-weight:bold; letter-spacing:6px;">${room.code}</div>`;
    card.appendChild(codeRow);

    const roster = document.createElement("div");
    roster.style.cssText = "display:flex; flex-direction:column; gap:6px;";
    for (const s of room.seats) {
      roster.appendChild(this.seatRow(s, room));
    }
    card.appendChild(roster);

    const amHost = this.seat.isHost();
    const myInfo = room.seats.find((s) => s.seatId === room.yourSeatId);

    const readyBtn = btn(myInfo?.ready ? "Not ready" : "Ready");
    readyBtn.addEventListener("click", () => {
      this.conn.send({ type: "setReady", ready: !(myInfo?.ready ?? false) });
    });
    card.appendChild(readyBtn);

    const loadoutBtn = btn("Edit loadout");
    loadoutBtn.addEventListener("click", () => this.onOpenLoadout());
    card.appendChild(loadoutBtn);

    if (amHost) {
      const startBtn = btn("Start expedition", true);
      startBtn.addEventListener("click", () => this.conn.send({ type: "startGame" }));
      card.appendChild(startBtn);
      const note = document.createElement("div");
      note.style.cssText = "font-size:11px; color:#8a7a68; text-align:center;";
      note.textContent = "Empty seats are filled by bots on start.";
      card.appendChild(note);
    } else {
      const note = document.createElement("div");
      note.style.cssText = "font-size:11px; color:#8a7a68; text-align:center;";
      note.textContent = "Waiting for the host to start.";
      card.appendChild(note);
    }

    // Leave -> the server frees the seat and replies `leftRoom`, which routes this client HOME.
    const leaveBtn = btn("Leave room");
    leaveBtn.addEventListener("click", () => this.conn.send({ type: "leaveRoom" }));
    card.appendChild(leaveBtn);

    this.container.appendChild(card);
  }

  private seatRow(s: SeatInfo, room: RoomStatePayload): HTMLDivElement {
    const row = document.createElement("div");
    const isMe = s.seatId === room.yourSeatId;
    const label =
      s.state === "open" ? "(open)"
      : s.state === "human-disconnected" ? "(dropped)"
      : s.state === "bot" ? "(bot)"
      : s.displayName;
    const readyText = s.state === "open" ? "" : s.ready ? "ready" : "not ready";
    const readyColor = s.ready ? "#5a7a3a" : "#8a7a68";

    row.style.cssText = `
      display:flex; align-items:center; gap:8px; padding:8px 10px;
      font-size:13px;
      background: rgba(255, 250, 238, ${isMe ? "0.98" : "0.8"});
      border: ${isMe ? "2px solid #4caf50" : "1px solid rgba(74,55,40,0.3)"};
      border-radius:6px;
    `;

    const name = document.createElement("span");
    name.style.cssText = "flex:1; font-weight:bold;";
    name.textContent = `${label}${s.isHost ? "  ★host" : ""}`;
    row.appendChild(name);

    const status = document.createElement("span");
    status.style.cssText = `color:${readyColor}; font-size:12px;`;
    status.textContent = readyText;
    row.appendChild(status);

    return row;
  }
}
