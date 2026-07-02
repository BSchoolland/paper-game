import type { FriendEntry, FriendRequestEntry } from "shared";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import type { AccountStore } from "../state/account-store.js";
import type { AuthMode } from "./auth-modal.js";
import { THEME, FONT, btn, textInput, errorNote, heading, rule, levelChip, titleTag } from "./ui-kit.js";

/**
 * The friends rail: add-by-username, incoming/outgoing requests, and the friend list with
 * presence dots and a contextual Join (friend in a joinable lobby) / Invite (own lobby has
 * an open seat) action. The add row lives OUTSIDE the repopulated list node (browserList
 * discipline) so a `friendsList` push never blurs the input. Guests see a claim prompt.
 * Instantiable more than once (HOME rail + the floating lobby dock).
 */
export class FriendsPanel {
  readonly root: HTMLDivElement;
  private body: HTMLDivElement;
  private list: HTMLDivElement;
  private addInput: HTMLInputElement;
  private errorSlot: HTMLDivElement;
  private mode: "none" | "guest" | "claimed" = "none";
  private built = false;
  private awaitingRequest = false;

  constructor(
    private conn: RoomConnection,
    private account: AccountStore,
    private seat: SeatContext,
    private openAuth: (mode: AuthMode) => void,
    opts?: { showHeading?: boolean },
  ) {
    this.root = document.createElement("div");
    this.root.style.cssText = "display:flex; flex-direction:column; gap:10px; min-height:0;";

    if (opts?.showHeading ?? true) {
      const head = heading("Friends", "section");
      this.root.appendChild(head);
      this.root.appendChild(rule());
    }

    this.body = document.createElement("div");
    this.body.style.cssText = "display:flex; flex-direction:column; gap:10px; min-height:0;";
    this.root.appendChild(this.body);

    this.errorSlot = document.createElement("div");
    this.errorSlot.style.display = "none";
    this.addInput = textInput("Add by username");
    this.addInput.maxLength = 20;
    this.list = document.createElement("div");
    this.list.style.cssText = "display:flex; flex-direction:column; gap:8px; overflow-y:auto; max-height:260px; min-height:0;";

    this.account.subscribe(() => this.render());
    this.seat.subscribe(() => {
      // Join/Invite availability depends on room phase and open seats.
      if (this.mode === "claimed") this.populateList();
    });
    this.conn.on("friendsList", () => {
      if (this.awaitingRequest) {
        this.awaitingRequest = false;
        this.addInput.value = "";
        this.clearError();
      }
    });
    this.conn.on("error", (msg) => {
      const friendCodes = msg.code === "NO_SUCH_USER" || msg.code === "CLAIM_REQUIRED";
      const requestCodes = msg.code === "INVALID_INPUT" || msg.code === "RATE_LIMITED";
      if (friendCodes || (this.awaitingRequest && requestCodes)) {
        this.awaitingRequest = false;
        this.showError(msg.message);
      }
    });

    this.render();
  }

  private render(): void {
    const auth = this.account.auth;
    const mode = auth === null ? "none" : auth.isGuest ? "guest" : "claimed";
    if (mode !== this.mode || !this.built) {
      this.mode = mode;
      this.built = true;
      this.buildBody();
    }
    if (mode === "claimed") this.populateList();
  }

