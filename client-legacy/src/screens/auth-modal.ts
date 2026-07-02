import type { ErrorCode } from "shared";
import type { RoomConnection } from "../net/connection.js";
import { THEME, FONT, panelCard, eyebrow, btn, textInput, errorNote } from "./ui-kit.js";

export type AuthMode = "claim" | "login" | "register";

/** Auth failures the modal owns while open (main.ts suppresses its generic toast for these). */
export const AUTH_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "USERNAME_TAKEN",
  "INVALID_CREDENTIALS",
  "INVALID_INPUT",
  "RATE_LIMITED",
  "AUTH_IN_ROOM",
  "NOT_A_GUEST",
]);

const COPY: Record<AuthMode, { blurb: string; submit: string }> = {
  claim: { blurb: "Keep this account's progress — choose a username and password.", submit: "Claim Account" },
  login: { blurb: "Sign in to a claimed account on this device.", submit: "Log In" },
  register: { blurb: "Create a brand-new named account (your current guest stays behind).", submit: "Create Account" },
};

/**
 * Self-managed account overlay (NOT a ScreenManager overlay — that single slot belongs to
 * combat/inventory): a fixed scrim over a 420px panelCard with Claim / Log in tabs
 * (Register reachable from Log in). Dismissable — the guest identity stays intact
 * underneath. Closes itself on Escape, scrim click, or any `authState` (success).
 */
export class AuthModal {
  private scrim: HTMLDivElement;
  private tabClaim: HTMLButtonElement;
  private tabLogin: HTMLButtonElement;
  private blurb: HTMLDivElement;
  private username: HTMLInputElement;
  private password: HTMLInputElement;
  private email: HTMLInputElement;
  private errorSlot: HTMLDivElement;
  private submit: HTMLButtonElement;
  private switchLink: HTMLButtonElement;
  private mode: AuthMode = "claim";
  private _open = false;
  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  constructor(private conn: RoomConnection) {
    this.scrim = document.createElement("div");
    this.scrim.id = "auth-modal";
    this.scrim.style.cssText = `
      position:fixed; inset:0; z-index:120; display:none;
      align-items:center; justify-content:center;
      background:rgba(7,5,3,0.72); font-family:${FONT.body}; color:${THEME.parch};
    `;
    this.scrim.addEventListener("click", (e) => {
      if (e.target === this.scrim) this.close();
    });

    const card = panelCard();
    card.style.width = "420px";
    card.style.maxWidth = "92vw";

    const inner = document.createElement("div");
    inner.style.cssText = `position:relative; display:flex; flex-direction:column; gap:${THEME.gap};`;

    inner.appendChild(eyebrow("Account"));

    // mode tabs
    const tabs = document.createElement("div");
    tabs.style.cssText = `display:flex; border:1px solid ${THEME.goldLine}; border-radius:8px; overflow:hidden; background:rgba(11,9,6,0.4);`;
    this.tabClaim = this.tab("Claim", () => this.setMode("claim"));
    this.tabClaim.style.borderRight = `1px solid ${THEME.goldLine}`;
    this.tabLogin = this.tab("Log In", () => this.setMode("login"));
    tabs.append(this.tabClaim, this.tabLogin);
    inner.appendChild(tabs);

    this.blurb = document.createElement("div");
    this.blurb.style.cssText = `font:13px/1.5 ${FONT.body}; color:${THEME.muted};`;
    inner.appendChild(this.blurb);

    this.username = textInput("Username");
    this.username.maxLength = 20;
    this.username.autocomplete = "username";
    this.password = textInput("Password");
    this.password.type = "password";
    this.password.maxLength = 128;
    this.email = textInput("Email (optional, for recovery)");
    this.email.autocomplete = "email";
    for (const input of [this.username, this.password, this.email]) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submitCurrent();
      });
      inner.appendChild(input);
    }

    this.errorSlot = document.createElement("div");
    this.errorSlot.style.display = "none";
    inner.appendChild(this.errorSlot);

    this.submit = btn("Claim Account", "primary");
    this.submit.style.width = "100%";
    this.submit.addEventListener("click", () => this.submitCurrent());
    inner.appendChild(this.submit);

    this.switchLink = document.createElement("button");
    this.switchLink.tabIndex = -1;
    this.switchLink.style.cssText = `
      align-self:center; background:none; border:none; cursor:pointer;
      font:600 12px ${FONT.body}; letter-spacing:0.04em; color:${THEME.goldDeep};
    `;
    this.switchLink.addEventListener("click", () => this.setMode(this.mode === "register" ? "login" : "register"));
    inner.appendChild(this.switchLink);

    card.appendChild(inner);
    this.scrim.appendChild(card);
    document.body.appendChild(this.scrim);

    this.conn.on("authState", () => {
      if (this._open) this.close();
    });
    this.conn.on("error", (msg) => {
      if (this._open && AUTH_ERROR_CODES.has(msg.code)) this.showError(msg.message);
    });
  }

  isOpen(): boolean {
    return this._open;
  }

  open(mode: AuthMode): void {
    this.username.value = "";
    this.password.value = "";
    this.email.value = "";
    this._open = true;
    this.scrim.style.display = "flex";
    document.addEventListener("keydown", this.onKeydown);
    this.setMode(mode);
    this.username.focus();
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this.scrim.style.display = "none";
    document.removeEventListener("keydown", this.onKeydown);
  }

  private tab(label: string, onClick: () => void): HTMLButtonElement {
    const t = document.createElement("button");
    t.tabIndex = -1;
    t.textContent = label;
    t.style.cssText = `
      flex:1; cursor:pointer; border:none; background:transparent;
      padding:10px 6px; font:700 14px ${FONT.cinzel}; letter-spacing:0.08em;
      transition:background .12s;
    `;
    t.addEventListener("click", onClick);
    return t;
  }

  private setMode(mode: AuthMode): void {
    this.mode = mode;
    this.clearError();

    const skin = (t: HTMLButtonElement, on: boolean) => {
      t.style.background = on ? "linear-gradient(180deg, rgba(184,137,58,0.35), rgba(184,137,58,0.15))" : "transparent";
      t.style.color = on ? THEME.gold : THEME.muted;
    };
    skin(this.tabClaim, mode === "claim");
    skin(this.tabLogin, mode !== "claim"); // register lives under the Log In tab

    this.blurb.textContent = COPY[mode].blurb;
    this.submit.textContent = COPY[mode].submit;
    this.email.style.display = mode === "login" ? "none" : "";
    this.password.autocomplete = mode === "login" ? "current-password" : "new-password";

    this.switchLink.style.display = mode === "claim" ? "none" : "";
    this.switchLink.textContent =
      mode === "login" ? "New here? Create a fresh account" : "Have an account? Log in instead";
  }

  private submitCurrent(): void {
    this.clearError();
    const username = this.username.value.trim();
    const password = this.password.value;
    if (this.mode === "login") {
      this.conn.send({ type: "login", username, password });
      return;
    }
    const email = this.email.value.trim();
    this.conn.send({
      type: this.mode === "claim" ? "claimAccount" : "register",
      username,
      password,
      email: email === "" ? undefined : email,
    });
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
