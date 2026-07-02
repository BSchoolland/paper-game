import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import type { ChatStore } from "../state/chat-store.js";
import { THEME, FONT, btn, textInput } from "./ui-kit.js";

const CHAT_MAX_LEN = 300;

/**
 * The floating party-chat panel (VotePanel precedent): constructed once in main.ts and
 * fixed bottom-left, its DOM subtree lives outside every screen — LobbyScreen's
 * full-innerHTML re-renders can never blur the input. Visible in the lobby and overworld
 * phases; one component serves both. Collapsible, with an unread pip while collapsed.
 */
export class ChatPanel {
  private container: HTMLDivElement;
  private bodyWrap: HTMLDivElement;
  private list: HTMLDivElement;
  private input: HTMLInputElement;
  private pip: HTMLSpanElement;
  private chevron: HTMLSpanElement;
  private collapsed = false;
  private seenCount = 0;

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private chat: ChatStore,
  ) {
    this.container = document.createElement("div");
    this.container.id = "chat-panel";
    this.container.style.cssText = `
      position:fixed; left:16px; bottom:16px; z-index:110;
      display:none; flex-direction:column; width:320px; overflow:hidden;
      background:rgba(17,13,9,0.85); border:1px solid ${THEME.goldLine}; border-radius:10px;
      box-shadow:0 10px 30px -10px rgba(0,0,0,0.7);
      backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
    `;

    // header (click to collapse/expand)
    const header = document.createElement("div");
    header.style.cssText = `
      display:flex; align-items:center; gap:8px; padding:10px 14px; cursor:pointer; user-select:none;
      border-bottom:1px solid rgba(184,137,58,0.25);
    `;
    const title = document.createElement("span");
    title.textContent = "Party Chat";
    title.style.cssText = `font:600 14px ${FONT.cinzel}; letter-spacing:0.06em; color:${THEME.gold};`;
    this.pip = document.createElement("span");
    this.pip.style.cssText = `
      display:none; width:8px; height:8px; border-radius:50%;
      background:${THEME.gold}; box-shadow:0 0 8px rgba(232,200,122,0.7);
    `;
    this.chevron = document.createElement("span");
    this.chevron.textContent = "▾";
    this.chevron.style.cssText = `margin-left:auto; font:12px ${FONT.body}; color:${THEME.muted};`;
    header.append(title, this.pip, this.chevron);
    header.addEventListener("click", () => this.toggleCollapsed());

    // body: message list + input row
    this.bodyWrap = document.createElement("div");
    this.bodyWrap.style.cssText = "display:flex; flex-direction:column;";

    this.list = document.createElement("div");
    this.list.style.cssText = `
      height:220px; overflow-y:auto; padding:10px 12px;
      display:flex; flex-direction:column; gap:6px;
    `;

    const inputRow = document.createElement("div");
    inputRow.style.cssText = `display:flex; gap:8px; padding:10px 12px; border-top:1px solid rgba(184,137,58,0.25);`;
    this.input = textInput("Message your party…");
    this.input.maxLength = CHAT_MAX_LEN;
    this.input.style.flex = "1";
    this.input.style.padding = "8px 11px";
    this.input.style.font = `13px ${FONT.body}`;
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.sendCurrent();
    });
    const send = btn("Send", "secondary");
    send.style.padding = "8px 14px";
    send.style.fontSize = "13px";
    send.addEventListener("click", () => this.sendCurrent());
    inputRow.append(this.input, send);

    this.bodyWrap.append(this.list, inputRow);
    this.container.append(header, this.bodyWrap);
    document.body.appendChild(this.container);

    this.seat.subscribe(() => this.updateVisibility());
    this.chat.subscribe(() => this.renderList());
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const phase = this.seat.room?.phase;
    const visible = phase === "lobby" || phase === "overworld";
    this.container.style.display = visible ? "flex" : "none";
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.bodyWrap.style.display = this.collapsed ? "none" : "flex";
    this.chevron.textContent = this.collapsed ? "▸" : "▾";
    if (!this.collapsed) {
      this.seenCount = this.chat.entries.length;
      this.pip.style.display = "none";
      this.list.scrollTop = this.list.scrollHeight;
    }
  }

  private sendCurrent(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.conn.send({ type: "chatSend", text });
    this.input.value = "";
  }

  private renderList(): void {
    const pinned = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 24;
    this.list.innerHTML = "";
    for (const entry of this.chat.entries) {
      const row = document.createElement("div");
      row.style.cssText = `font:13px/1.45 ${FONT.body}; color:${THEME.parch}; overflow-wrap:break-word;`;
      const sender = document.createElement("span");
      sender.textContent = entry.displayName;
      sender.style.cssText = `font-weight:600; color:${THEME.gold}; margin-right:6px;`;
      const text = document.createElement("span");
      text.textContent = entry.text;
      row.append(sender, text);
      this.list.appendChild(row);
    }
    if (pinned) this.list.scrollTop = this.list.scrollHeight;

    const count = this.chat.entries.length;
    if (count < this.seenCount) this.seenCount = count; // cleared/replaced shorter
    if (this.collapsed) this.pip.style.display = count > this.seenCount ? "inline-block" : "none";
    else this.seenCount = count;
  }
}
