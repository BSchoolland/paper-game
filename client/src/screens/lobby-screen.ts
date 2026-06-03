import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import { clearStoredSeat, getStoredSeat } from "../net/player-token.js";
import type { RoomCapacity, RoomStatePayload, SeatInfo } from "shared";

/**
 * The lobby (first screen). Before a room exists it shows create (capacity 2-4) / join-by-code
 * entry; once seated it shows the room code, the seat roster, a per-seat ready toggle for the
 * local seat, a loadout button (opens the inventory in loadout mode pre-Start), and a host-only
 * Start that bot-fills empty seats server-side. All roster data comes from `roomState` via the
 * SeatContext; readiness/start are server-authoritative (ready is informational, not a start gate).
 */
export class LobbyScreen implements Screen {
  private container: HTMLDivElement;
  private unsub: (() => void) | null = null;
  private joinError = "";

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private onOpenLoadout: () => void,
    private dimensionId: number,
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
    this.conn.on("error", (msg) => {
      switch (msg.code) {
        case "ROOM_NOT_FOUND":
        case "NOT_YOUR_SEAT":
          // A join/reclaim against a stale seat or reaped room: forget it so the entry screen stops
          // offering the reclaim and shows why.
          clearStoredSeat();
          this.joinError = msg.message;
          this.rerenderIfVisible();
          return;
        case "ROOM_FULL":
        case "ALREADY_STARTED":
        case "ROOM_CREATE_FAILED":
          this.joinError = msg.message;
          this.rerenderIfVisible();
          return;
        case "SEAT_IN_USE":
          // The stored seat is live (e.g. another tab); a force-reclaim is required to take it back.
          this.joinError = "Your seat is open in another tab. Use 'Take over my seat' to reclaim it.";
          this.rerenderIfVisible();
          return;
      }
    });
  }

  private rerenderIfVisible(): void {
    if (this.container.style.display !== "none") this.render();
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
    if (room && room.phase === "lobby") {
      this.renderRoster(room);
    } else if (!room) {
      this.renderEntry();
    } else {
      // Room exists but is past lobby (overworld/combat/gameover) — the screen manager will switch
      // away; render nothing meaningful here.
      this.container.innerHTML = "";
    }
  }

  private renderEntry() {
    this.container.innerHTML = "";
    const card = panelCard();

    const heading = document.createElement("div");
    heading.style.cssText = "font-size:22px; font-weight:bold; margin-bottom:4px;";
    heading.textContent = "Co-op Expedition";
    card.appendChild(heading);

    // Reclaim: a seat from a prior session that the server welcomed us room-less for (live elsewhere,
    // e.g. another tab). Force-reclaim closes the old socket and rebinds this one.
    const stored = getStoredSeat();
    if (stored) {
      const reclaimBtn = btn("Take over my seat", true);
      reclaimBtn.addEventListener("click", () => {
        this.joinError = "";
        this.conn.send({ type: "reclaimSeat", code: stored.code, seatId: stored.seatId, force: true });
      });
      card.appendChild(reclaimBtn);

      const forget = document.createElement("button");
      forget.tabIndex = -1;
      forget.textContent = "(start fresh instead)";
      forget.style.cssText = "background:none; border:none; color:#8a7a68; font-family:monospace; font-size:11px; cursor:pointer;";
      forget.addEventListener("click", () => {
        clearStoredSeat();
        this.render();
      });
      card.appendChild(forget);

      const divider = document.createElement("div");
      divider.style.cssText = "height:1px; background:rgba(74,55,40,0.3); margin:6px 0;";
      card.appendChild(divider);
    }

    // Create
    const createLabel = document.createElement("div");
    createLabel.style.cssText = "font-size:13px; margin-top:8px;";
    createLabel.textContent = "Party size";
    card.appendChild(createLabel);

    const capRow = document.createElement("div");
    capRow.style.cssText = "display:flex; gap:8px;";
    let capacity: RoomCapacity = 2;
    const capButtons: HTMLButtonElement[] = [];
    for (const n of [2, 3, 4] as RoomCapacity[]) {
      const b = btn(`${n}`);
      b.style.flex = "1";
      b.addEventListener("click", () => {
        capacity = n;
        for (const cb of capButtons) cb.style.outline = "none";
        b.style.outline = "2px solid #4a3728";
      });
      if (n === capacity) b.style.outline = "2px solid #4a3728";
      capButtons.push(b);
      capRow.appendChild(b);
    }
    card.appendChild(capRow);

    const createBtn = btn("Create room", true);
    createBtn.addEventListener("click", () => {
      this.joinError = "";
      this.conn.send({ type: "createRoom", capacity, dimensionId: this.dimensionId });
    });
    card.appendChild(createBtn);

    const divider = document.createElement("div");
    divider.style.cssText = "height:1px; background:rgba(74,55,40,0.3); margin:6px 0;";
    card.appendChild(divider);

    // Join
    const codeInput = document.createElement("input");
    codeInput.placeholder = "ROOM CODE";
    codeInput.maxLength = 6;
    codeInput.style.cssText = `
      text-transform: uppercase;
      letter-spacing: 3px;
      padding: 10px;
      font-family: monospace;
      font-size: 16px;
      text-align: center;
      border: 2px solid #6b5b4a;
      border-radius: 6px;
      background: #fffaf0;
      color: #4a3728;
    `;
    card.appendChild(codeInput);

    const joinBtn = btn("Join room");
    const doJoin = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length === 0) return;
      this.joinError = "";
      this.conn.send({ type: "joinRoom", code });
    };
    joinBtn.addEventListener("click", doJoin);
    codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
    card.appendChild(joinBtn);

    if (this.joinError) {
      const err = document.createElement("div");
      err.style.cssText = "color:#8b3a3a; font-size:12px; text-align:center;";
      err.textContent = this.joinError;
      card.appendChild(err);
    }

    this.container.appendChild(card);
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

    const leaveBtn = btn("Leave room");
    leaveBtn.addEventListener("click", () => {
      this.conn.send({ type: "leaveRoom" });
      this.seat.setRoom(null);
      clearStoredSeat();
      this.joinError = "";
      this.render();
    });
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

function panelCard(): HTMLDivElement {
  const card = document.createElement("div");
  card.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 280px;
    padding: 24px;
    background: rgba(245, 235, 215, 0.97);
    border: 2px solid #6b5b4a;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(35, 24, 14, 0.3);
  `;
  return card;
}

function btn(label: string, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.tabIndex = -1;
  b.style.cssText = `
    padding: 10px 16px;
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    color: ${primary ? "#fffaf0" : "#4a3728"};
    background: ${primary ? "#6b5b4a" : "#d4c8a0"};
    border: 2px solid #6b5b4a;
    border-radius: 6px;
    cursor: pointer;
  `;
  return b;
}
