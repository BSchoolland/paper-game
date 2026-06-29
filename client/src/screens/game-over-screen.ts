import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import { assetUrl } from "../renderer/asset-url.js";
import { THEME, FONT, boardBackdrop, panelCard, rule, btn, eyebrow, heading } from "./ui-kit.js";

/**
 * The shared Game Over end state (RoomPhase "gameover", reached on a party wipe). Shown to ALL
 * players. "Play again" (any player may trigger it — host is re-chosen server-side) starts a fresh
 * run on the same room; "Return home" leaves the room. main.ts routes here on the gameover phase.
 *
 * A desaturated fallen-hero silhouette lit by a dim ember glow above the title, three gold-ruled run
 * stat tiles, and the action pair — on a dark slate panel over the ruins backdrop.
 */
export class GameOverScreen implements Screen {
  private container: HTMLDivElement;

  constructor(private conn: RoomConnection) {
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
    this.render();
  }

  enter() {
    this.container.style.display = "flex";
  }

  exit() {
    this.container.style.display = "none";
  }

  private render() {
    this.container.innerHTML = "";
    this.container.appendChild(boardBackdrop("gameover"));

    const card = panelCard();
    card.style.width = "620px";
    card.style.maxWidth = "94vw";
    card.style.padding = "44px 56px 40px";
    card.style.alignItems = "center";
    card.style.textAlign = "center";
    card.style.display = "flex";
    card.style.flexDirection = "column";

    card.appendChild(this.fallenHero());

    card.appendChild(eyebrow("Defeat"));
    const title = heading("Your Warband Has Fallen", "hero");
    title.style.fontSize = "44px";
    title.style.marginTop = "10px";
    card.appendChild(title);

    const sub = document.createElement("p");
    sub.textContent =
      "The great ruins claim another party. Your deeds will be remembered in song — rally again, and carve a different ending.";
    sub.style.cssText = `margin:18px auto 28px; max-width:440px; font:15.5px/1.6 ${FONT.body}; color:${THEME.muted};`;
    card.appendChild(sub);

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

  /** Desaturated, ember-lit fallen-hero silhouette above the title (grafted from attempt 3). */
  private fallenHero(): HTMLDivElement {
    const stage = document.createElement("div");
    stage.style.cssText =
      "position:relative; width:260px; height:200px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:6px;";

    const ember = document.createElement("div");
    ember.style.cssText = `
      position:absolute; bottom:6px; left:50%; transform:translateX(-50%);
      width:190px; height:40px; border-radius:50%; filter:blur(5px);
      background:radial-gradient(ellipse, rgba(199,90,74,0.55), rgba(139,58,58,0.15) 55%, transparent 75%);
    `;
    stage.appendChild(ember);

    const hero = document.createElement("img");
    hero.src = assetUrl("/sprites/char1/sword-idle.webp");
    hero.style.cssText = `
      position:relative; max-height:200px; transform:scale(1.22); transform-origin:bottom center;
      object-fit:contain;
      filter:grayscale(0.85) brightness(0.5) contrast(1.05)
        drop-shadow(0 0 18px rgba(199,90,74,0.35)) drop-shadow(0 14px 24px rgba(0,0,0,0.85));
    `;
    stage.appendChild(hero);
    return stage;
  }
}