  /** Rebuilt only when the auth mode flips — keeps the add input stable across pushes. */
  private buildBody(): void {
    this.body.innerHTML = "";
    this.clearError();

    if (this.mode === "none") {
      const wait = document.createElement("div");
      wait.textContent = "Connecting…";
      wait.style.cssText = `font:13px ${FONT.body}; color:${THEME.faint};`;
      this.body.appendChild(wait);
      return;
    }

    if (this.mode === "guest") {
      const note = document.createElement("div");
      note.textContent = "Claim your account to add friends.";
      note.style.cssText = `font:13px/1.5 ${FONT.body}; color:${THEME.muted};`;
      const claim = btn("Claim Account", "primary");
      claim.style.padding = "9px 18px";
      claim.style.fontSize = "13px";
      claim.style.alignSelf = "flex-start";
      claim.addEventListener("click", () => this.openAuth("claim"));
      this.body.append(note, claim);
      return;
    }

    const addRow = document.createElement("div");
    addRow.style.cssText = "display:flex; gap:8px;";
    this.addInput.style.flex = "1";
    this.addInput.style.padding = "8px 11px";
    this.addInput.style.font = `13px ${FONT.body}`;
    const add = btn("Add", "secondary");
    add.style.padding = "8px 14px";
    add.style.fontSize = "13px";
    const doAdd = () => {
      const username = this.addInput.value.trim();
      if (!username) return;
      this.clearError();
      this.awaitingRequest = true;
      this.conn.send({ type: "friendRequest", username });
    };
    add.addEventListener("click", doAdd);
    this.addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doAdd();
    });
    addRow.append(this.addInput, add);

    this.body.append(addRow, this.errorSlot, this.list);
    this.populateList();
  }

  /** Repopulated in place: incoming requests pinned on top, then friends, then outgoing. */
  private populateList(): void {
    const friends = this.account.friends;
    this.list.innerHTML = "";

    if (!friends || (friends.friends.length === 0 && friends.incoming.length === 0 && friends.outgoing.length === 0)) {
      const empty = document.createElement("div");
      empty.textContent = "No friends yet — add one by username.";
      empty.style.cssText = `
        padding:14px; text-align:center; border-radius:9px;
        border:1px dashed ${THEME.goldLine}; font:12.5px ${FONT.body}; color:${THEME.faint};
      `;
      this.list.appendChild(empty);
      return;
    }

    for (const req of friends.incoming) this.list.appendChild(this.incomingRow(req));
    for (const f of friends.friends) this.list.appendChild(this.friendRow(f));
    for (const req of friends.outgoing) this.list.appendChild(this.outgoingRow(req));
  }

  private rowShell(): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = `
      display:flex; align-items:center; gap:9px; padding:9px 11px; border-radius:9px;
      background:linear-gradient(150deg, rgba(40,30,20,0.5), rgba(18,13,8,0.6));
      border:1px solid rgba(184,137,58,0.28);
    `;
    return row;
  }

  private presenceDot(online: boolean): HTMLDivElement {
    const dot = document.createElement("div");
    dot.style.cssText = `
      width:9px; height:9px; border-radius:50%; box-sizing:border-box; flex:0 0 auto;
      ${online
        ? `background:${THEME.green}; box-shadow:0 0 6px rgba(123,176,74,0.6);`
        : `background:transparent; border:1px solid ${THEME.faint};`}
    `;
    return dot;
  }

  private nameBlock(displayName: string, level: number, equippedTitleId: string | null): HTMLDivElement {
    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";
    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex; align-items:center; gap:7px;";
    const name = document.createElement("div");
    name.textContent = displayName;
    name.style.cssText = `font:600 14px ${FONT.body}; color:${THEME.parch}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
    nameRow.append(name, levelChip(level));
    info.appendChild(nameRow);
    if (equippedTitleId) {
      const tag = titleTag(equippedTitleId);
      tag.style.marginTop = "2px";
      info.appendChild(tag);
    }
    return info;
  }

  private smallBtn(label: string, variant: "primary" | "secondary" | "danger", onClick: () => void): HTMLButtonElement {
    const b = btn(label, variant);
    b.style.padding = "6px 12px";
    b.style.fontSize = "12px";
    b.addEventListener("click", onClick);
    return b;
  }

  private friendRow(f: FriendEntry): HTMLDivElement {
    const row = this.rowShell();
    row.appendChild(this.presenceDot(f.online));
    row.appendChild(this.nameBlock(f.displayName, f.level, f.equippedTitleId));

    const room = this.seat.room;
    const canInvite =
      room !== null && room.phase === "lobby" && room.seats.some((s) => s.state === "open") && f.online;
    if (canInvite) {
      row.appendChild(this.smallBtn("Invite", "primary", () => this.conn.send({ type: "friendInvite", accountId: f.accountId })));
    } else if (room === null && f.roomCode !== null) {
      const code = f.roomCode;
      row.appendChild(this.smallBtn("Join", "secondary", () => this.conn.send({ type: "joinRoom", code })));
    }

    const remove = document.createElement("button");
    remove.tabIndex = -1;
    remove.textContent = "✕";
    remove.title = "Remove friend";
    remove.style.cssText = `flex:0 0 auto; background:none; border:none; cursor:pointer; font:12px ${FONT.body}; color:${THEME.faint}; padding:2px 4px;`;
    remove.addEventListener("mouseenter", () => (remove.style.color = THEME.danger));
    remove.addEventListener("mouseleave", () => (remove.style.color = THEME.faint));
    remove.addEventListener("click", () => this.conn.send({ type: "friendRemove", accountId: f.accountId }));
    row.appendChild(remove);
    return row;
  }

  private incomingRow(req: FriendRequestEntry): HTMLDivElement {
    const row = this.rowShell();
    row.style.borderColor = THEME.goldLine;
    row.appendChild(this.nameBlock(req.displayName, req.level, null));
    row.appendChild(this.smallBtn("Accept", "primary", () => this.conn.send({ type: "friendAccept", accountId: req.accountId })));
    row.appendChild(this.smallBtn("Decline", "danger", () => this.conn.send({ type: "friendDecline", accountId: req.accountId })));
    return row;
  }

  private outgoingRow(req: FriendRequestEntry): HTMLDivElement {
    const row = this.rowShell();
    row.style.opacity = "0.75";
    row.appendChild(this.nameBlock(req.displayName, req.level, null));
    const pending = document.createElement("div");
    pending.textContent = "pending";
    pending.style.cssText = `flex:0 0 auto; font:600 11px ${FONT.body}; letter-spacing:0.06em; color:${THEME.faint};`;
    row.appendChild(pending);
    row.appendChild(this.smallBtn("Cancel", "secondary", () => this.conn.send({ type: "friendDecline", accountId: req.accountId })));
    return row;
  }

  private showError(message: string): void {
    this.errorSlot.innerHTML = "";
    this.errorSlot.appendChild(errorNote(message));
    this.errorSlot.style.display = "";
  }

  private clearError(): void {
    this.errorSlot.innerHTML = "";
    this.errorSlot.style.display = "none";
  }
}

/**
 * Floating friends dock for the staging lobby (the invite-from-a-lobby journey): like
 * ChatPanel it is constructed once in main.ts and lives outside every screen's DOM, so
 * LobbyScreen's full-innerHTML re-renders never touch it. Visible only in the lobby phase
 * (HOME has its own inline FriendsPanel in the right rail).
 */
export class FriendsDock {
  private container: HTMLDivElement;
  private body: HTMLDivElement;
  private chevron: HTMLSpanElement;
  private collapsed = false;

  constructor(conn: RoomConnection, account: AccountStore, seat: SeatContext, openAuth: (mode: AuthMode) => void) {
    this.container = document.createElement("div");
    this.container.id = "friends-dock";
    this.container.style.cssText = `
      position:fixed; right:16px; top:16px; z-index:110;
      display:none; flex-direction:column; width:312px; max-height:70vh; overflow:hidden;
      background:rgba(17,13,9,0.88); border:1px solid ${THEME.goldLine}; border-radius:10px;
      box-shadow:0 10px 30px -10px rgba(0,0,0,0.7);
      backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
      font-family:${FONT.body}; color:${THEME.parch};
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      display:flex; align-items:center; gap:8px; padding:10px 14px; cursor:pointer; user-select:none;
      border-bottom:1px solid rgba(184,137,58,0.25);
    `;
    const title = document.createElement("span");
    title.textContent = "Friends";
    title.style.cssText = `font:600 14px ${FONT.cinzel}; letter-spacing:0.06em; color:${THEME.gold};`;
    this.chevron = document.createElement("span");
    this.chevron.textContent = "▾";
    this.chevron.style.cssText = `margin-left:auto; font:12px ${FONT.body}; color:${THEME.muted};`;
    header.append(title, this.chevron);
    header.addEventListener("click", () => this.toggleCollapsed());

    this.body = document.createElement("div");
    this.body.style.cssText = "display:flex; flex-direction:column; padding:12px; min-height:0; overflow-y:auto;";
    const panel = new FriendsPanel(conn, account, seat, openAuth, { showHeading: false });
    this.body.appendChild(panel.root);

    this.container.append(header, this.body);
    document.body.appendChild(this.container);

    seat.subscribe(() => {
      this.container.style.display = seat.room?.phase === "lobby" ? "flex" : "none";
    });
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.body.style.display = this.collapsed ? "none" : "flex";
    this.chevron.textContent = this.collapsed ? "▸" : "▾";
  }
}
