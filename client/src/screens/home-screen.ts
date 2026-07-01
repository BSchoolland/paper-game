import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import type { AccountStore } from "../state/account-store.js";
import type { AuthMode } from "./auth-modal.js";
import { ProfileCard } from "./profile-card.js";
import { FriendsPanel } from "./friends-panel.js";
import { clearStoredSeat, getStoredSeat } from "../net/player-token.js";
import type { RoomBrowserEntry, RoomCapacity } from "shared";
import { assetUrl } from "../renderer/asset-url.js";
import {
  THEME,
  FONT,
  boardBackdrop,
  panelCard,
  rule,
  btn,
  eyebrow,
  heading,
  seatPips,
  mapIconDot,
  errorNote,
} from "./ui-kit.js";

const LIST_POLL_MS = 3000;

/**
 * The out-of-room HOME screen (no room bound). Hosts matchmaking — a room browser of joinable
 * lobby-phase rooms (polled via `listRooms`), Quick Match (join any open room else create), plus
 * Create (capacity) / Join-by-code / force-reclaim. Owns the join/create error display. main.ts
 * routes here whenever `seat.room` is null (boot with no live game, or after `leftRoom`).
 *
 * Layout: a wide dark slate panel split into a left hero/actions column and a right "OPEN ROOMS"
 * rail. The rail's row list (`browserList`) is repopulated in place on every poll so the
 * join-by-code input never blurs mid-typing.
 */
