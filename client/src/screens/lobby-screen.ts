import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import type { RoomStatePayload, SeatInfo } from "shared";
import { STARTER_PRESETS } from "shared";
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
  presetPlate,
} from "./ui-kit.js";

const PRESET_NAME: Record<string, string> = Object.fromEntries(
  STARTER_PRESETS.map((p) => [p.id, p.name]),
);

/**
 * The in-room STAGING screen (RoomPhase "lobby"): room code, seat roster, a per-seat ready toggle,
 * a loadout button (opens the inventory in loadout mode pre-Start), a host-only Start that bot-fills
 * empty seats server-side, and Leave. The out-of-room entry + matchmaking lives in HomeScreen. All
 * roster data comes from `roomState` via the SeatContext; readiness/start are server-authoritative.
 *
 * Layout: a wide dark slate panel — a header (room-code chip), a 2-column body (roster rail left,
 * preset plates right), and a footer action bar.
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
      font-family: ${FONT.body};
      color: ${THEME.parch};
      background: ${THEME.deep};
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
    this.container.appendChild(boardBackdrop("lobby"));

    const card = panelCard({ padded: false });
    card.style.width = "1140px";
    card.style.maxWidth = "94vw";
    card.style.maxHeight = "92vh";
    card.style.display = "flex";
    card.style.flexDirection = "column";

    card.appendChild(this.header(room));
    card.appendChild(this.body(room));
    card.appendChild(this.footer(room));

    this.container.appendChild(card);
  }

  /** Header: eyebrow + "War Council" title flanked by the room-code chip, plus a context line. */
  private header(room: RoomStatePayload): HTMLDivElement {
    const header = document.createElement("div");
    header.style.cssText = "display:flex; align-items:center; justify-content:space-between; padding:28px 44px 20px; flex:0 0 auto;";

    const left = document.createElement("div");
    left.appendChild(eyebrow("Party Lobby"));

    const codeRow = document.createElement("div");
    codeRow.style.cssText = "display:flex; align-items:baseline; gap:16px; margin-top:8px;";
    const title = heading("War Council", "section");
    title.style.font = `800 38px ${FONT.cinzel}`;
    title.style.color = THEME.parch;

    const chip = document.createElement("div");
    chip.textContent = room.code;
    chip.style.cssText = `
      font:600 18px ${FONT.cinzel}; letter-spacing:0.22em; color:${THEME.gold};
      padding:6px 14px; border:1px solid ${THEME.gold}; border-radius:8px;
      background:rgba(11,9,6,0.55); box-shadow:0 0 14px -4px rgba(232,200,122,0.5);
    `;
    codeRow.append(title, chip);
    left.appendChild(codeRow);
    header.appendChild(left);

    const ctx = document.createElement("div");
    ctx.style.cssText = `text-align:right; font:13px/1.7 ${FONT.body}; color:${THEME.muted};`;
    ctx.innerHTML = `Dimension <b style="color:${THEME.gold}">${room.dimensionId}</b> · Gateway City<br/>
      <span style="color:${THEME.faint}">${this.seat.isHost() ? "Begin when your warband is ready" : "Waiting on the host to begin"}</span>`;
    header.appendChild(ctx);

    return header;
  }

  /** Two-column body: roster rail (left) + preset picker (right). */
  private body(room: RoomStatePayload): HTMLDivElement {
    const ruleWrap = document.createElement("div");
    ruleWrap.style.cssText = "padding:0 44px; flex:0 0 auto;";
    ruleWrap.appendChild(rule());

    const body = document.createElement("div");
    body.style.cssText = "display:grid; grid-template-columns:380px 1fr; flex:1 1 auto; min-height:0;";

    body.appendChild(this.rosterRail(room));
    body.appendChild(this.presetPicker(room));

    const outer = document.createElement("div");
    outer.style.cssText = "display:flex; flex-direction:column; flex:1 1 auto; min-height:0;";
    outer.append(ruleWrap, body);
    return outer;
  }

  /** Left rail: "Roster" heading over one ledger row per seat. */
  private rosterRail(room: RoomStatePayload): HTMLDivElement {
    const roster = document.createElement("div");
    roster.style.cssText = `padding:26px 32px 30px; border-right:1px solid ${THEME.goldLine}; overflow-y:auto;`;

    const title = heading("Roster", "section");
    title.style.marginBottom = "16px";
    roster.appendChild(title);

    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; gap:12px;";
    for (const s of room.seats) list.appendChild(this.seatRow(s, room));
    roster.appendChild(list);
    return roster;
  }

  /** A seat ledger row: avatar token, name + host/bot badge + preset, and a ready badge. */
  private seatRow(s: SeatInfo, room: RoomStatePayload): HTMLDivElement {
    const isMe = s.seatId === room.yourSeatId;
    const isOpen = s.state === "open";
    const isBot = s.state === "bot";
    const isDropped = s.state === "human-disconnected";

    const row = document.createElement("div");
    row.style.cssText = `
      display:flex; align-items:center; gap:13px; padding:13px 15px; border-radius:11px;
      background:${isOpen
        ? "rgba(11,9,6,0.35)"
        : "linear-gradient(180deg, rgba(58,47,37,0.5), rgba(33,27,22,0.6))"};
      border:1px solid ${isMe ? THEME.greenBright : isOpen ? "rgba(138,122,104,0.5)" : "rgba(184,137,58,0.3)"};
      ${isOpen ? "border-style:dashed;" : ""}
      ${isMe ? `box-shadow:inset 0 0 0 1px ${THEME.greenBright};` : ""}
    `;

    // avatar
    const avatar = document.createElement("div");
    avatar.style.cssText = `
      width:46px; height:46px; flex:0 0 auto; border-radius:50%; box-sizing:border-box;
      border:1px solid ${THEME.goldLine};
      background:radial-gradient(circle, rgba(184,137,58,0.2), rgba(11,9,6,0.5));
      display:flex; align-items:center; justify-content:center; overflow:hidden;
    `;
    if (isOpen) {
      avatar.innerHTML = `<span style="font:22px ${FONT.cinzel}; color:${THEME.faint}">+</span>`;
    } else {
      const tok = document.createElement("img");
      tok.src = assetUrl(isMe ? "/sprites/player/blue-player-idle.webp" : "/sprites/player/red-player-idle.webp");
      tok.style.cssText = `
        width:54px; height:54px; object-fit:contain; transform:translateY(4px);
        filter:${isDropped ? "grayscale(1)" : "none"};
        opacity:${isDropped ? ".5" : isBot ? ".6" : "1"};
      `;
      avatar.appendChild(tok);
    }
    row.appendChild(avatar);

    // info
    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";

    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex; align-items:center; gap:8px;";
    const name = document.createElement("div");
    name.textContent =
      isOpen ? "Open Seat"
      : isDropped ? `${s.displayName} (dropped)`
      : s.displayName;
    name.style.cssText = `font:600 16px ${FONT.body}; color:${isOpen ? THEME.faint : THEME.parch}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
    nameRow.appendChild(name);
    if (s.isHost) nameRow.appendChild(this.badge("HOST", THEME.goldDeep, THEME.goldLine));
    if (isBot) nameRow.appendChild(this.badge("BOT", THEME.muted, THEME.faint));
    info.appendChild(nameRow);

    const sub = document.createElement("div");
    sub.textContent = isOpen
      ? "Invite a friend or add a bot"
      : s.presetId
        ? PRESET_NAME[s.presetId] ?? "Choosing kit…"
        : "Choosing kit…";
    sub.style.cssText = `font:12.5px ${FONT.body}; color:${THEME.muted}; margin-top:3px;`;
    info.appendChild(sub);
    row.appendChild(info);

    // ready state
    if (!isOpen) row.appendChild(this.readyTag(s.ready));

    return row;
  }

  private badge(text: string, color: string, borderColor: string): HTMLDivElement {
    const b = document.createElement("div");
    b.textContent = text;
    b.style.cssText = `font:10px ${FONT.body}; font-weight:600; letter-spacing:0.12em; color:${color}; border:1px solid ${borderColor}; padding:1px 6px; border-radius:5px;`;
    return b;
  }

  /** Bright green READY badge or a faint "waiting". */
  private readyTag(ready: boolean): HTMLDivElement {
    const tag = document.createElement("div");
    if (ready) {
      tag.style.cssText = `display:flex; align-items:center; gap:6px; font:700 12px ${FONT.body}; letter-spacing:0.08em; color:${THEME.greenBright};`;
      tag.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${THEME.greenBright};box-shadow:0 0 8px ${THEME.greenBright}"></span>READY`;
    } else {
      tag.style.cssText = `font:600 12px ${FONT.body}; letter-spacing:0.06em; color:${THEME.faint};`;
      tag.textContent = "waiting";
    }
    return tag;
  }

  /** Right column: "Choose Your Kit" heading + the three illuminated preset plates. */
  private presetPicker(room: RoomStatePayload): HTMLDivElement {
    const myInfo = room.seats.find((s) => s.seatId === room.yourSeatId);
    const selectedId = myInfo?.presetId ?? null;

    const right = document.createElement("div");
    right.style.cssText = "padding:26px 40px 28px; display:flex; flex-direction:column; min-width:0; overflow-y:auto;";

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:baseline; justify-content:space-between; margin-bottom:18px;";
    head.appendChild(heading("Choose Your Kit", "section"));
    const sel = document.createElement("div");
    const selName = selectedId ? (PRESET_NAME[selectedId] ?? selectedId).toUpperCase() : "NONE";
    sel.textContent = `YOUR SELECTION · ${selName}`;
    sel.style.cssText = `font:12px ${FONT.body}; letter-spacing:0.1em; color:${THEME.faint};`;
    head.appendChild(sel);
    right.appendChild(head);

    const cards = document.createElement("div");
    cards.style.cssText = "display:grid; grid-template-columns:repeat(3,1fr); gap:16px;";
    for (const preset of STARTER_PRESETS) {
      const plate = presetPlate(preset, preset.id === selectedId);
      plate.addEventListener("click", () =>
        this.conn.send({ type: "choosePreset", presetId: preset.id }),
      );
      cards.appendChild(plate);
    }
    right.appendChild(cards);

    const loadoutBtn = btn("Edit Loadout", "secondary");
    loadoutBtn.style.marginTop = "16px";
    loadoutBtn.style.alignSelf = "flex-start";
    loadoutBtn.addEventListener("click", () => this.onOpenLoadout());
    right.appendChild(loadoutBtn);

    return right;
  }

  /** Footer: readiness tally on the left; Leave + Ready (+ host Start) on the right. */
  private footer(room: RoomStatePayload): HTMLDivElement {
    const myInfo = room.seats.find((s) => s.seatId === room.yourSeatId);
    const amHost = this.seat.isHost();
    const filled = room.seats.filter((s) => s.state !== "open");
    const readyCount = filled.filter((s) => s.ready).length;
    const openCount = room.seats.filter((s) => s.state === "open").length;

    const footer = document.createElement("div");
    footer.style.cssText = `
      display:flex; align-items:center; justify-content:space-between; padding:20px 44px 26px; flex:0 0 auto;
      border-top:1px solid ${THEME.goldLine}; background:linear-gradient(180deg, transparent, rgba(11,9,6,0.5));
    `;

    const tally = document.createElement("div");
    tally.style.cssText = `font:13px ${FONT.body}; color:${THEME.muted};`;
    tally.innerHTML =
      `<b style="color:${THEME.greenBright}">${readyCount} of ${filled.length}</b> warriors ready` +
      (openCount > 0 ? ` · ${openCount} open seat${openCount === 1 ? "" : "s"}` : "");
    footer.appendChild(tally);

    const btns = document.createElement("div");
    btns.style.cssText = "display:flex; align-items:center; gap:14px;";

    const leaveBtn = btn("Leave", "danger");
    leaveBtn.addEventListener("click", () => this.conn.send({ type: "leaveRoom" }));
    btns.appendChild(leaveBtn);

    const readyBtn = btn(myInfo?.ready ? "Not Ready" : "I'm Ready", "primary");
    readyBtn.style.minWidth = "170px";
    if (myInfo?.ready) {
      readyBtn.style.background = `linear-gradient(180deg, ${THEME.green}, ${THEME.greenDeep})`;
      readyBtn.style.borderColor = THEME.greenBright;
      readyBtn.style.color = "#15240c";
    }
    readyBtn.addEventListener("click", () => {
      this.conn.send({ type: "setReady", ready: !(myInfo?.ready ?? false) });
    });
    btns.appendChild(readyBtn);

    if (amHost) {
      const startBtn = btn("Start Expedition", "primary");
      startBtn.title = "Empty seats are filled by bots on start.";
      startBtn.addEventListener("click", () => this.conn.send({ type: "startGame" }));
      btns.appendChild(startBtn);
    }
    footer.appendChild(btns);

    return footer;
  }
}
