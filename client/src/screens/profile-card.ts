import { titleById, xpToReachLevel } from "shared";
import type { RoomConnection } from "../net/connection.js";
import type { AccountStore } from "../state/account-store.js";
import type { AuthMode } from "./auth-modal.js";
import { assetUrl } from "../renderer/asset-url.js";
import { THEME, FONT, btn, textInput, levelChip, titleTag, xpBar } from "./ui-kit.js";

/**
 * The HOME profile card: identity (avatar, click-to-rename display name, level, title),
 * XP progress from the shared curve, lifetime stats, and either claim/log-in (guest) or
 * @username/log-out (claimed). Built once by HomeScreen and re-rendered in place on every
 * AccountStore notify; a rename-in-progress defers the re-render so the input never blurs.
 */
export class ProfileCard {
  readonly root: HTMLDivElement;
  private editingName = false;
  private titlesOpen = false;
  private onOutsideClick = (e: MouseEvent): void => {
    if (!this.root.contains(e.target as Node)) this.closeTitles();
  };

  constructor(
    private conn: RoomConnection,
    private account: AccountStore,
    private openAuth: (mode: AuthMode) => void,
  ) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position:relative; box-sizing:border-box; display:flex; flex-direction:column; gap:12px;
      padding:16px 18px; border-radius:12px;
      background:linear-gradient(180deg, rgba(58,47,37,0.5), rgba(17,13,9,0.6));
      border:1px solid ${THEME.goldLine};
    `;
    this.account.subscribe(() => {
      if (!this.editingName) this.render();
    });
    this.render();
  }

  private render(): void {
    const profile = this.account.profile;
    const auth = this.account.auth;
    this.root.innerHTML = "";

    if (!profile || !auth) {
      const wait = document.createElement("div");
      wait.textContent = "Connecting…";
      wait.style.cssText = `font:13px ${FONT.body}; color:${THEME.faint};`;
      this.root.appendChild(wait);
      return;
    }

    // ── identity row: avatar + name/level/title ──
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:13px;";

    const avatar = document.createElement("div");
    avatar.style.cssText = `
      width:52px; height:52px; flex:0 0 auto; border-radius:50%; box-sizing:border-box;
      border:1px solid ${THEME.goldLine};
      background:radial-gradient(circle, rgba(184,137,58,0.2), rgba(11,9,6,0.5));
      display:flex; align-items:center; justify-content:center; overflow:hidden;
    `;
    const tok = document.createElement("img");
    tok.src = assetUrl("/sprites/player/blue-player-idle.webp");
    tok.style.cssText = "width:60px; height:60px; object-fit:contain; transform:translateY(4px);";
    avatar.appendChild(tok);
    row.appendChild(avatar);

    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";

    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex; align-items:center; gap:8px;";
    const name = document.createElement("div");
    name.textContent = profile.displayName;
    name.title = "Click to rename";
    name.style.cssText = `
      font:600 16px ${FONT.body}; color:${THEME.parch}; cursor:pointer;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    `;
    name.addEventListener("click", () => this.startNameEdit(nameRow, name, profile.displayName));
    nameRow.appendChild(name);
    nameRow.appendChild(levelChip(profile.level));
    if (profile.isGuest) {
      const guest = document.createElement("div");
      guest.textContent = "GUEST";
      guest.style.cssText = `flex:0 0 auto; font:600 10px ${FONT.body}; letter-spacing:0.12em; color:${THEME.muted}; border:1px solid ${THEME.faint}; padding:1px 6px; border-radius:5px;`;
      nameRow.appendChild(guest);
    }
    info.appendChild(nameRow);

    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex; align-items:center; gap:6px; margin-top:4px; cursor:pointer;";
    titleRow.title = "Choose a title";
    if (profile.equippedTitleId) {
      titleRow.appendChild(titleTag(profile.equippedTitleId));
    } else {
      const none = document.createElement("div");
      none.textContent = profile.titles.length > 0 ? "Choose a title…" : "No title";
      none.style.cssText = `font:italic 12px ${FONT.body}; color:${THEME.faint};`;
      titleRow.appendChild(none);
    }
    titleRow.addEventListener("click", () => this.toggleTitles());
    info.appendChild(titleRow);

    row.appendChild(info);
    this.root.appendChild(row);

    if (this.titlesOpen) this.root.appendChild(this.titlesPopover(profile.titles, profile.equippedTitleId));

    // ── XP progress ──
    const base = xpToReachLevel(profile.level);
    const span = xpToReachLevel(profile.level + 1) - base;
    const into = profile.xp - base;
    this.root.appendChild(xpBar(into / span));
    const xpLabel = document.createElement("div");
    xpLabel.textContent = `${into} / ${span} XP toward LV ${profile.level + 1}`;
    xpLabel.style.cssText = `font:11px ${FONT.body}; color:${THEME.faint}; margin-top:-6px;`;
    this.root.appendChild(xpLabel);

    // ── lifetime stats ──
    const s = profile.stats;
    const stats = document.createElement("div");
    stats.textContent = `Wins ${s.encountersWon} · Hexes ${s.hexesCharted} · Dimensions ${s.dimensionsDiscovered} · Wipes ${s.wipes}`;
    stats.style.cssText = `font:13px ${FONT.body}; color:${THEME.muted};`;
    this.root.appendChild(stats);

    // ── account actions ──
    if (profile.isGuest) {
      const claim = btn("Claim This Account", "primary");
      claim.style.width = "100%";
      claim.style.padding = "11px 20px";
      claim.style.fontSize = "14px";
      claim.addEventListener("click", () => this.openAuth("claim"));
      this.root.appendChild(claim);

      const login = document.createElement("button");
      login.tabIndex = -1;
      login.textContent = "log in instead";
      login.style.cssText = `
        align-self:center; background:none; border:none; cursor:pointer;
        font:600 11px ${FONT.body}; letter-spacing:1px; color:${THEME.muted};
      `;
      login.addEventListener("click", () => this.openAuth("login"));
      this.root.appendChild(login);
    } else {
      const foot = document.createElement("div");
      foot.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px;";
      const handle = document.createElement("div");
      handle.textContent = `@${profile.username}`;
      handle.style.cssText = `font:13px ${FONT.body}; color:${THEME.goldDeep}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
      const logout = btn("Log Out", "secondary");
      logout.style.padding = "7px 14px";
      logout.style.fontSize = "12px";
      logout.addEventListener("click", () => this.conn.send({ type: "logout" }));
      foot.append(handle, logout);
      this.root.appendChild(foot);
    }
  }

  /** Swap the name for an input; Enter commits (`setDisplayName`), Escape/blur cancels. */
  private startNameEdit(nameRow: HTMLDivElement, name: HTMLDivElement, current: string): void {
    this.editingName = true;
    const input = textInput("Display name");
    input.value = current;
    input.maxLength = 24;
    input.style.padding = "5px 9px";
    input.style.font = `600 14px ${FONT.body}`;
    input.style.flex = "1";
    nameRow.replaceChild(input, name);
    input.focus();
    input.select();

    const finish = () => {
      this.editingName = false;
      this.render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const next = input.value.trim();
        if (next && next !== current) this.conn.send({ type: "setDisplayName", name: next });
        finish();
      } else if (e.key === "Escape") {
        finish();
      }
    });
    input.addEventListener("blur", finish);
  }

  private toggleTitles(): void {
    if (this.titlesOpen) {
      this.closeTitles();
      return;
    }
    this.titlesOpen = true;
    document.addEventListener("mousedown", this.onOutsideClick);
    this.render();
  }

  private closeTitles(): void {
    if (!this.titlesOpen) return;
    this.titlesOpen = false;
    document.removeEventListener("mousedown", this.onOutsideClick);
    this.render();
  }

  /** Owned-titles picker; a row click equips (or clears) via `equipTitle`. */
  private titlesPopover(owned: readonly string[], equipped: string | null): HTMLDivElement {
    const pop = document.createElement("div");
    pop.style.cssText = `
      position:absolute; top:64px; left:14px; right:14px; z-index:5;
      display:flex; flex-direction:column; overflow:hidden;
      background:linear-gradient(180deg, ${THEME.slate2}, ${THEME.ink});
      border:1px solid ${THEME.goldLine}; border-radius:10px;
      box-shadow:0 14px 34px -10px rgba(0,0,0,0.8);
    `;

    if (owned.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No titles earned yet — win an encounter!";
      empty.style.cssText = `padding:12px 14px; font:12.5px ${FONT.body}; color:${THEME.muted};`;
      pop.appendChild(empty);
      return pop;
    }

    const option = (label: string, desc: string | null, id: string | null, isEquipped: boolean) => {
      const opt = document.createElement("button");
      opt.tabIndex = -1;
      opt.style.cssText = `
        display:flex; flex-direction:column; gap:2px; text-align:left; cursor:pointer;
        padding:9px 14px; border:none; border-bottom:1px solid rgba(184,137,58,0.18);
        background:${isEquipped ? "rgba(184,137,58,0.16)" : "transparent"};
      `;
      const top = document.createElement("div");
      top.textContent = isEquipped ? `${label} ✓` : label;
      top.style.cssText = `font:600 13px ${FONT.body}; color:${isEquipped ? THEME.gold : THEME.parch};`;
      opt.appendChild(top);
      if (desc) {
        const sub = document.createElement("div");
        sub.textContent = desc;
        sub.style.cssText = `font:11.5px ${FONT.body}; color:${THEME.faint};`;
        opt.appendChild(sub);
      }
      opt.addEventListener("mouseenter", () => (opt.style.background = "rgba(184,137,58,0.22)"));
      opt.addEventListener("mouseleave", () => (opt.style.background = isEquipped ? "rgba(184,137,58,0.16)" : "transparent"));
      opt.addEventListener("click", () => {
        this.conn.send({ type: "equipTitle", titleId: id });
        this.closeTitles();
      });
      return opt;
    };

    pop.appendChild(option("No title", null, null, equipped === null));
    for (const id of owned) {
      const def = titleById(id);
      pop.appendChild(option(def.name, def.description, id, equipped === id));
    }
    (pop.lastElementChild as HTMLElement).style.borderBottom = "none";
    return pop;
  }
}