export class HomeScreen implements Screen {
  private container: HTMLDivElement;
  /** Persistent room-browser list, repopulated in place on each `roomList` so a poll never rebuilds
   *  (and blurs / wipes) the join-by-code input or the rest of the card. */
  private browserList: HTMLDivElement;
  /** Persistent community elements (same discipline as browserList): built once, re-mounted per
   *  render, self-updating on AccountStore notify. */
  private profileCard: ProfileCard;
  private friendsPanel: FriendsPanel;
  private authNotice: HTMLDivElement;
  private rooms: readonly RoomBrowserEntry[] = [];
  private joinError = "";
  private capacity: RoomCapacity = 2;
  private pollTimer: number | null = null;

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private dimensionId: number,
    private account: AccountStore,
    openAuth: (mode: AuthMode) => void,
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
      font-family: ${FONT.body};
      color: ${THEME.parch};
      background: ${THEME.deep};
    `;
    document.body.appendChild(this.container);

    this.browserList = document.createElement("div");
    this.browserList.style.cssText = "display:flex; flex-direction:column; gap:12px; margin-top:18px; flex:1; overflow-y:auto;";

    this.profileCard = new ProfileCard(this.conn, this.account, openAuth);
    this.profileCard.root.style.marginBottom = "22px";
    this.friendsPanel = new FriendsPanel(this.conn, this.account, this.seat, openAuth);
    this.friendsPanel.root.style.cssText += "flex:0 0 auto; margin-top:16px;";
    this.authNotice = document.createElement("div");
    this.authNotice.style.marginBottom = "12px";
    this.account.subscribe(() => this.populateAuthNotice());
    this.populateAuthNotice();

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

  /** Populated in place (persistent node): the login-again note when a saved token was rejected. */
  private populateAuthNotice(): void {
    this.authNotice.innerHTML = "";
    const rejected = this.account.authRejected;
    if (!rejected) return;
    this.authNotice.appendChild(
      errorNote(
        rejected === "expired"
          ? "Your session expired — log in again to restore your account."
          : "Your saved login was not accepted — log in again to restore your account.",
      ),
    );
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
    this.container.appendChild(boardBackdrop("home"));

    const card = panelCard({ padded: false });
    card.style.width = "1080px";
    card.style.maxWidth = "94vw";
    card.style.maxHeight = "90vh";

    const grid = document.createElement("div");
    grid.style.cssText = `position:relative; display:grid; grid-template-columns:1fr 440px; min-height:560px; max-height:90vh;`;

    grid.appendChild(this.leftColumn());
    grid.appendChild(this.rightColumn());

    card.appendChild(grid);
    this.container.appendChild(card);
  }

  /** Left column: hero copy, reclaim (if any), Quick Match, Create (capacity), Join by code, errors. */
  private leftColumn(): HTMLDivElement {
    const left = document.createElement("div");
    left.style.cssText = `
      padding:38px 48px 44px; display:flex; flex-direction:column; justify-content:center;
      overflow-y:auto;
    `;

    left.appendChild(this.authNotice);
    left.appendChild(this.profileCard.root);

    left.appendChild(eyebrow("Cooperative Expedition"));
    const title = heading("Gather Your Warband", "hero");
    title.style.marginTop = "10px";
    title.style.fontSize = "50px";
    left.appendChild(title);

    const blurb = document.createElement("p");
    blurb.textContent =
      "Brave the gateway city together. Form a party of up to four, choose your kits, and march into the painted wilds.";
    blurb.style.cssText = `margin:18px 0 28px; max-width:440px; font:16px/1.6 ${FONT.body}; color:${THEME.muted};`;
    left.appendChild(blurb);

    const actions = document.createElement("div");
    actions.style.cssText = `display:flex; flex-direction:column; gap:14px; max-width:420px;`;

    // ── Reclaim a seat the server welcomed us room-less for (live elsewhere) ──
    const stored = getStoredSeat();
    if (stored) {
      const reclaimBtn = btn("Take over my seat", "primary");
      reclaimBtn.style.width = "100%";
      reclaimBtn.addEventListener("click", () => {
        this.joinError = "";
        this.conn.send({ type: "reclaimSeat", code: stored.code, seatId: stored.seatId, force: true });
      });
      actions.appendChild(reclaimBtn);

      const forget = document.createElement("button");
      forget.tabIndex = -1;
      forget.textContent = "(start fresh instead)";
      forget.style.cssText = `
        align-self:center; background:none; border:none; cursor:pointer;
        font:600 11px ${FONT.body}; letter-spacing:1px; color:${THEME.muted};
      `;
      forget.addEventListener("click", () => {
        clearStoredSeat();
        this.render();
      });
      actions.appendChild(forget);
      actions.appendChild(rule());
    }

    // ── Quick Match ──
    const quickBtn = btn("Quick Match", "primary");
    quickBtn.style.width = "100%";
    quickBtn.style.fontSize = "18px";
    quickBtn.style.padding = "17px 26px";
    quickBtn.addEventListener("click", () => {
      this.joinError = "";
      this.conn.send({ type: "quickMatch", dimensionId: this.dimensionId });
    });
    actions.appendChild(quickBtn);

    actions.appendChild(this.createBlock());
    actions.appendChild(this.joinBlock());

    if (this.joinError) actions.appendChild(this.errorBox());

    left.appendChild(actions);
    return left;
  }

  /** Create a party: a 2/3/4 capacity segmented control + Create room button. */
  private createBlock(): HTMLDivElement {
    const block = document.createElement("div");
    block.style.cssText = "display:flex; flex-direction:column; gap:10px; margin-top:4px;";

    const label = document.createElement("div");
    label.style.cssText = `font:600 12px ${FONT.body}; text-transform:uppercase; letter-spacing:0.2em; color:${THEME.faint};`;
    label.textContent = "Create a party";
    block.appendChild(label);

    const capRow = document.createElement("div");
    capRow.style.cssText = `display:flex; border:1px solid ${THEME.goldLine}; border-radius:8px; overflow:hidden; background:rgba(11,9,6,0.4);`;
    const applyCapSkin = (seg: HTMLButtonElement, n: RoomCapacity) => {
      const on = n === this.capacity;
      seg.style.background = on ? "linear-gradient(180deg, rgba(184,137,58,0.35), rgba(184,137,58,0.15))" : "transparent";
      const lbl = seg.firstElementChild as HTMLElement;
      lbl.style.color = on ? THEME.gold : THEME.muted;
      const pips = seg.lastElementChild as HTMLElement;
      pips.style.opacity = on ? "1" : ".5";
    };
    const capValues: RoomCapacity[] = [2, 3, 4];
    const capSegs: HTMLButtonElement[] = [];
    for (const n of capValues) {
      const seg = document.createElement("button");
      seg.tabIndex = -1;
      seg.style.cssText = `
        flex:1; cursor:pointer; border:none; background:transparent;
        padding:10px 6px;
        display:flex; flex-direction:column; align-items:center; gap:6px;
        ${n !== 4 ? `border-right:1px solid ${THEME.goldLine};` : ""}
        transition:background .12s;
      `;
      const segLabel = document.createElement("div");
      segLabel.textContent = `${n}`;
      segLabel.style.cssText = `font:700 16px ${FONT.cinzel};`;
      const pips = document.createElement("div");
      pips.appendChild(seatPips(n, n));
      pips.style.cssText = "display:flex; justify-content:center;";
      seg.append(segLabel, pips);
      applyCapSkin(seg, n);
      seg.addEventListener("click", () => {
        this.capacity = n;
        capSegs.forEach((s, i) => applyCapSkin(s, capValues[i]!));
      });
      capSegs.push(seg);
      capRow.appendChild(seg);
    }
    block.appendChild(capRow);

    const createBtn = btn("Create Room", "secondary");
    createBtn.style.width = "100%";
    createBtn.addEventListener("click", () => {
      this.joinError = "";
      this.conn.send({ type: "createRoom", capacity: this.capacity, dimensionId: this.dimensionId });
    });
    block.appendChild(createBtn);
    return block;
  }

  /** Join by code: glyph + spaced uppercase input + Join button. Input must survive polls (see render). */
  private joinBlock(): HTMLDivElement {
    const block = document.createElement("div");
    block.style.cssText = "display:flex; flex-direction:column; gap:10px; margin-top:4px;";

    const label = document.createElement("div");
    label.style.cssText = `font:600 12px ${FONT.body}; text-transform:uppercase; letter-spacing:0.2em; color:${THEME.faint};`;
    label.textContent = "Join by code";
    block.appendChild(label);

    const codeRow = document.createElement("div");
    codeRow.style.cssText = "display:flex; align-items:center; gap:10px;";
    codeRow.appendChild(mapIconDot("gateway-city", 44));

    const codeInput = document.createElement("input");
    codeInput.placeholder = "CODE";
    codeInput.maxLength = 6;
    codeInput.style.cssText = `
      flex:1; min-width:0; box-sizing:border-box;
      text-transform:uppercase; letter-spacing:6px; padding:13px 14px;
      font:600 18px ${FONT.cinzel}; text-align:center;
      border:1px solid ${THEME.goldLine}; border-radius:8px;
      background:rgba(11,9,6,0.5); color:${THEME.gold};
      box-shadow:inset 0 2px 6px rgba(0,0,0,0.4);
    `;
    codeInput.addEventListener("focus", () => {
      codeInput.style.borderColor = THEME.gold;
    });
    codeInput.addEventListener("blur", () => {
      codeInput.style.borderColor = THEME.goldLine;
    });

    const joinBtn = btn("Join by Code", "secondary");
    const doJoin = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length === 0) return;
      this.joinError = "";
      this.conn.send({ type: "joinRoom", code });
    };
    joinBtn.addEventListener("click", doJoin);
    codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJoin();
    });

    codeRow.appendChild(codeInput);
    codeRow.appendChild(joinBtn);
    block.appendChild(codeRow);
    return block;
  }

  private errorBox(): HTMLDivElement {
    const err = errorNote(this.joinError);
    err.style.marginTop = "2px";
    return err;
  }

  /** Right column: the "OPEN ROOMS" rail. The masthead is static; only `browserList` reflows on poll. */
  private rightColumn(): HTMLDivElement {
    const right = document.createElement("div");
    right.style.cssText = `
      padding:36px 32px; display:flex; flex-direction:column; min-width:0;
      background:linear-gradient(180deg, rgba(11,9,6,0.55), rgba(11,9,6,0.85));
      border-left:1px solid ${THEME.goldLine};
    `;

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:baseline; justify-content:space-between;";
    const title = heading("Open Rooms", "section");
    const refresh = document.createElement("button");
    refresh.tabIndex = -1;
    refresh.textContent = "↻ refresh";
    refresh.style.cssText = `background:none; border:none; cursor:pointer; font:600 11px ${FONT.body}; letter-spacing:1px; color:${THEME.goldDeep};`;
    refresh.addEventListener("click", () => this.requestList());
    head.append(title, refresh);
    right.appendChild(head);
    right.appendChild(rule());

    this.populateBrowser();
    right.appendChild(this.browserList);

    right.appendChild(this.friendsPanel.root);

    const status = document.createElement("div");
    status.style.cssText = `
      display:flex; align-items:center; justify-content:center; gap:9px; margin-top:16px; flex:0 0 auto;
      padding-top:16px; border-top:1px solid rgba(184,137,58,0.2);
      font:13px ${FONT.body}; color:${THEME.faint};
    `;
    status.innerHTML =
      `<span style="width:8px;height:8px;border-radius:50%;background:${THEME.green};box-shadow:0 0 8px ${THEME.green}"></span>` +
      `Connected to the realm`;
    right.appendChild(status);
    return right;
  }

  /** Repopulate the persistent browser list in place (no full render — input/focus preserved). */
  private populateBrowser(): void {
    const wrap = this.browserList;
    wrap.innerHTML = "";

    if (this.rooms.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = `
        position:relative; padding:28px 14px; text-align:center; overflow:hidden;
        border-radius:10px; border:1px dashed ${THEME.goldLine};
        background:linear-gradient(180deg, rgba(58,47,37,0.2), rgba(11,9,6,0.3));
        font:600 14px ${FONT.cinzel}; color:${THEME.muted};
      `;
      const watermark = document.createElement("div");
      watermark.style.cssText = `
        position:absolute; inset:0; opacity:.08; pointer-events:none;
        background:url(${assetUrl("/sprites/map-icons/ruins.png")}) center/48px no-repeat;
      `;
      const emptyText = document.createElement("span");
      emptyText.textContent = "No open rooms — Quick Match or create one.";
      emptyText.style.cssText = "position:relative;";
      empty.append(watermark, emptyText);
      wrap.appendChild(empty);
      return;
    }

    for (const r of this.rooms) {
      const row = document.createElement("div");
      row.style.cssText = `
        display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:10px;
        background:linear-gradient(150deg, rgba(40,30,20,0.5), rgba(18,13,8,0.6));
        backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        border:1px solid rgba(184,137,58,0.28);
        border-bottom:1px solid ${THEME.goldLine};
        box-shadow:0 4px 14px -8px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,250,240,0.05);
      `;

      row.appendChild(mapIconDot("gateway-city", 44));

      const info = document.createElement("div");
      info.style.cssText = "flex:1; min-width:0;";
      const code = document.createElement("div");
      code.textContent = r.code;
      code.style.cssText = `font:600 17px ${FONT.cinzel}; letter-spacing:0.08em; color:${THEME.gold};`;
      const meta = document.createElement("div");
      const host = r.hostDisplayName || "Open room";
      meta.textContent = `Host · ${host} · dim ${r.dimensionId}`;
      meta.style.cssText = `font:13px ${FONT.body}; color:${THEME.muted}; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
      info.append(code, meta);
      row.appendChild(info);

      const seatsWrap = document.createElement("div");
      seatsWrap.style.cssText = "display:flex; flex-direction:column; align-items:flex-end; gap:8px;";
      seatsWrap.appendChild(seatPips(r.totalSeats, r.totalSeats - r.openSeats));

      const join = btn("Join", "secondary");
      join.style.padding = "7px 18px";
      join.style.fontSize = "13px";
      join.addEventListener("click", () => {
        this.joinError = "";
        this.conn.send({ type: "joinRoom", code: r.code });
      });
      seatsWrap.appendChild(join);
      row.appendChild(seatsWrap);
      wrap.appendChild(row);
    }
  }
}
