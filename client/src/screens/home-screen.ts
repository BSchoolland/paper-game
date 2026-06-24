import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import { clearStoredSeat, getStoredSeat } from "../net/player-token.js";
import type { RoomBrowserEntry, RoomCapacity } from "shared";
import { panelCard, btn } from "./ui-kit.js";

const LIST_POLL_MS = 3000;

/**
 * The out-of-room HOME screen (no room bound). Hosts matchmaking — a room browser of joinable
 * lobby-phase rooms (polled via `listRooms`), Quick Match (join any open room else create), plus
 * Create (capacity) / Join-by-code / force-reclaim. Owns the join/create error display. main.ts
 * routes here whenever `seat.room` is null (boot with no live game, or after `leftRoom`).
 */
export class HomeScreen implements Screen {
  private container: HTMLDivElement;
  /** Persistent room-browser list, repopulated in place on each `roomList` so a poll never rebuilds
   *  (and blurs / wipes) the join-by-code input or the rest of the card. */
  private browserList: HTMLDivElement;
  private rooms: readonly RoomBrowserEntry[] = [];
  private joinError = "";
  private capacity: RoomCapacity = 2;
  private pollTimer: number | null = null;

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private dimensionId: number,
  ) {
    this.container = document.createElement("div");
    this.container.id = "home-screen";
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

    this.browserList = document.createElement("div");
    this.browserList.style.cssText = "display:flex; flex-direction:column; gap:6px; margin-top:4px;";

    this.conn.on("error", (msg) => {
      switch (msg.code) {
        case "ROOM_NOT_FOUND":
        case "NOT_YOUR_SEAT":
          clearStoredSeat(); // stale seat / reaped room: stop offering the reclaim
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
          this.joinError = "Your seat is open in another tab. Use 'Take over my seat' to reclaim it.";
          this.rerenderIfVisible();
          return;
      }
    });
  }

  /** Fed by main.ts on every `roomList`. Updates ONLY the browser sub-list — never a full re-render —
   *  so a 3s poll can't blur or clear the join-by-code input mid-typing. */
  setRooms(rooms: readonly RoomBrowserEntry[]): void {
    this.rooms = rooms;
    if (this.container.style.display !== "none") this.populateBrowser();
  }

  private rerenderIfVisible(): void {
    if (this.container.style.display !== "none") this.render();
  }

  private requestList(): void {
    this.conn.send({ type: "listRooms" });
  }

  enter() {
    this.container.style.display = "flex";
    this.joinError = "";
    this.requestList();
    this.pollTimer = window.setInterval(() => this.requestList(), LIST_POLL_MS);
    this.render();
  }

  exit() {
    this.container.style.display = "none";
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private render() {
    this.container.innerHTML = "";
    const card = panelCard();
    card.style.minWidth = "360px";
    card.style.maxHeight = "86vh";
    card.style.overflowY = "auto";

    const heading = document.createElement("div");
    heading.style.cssText = "font-size:22px; font-weight:bold; margin-bottom:2px; text-align:center;";
    heading.textContent = "Co-op Expedition";
    card.appendChild(heading);

    // Force-reclaim a seat the server welcomed us room-less for (live elsewhere, e.g. another tab).
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
      forget.addEventListener("click", () => { clearStoredSeat(); this.render(); });
      card.appendChild(forget);
      card.appendChild(divider());
    }

    // Quick Match: join any open room, else create one (server-side).
    const quickBtn = btn("⚡ Quick Match", true);
    quickBtn.addEventListener("click", () => {
      this.joinError = "";
      this.conn.send({ type: "quickMatch", dimensionId: this.dimensionId });
    });
    card.appendChild(quickBtn);

    this.populateBrowser();
    card.appendChild(this.browserList);
    card.appendChild(divider());

    // Create
    const createLabel = document.createElement("div");
    createLabel.style.cssText = "font-size:13px;";
    createLabel.textContent = "Create a party";
    card.appendChild(createLabel);

    const capRow = document.createElement("div");
    capRow.style.cssText = "display:flex; gap:8px;";
    const capButtons: HTMLButtonElement[] = [];
    for (const n of [2, 3, 4] as RoomCapacity[]) {
      const b = btn(`${n}`);
      b.style.flex = "1";
      if (n === this.capacity) b.style.outline = "2px solid #4a3728";
      b.addEventListener("click", () => {
        this.capacity = n;
        for (const cb of capButtons) cb.style.outline = "none";
        b.style.outline = "2px solid #4a3728";
      });
      capButtons.push(b);
      capRow.appendChild(b);
    }
    card.appendChild(capRow);

    const createBtn = btn("Create room", true);
    createBtn.addEventListener("click", () => {
      this.joinError = "";
      this.conn.send({ type: "createRoom", capacity: this.capacity, dimensionId: this.dimensionId });
    });
    card.appendChild(createBtn);

    card.appendChild(divider());

    // Join by code
    const codeInput = document.createElement("input");
    codeInput.placeholder = "ROOM CODE";
    codeInput.maxLength = 6;
    codeInput.style.cssText = `
      text-transform: uppercase; letter-spacing: 3px; padding: 10px;
      font-family: monospace; font-size: 16px; text-align: center;
      border: 2px solid #6b5b4a; border-radius: 6px; background: #fffaf0; color: #4a3728;
    `;
    card.appendChild(codeInput);

    const joinBtn = btn("Join by code");
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

  /** Repopulate the persistent browser list in place (no full render — input/focus preserved). */
  private populateBrowser(): void {
    const wrap = this.browserList;
    wrap.innerHTML = "";

    const header = document.createElement("div");
    header.style.cssText = "display:flex; align-items:center; justify-content:space-between;";
    const title = document.createElement("span");
    title.style.cssText = "font-size:13px; color:#8a7a68;";
    title.textContent = `Open rooms (${this.rooms.length})`;
    const refresh = document.createElement("button");
    refresh.tabIndex = -1;
    refresh.textContent = "↻ refresh";
    refresh.style.cssText = "background:none; border:none; color:#6b5b4a; font-family:monospace; font-size:11px; cursor:pointer;";
    refresh.addEventListener("click", () => this.requestList());
    header.append(title, refresh);
    wrap.appendChild(header);

    if (this.rooms.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "font-size:12px; color:#8a7a68; text-align:center; padding:6px;";
      empty.textContent = "No open rooms — Quick Match or create one.";
      wrap.appendChild(empty);
      return;
    }

    for (const r of this.rooms) {
      const row = document.createElement("div");
      row.style.cssText = `
        display:flex; align-items:center; gap:8px; padding:7px 10px; font-size:13px;
        background: rgba(255,250,238,0.85); border:1px solid rgba(74,55,40,0.3); border-radius:6px;
      `;
      const info = document.createElement("div");
      info.style.cssText = "flex:1; display:flex; flex-direction:column;";
      const host = r.hostDisplayName || "Open room";
      info.innerHTML =
        `<span style="font-weight:bold; letter-spacing:2px;">${r.code}</span>` +
        `<span style="font-size:11px; color:#8a7a68;">${host} · ${r.totalSeats - r.openSeats}/${r.totalSeats} · dim ${r.dimensionId}</span>`;
      row.appendChild(info);

      const join = btn("Join");
      join.style.padding = "6px 12px";
      join.addEventListener("click", () => {
        this.joinError = "";
        this.conn.send({ type: "joinRoom", code: r.code });
      });
      row.appendChild(join);
      wrap.appendChild(row);
    }
  }
}

function divider(): HTMLDivElement {
  const d = document.createElement("div");
  d.style.cssText = "height:1px; background:rgba(74,55,40,0.3); margin:6px 0;";
  return d;
}
