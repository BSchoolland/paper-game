import type { ServerMessage } from "shared";
import { contractById } from "shared";
import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import { assetUrl } from "../renderer/asset-url.js";
import { THEME, FONT, boardBackdrop, panelCard, rule, btn, eyebrow, heading } from "./ui-kit.js";

export type XpBankedMsg = Extract<ServerMessage, { type: "xpBanked" }>;
export type CodexBankedMsg = Extract<ServerMessage, { type: "codexBanked" }>;

/**
 * The shared run-end state (RoomPhase "gameover") shown to ALL players, in three outcome
 * variants driven by `roomState.outcome` (victory / retreat / defeat — reconnects get the right
 * variant from the same field). "Play again" (any player may trigger it — host is re-chosen
 * server-side) starts a fresh run on the same room; "Return home" leaves the room. The banked-XP
 * line reads main.ts's held `xpBanked` push and is omitted when none arrived (reconnect).
 */
export class GameOverScreen implements Screen {
  private container: HTMLDivElement;

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private getLastBank: () => XpBankedMsg | null,
    private getLastCodexBank: () => CodexBankedMsg | null,
  ) {
    this.container = document.createElement("div");
    this.container.id = "game-over-screen";
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 95;
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
    this.render();
    this.container.style.display = "flex";
  }

  exit() {
    this.container.style.display = "none";
  }

  private render() {
    const outcome = this.seat.room?.outcome ?? "defeat";
    const contract = this.seat.room?.contract ?? null;

    this.container.innerHTML = "";
    this.container.appendChild(boardBackdrop(outcome === "victory" ? "victory" : "gameover"));

    const card = panelCard();
    card.style.width = "620px";
    card.style.maxWidth = "94vw";
    card.style.padding = "44px 56px 40px";
    card.style.alignItems = "center";
    card.style.textAlign = "center";
    card.style.display = "flex";
    card.style.flexDirection = "column";

    card.appendChild(this.heroStage(outcome === "victory" ? "victory" : outcome === "retreat" ? "retreat" : "defeat"));

    if (outcome === "victory") {
      card.appendChild(eyebrow("Victory"));
      card.appendChild(this.title("Contract Fulfilled"));
      card.appendChild(
        this.copy(
          `The ${contractById(contract!.type).name} contract is fulfilled. Your deeds — and your designs — are entered into the codex.`,
        ),
      );
      card.appendChild(this.contractLine(`✓ ${contractById(contract!.type).name}`, THEME.green));
    } else if (outcome === "retreat") {
      card.appendChild(eyebrow("Withdrawal"));
      card.appendChild(this.title("The Party Withdraws"));
      card.appendChild(this.copy("You slip back through the gateway. Half a victory is still a march home."));
      if (contract) {
        card.appendChild(this.contractLine(`✗ ${contractById(contract.type).name} — forfeit`, THEME.danger));
      }
    } else {
      card.appendChild(eyebrow("Defeat"));
      card.appendChild(this.title("Your Warband Has Fallen"));
      card.appendChild(
        this.copy(
          "The great ruins claim another party. Your deeds will be remembered in song — rally again, and carve a different ending.",
        ),
      );
    }

    const bank = this.getLastBank();
    // The codex line only accompanies banking outcomes (a codexBanked push is only ever sent for
    // victory/retreat, and only when the run had drops — its absence means "omit entirely").
    const codexBank = outcome === "victory" || outcome === "retreat" ? this.getLastCodexBank() : null;
    if (bank) {
      const line = document.createElement("div");
      line.textContent =
        (outcome === "victory" ? `Banked ${bank.banked} XP` : `Banked ${bank.banked} of ${bank.pending} pending XP`) +
        (bank.leveledUp ? " — Level up!" : "");
      line.style.cssText = `font:14px ${FONT.body}; color:${THEME.gold}; margin-bottom:${codexBank ? "8px" : "24px"};`;
      card.appendChild(line);
    }
    if (codexBank) card.appendChild(this.codexLine(codexBank));

    card.appendChild(rule("70%"));

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex; gap:14px; justify-content:center; margin-top:26px;";

    const again = btn("Play Again", "primary");
    again.style.minWidth = "180px";
    again.addEventListener("click", () => this.conn.send({ type: "playAgain" }));
    actions.appendChild(again);

    // Leave -> the server frees the seat and replies `leftRoom`, which routes this client HOME.
    const home = btn("Return Home", "secondary");
    home.style.minWidth = "180px";
    home.addEventListener("click", () => this.conn.send({ type: "leaveRoom" }));
    actions.appendChild(home);

    card.appendChild(actions);
    this.container.appendChild(card);
  }

  private title(text: string): HTMLDivElement {
    const title = heading(text, "hero");
    title.style.fontSize = "44px";
    title.style.marginTop = "10px";
    return title;
  }

  private copy(text: string): HTMLParagraphElement {
    const sub = document.createElement("p");
    sub.textContent = text;
    sub.style.cssText = `margin:18px auto 22px; max-width:440px; font:15.5px/1.6 ${FONT.body}; color:${THEME.muted};`;
    return sub;
  }

  /** What this settle put in the codex (03-loot-codex §6.6): new designs · world-firsts /
   *  already-known copy / the unplaced-dimension skip warning. */
  private codexLine(bank: CodexBankedMsg): HTMLDivElement {
    const line = document.createElement("div");
    line.style.cssText = `font:14px ${FONT.body}; margin-bottom:24px;`;

    if (bank.entries.length > 0) {
      const banked = document.createElement("span");
      banked.textContent = `${bank.entries.length} design(s) entered into the codex`;
      banked.style.color = THEME.gold;
      line.appendChild(banked);
      if (bank.firstItemIds.length > 0) {
        const firsts = document.createElement("span");
        firsts.textContent = ` · ${bank.firstItemIds.length} world-first(s)`;
        firsts.style.color = THEME.parchHi;
        line.appendChild(firsts);
      }
    } else if (bank.skippedUntiered === 0) {
      const known = document.createElement("span");
      known.textContent = "No new designs — the codex already knows these.";
      known.style.color = THEME.muted;
      line.appendChild(known);
    }

    if (bank.skippedUntiered > 0) {
      const skipped = document.createElement("span");
      skipped.textContent =
        `${line.childNodes.length > 0 ? " · " : ""}${bank.skippedUntiered} design(s) not banked — unplaced dimension`;
      skipped.style.color = THEME.danger;
      line.appendChild(skipped);
    }
    return line;
  }

  private contractLine(text: string, color: string): HTMLDivElement {
    const line = document.createElement("div");
    line.textContent = text;
    line.style.cssText = `font:14px ${FONT.body}; color:${color}; margin-bottom:8px;`;
    return line;
  }

  /** The hero silhouette above the title: gold-lit for victory, dimmed for retreat, ember-lit fallen for defeat. */
  private heroStage(variant: "victory" | "retreat" | "defeat"): HTMLDivElement {
    const stage = document.createElement("div");
    stage.style.cssText =
      "position:relative; width:260px; height:200px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:6px;";

    const ember = document.createElement("div");
    ember.style.cssText = `
      position:absolute; bottom:6px; left:50%; transform:translateX(-50%);
      width:190px; height:40px; border-radius:50%; filter:blur(5px);
      background:${
        variant === "victory"
          ? "radial-gradient(ellipse, rgba(232,200,122,0.4), rgba(184,137,58,0.15) 55%, transparent 75%)"
          : "radial-gradient(ellipse, rgba(199,90,74,0.55), rgba(139,58,58,0.15) 55%, transparent 75%)"
      };
    `;
    stage.appendChild(ember);

    const filter =
      variant === "victory"
        ? "drop-shadow(0 0 22px rgba(232,200,122,0.45)) drop-shadow(0 14px 24px rgba(0,0,0,0.85))"
        : variant === "retreat"
          ? `grayscale(0.5) brightness(0.75)
        drop-shadow(0 0 18px rgba(199,90,74,0.35)) drop-shadow(0 14px 24px rgba(0,0,0,0.85))`
          : `grayscale(0.85) brightness(0.5) contrast(1.05)
        drop-shadow(0 0 18px rgba(199,90,74,0.35)) drop-shadow(0 14px 24px rgba(0,0,0,0.85))`;

    const hero = document.createElement("img");
    hero.src = assetUrl("/sprites/char1/sword-idle.webp");
    hero.style.cssText = `
      position:relative; max-height:200px; transform:scale(1.22); transform-origin:bottom center;
      object-fit:contain;
      filter:${filter};
    `;
    stage.appendChild(hero);
    return stage;
  }
}
