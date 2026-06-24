import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import { panelCard, btn } from "./ui-kit.js";

/**
 * The shared Game Over end state (RoomPhase "gameover", reached on a party wipe). Shown to ALL
 * players. "Play again" (any player may trigger it — host is re-chosen server-side) starts a fresh
 * run on the same room; "Return to home" leaves the room. main.ts routes here on the gameover phase.
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
      font-family: monospace;
      color: #4a3728;
      background: rgba(20, 12, 10, 0.7);
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
    const card = panelCard();
    card.style.alignItems = "stretch";
    card.style.textAlign = "center";

    const heading = document.createElement("div");
    heading.style.cssText = "font-size:26px; font-weight:bold; color:#8b3a3a;";
    heading.textContent = "Your party has fallen";
    card.appendChild(heading);

    const sub = document.createElement("div");
    sub.style.cssText = "font-size:13px; color:#6b5b4a; margin-bottom:4px;";
    sub.textContent = "The expedition is over. Begin a new one, or head home.";
    card.appendChild(sub);

    const again = btn("Play again", true);
    again.addEventListener("click", () => this.conn.send({ type: "playAgain" }));
    card.appendChild(again);

    // Leave -> the server frees the seat and replies `leftRoom`, which routes this client HOME.
    const home = btn("Return to home");
    home.addEventListener("click", () => this.conn.send({ type: "leaveRoom" }));
    card.appendChild(home);

    this.container.appendChild(card);
  }
}
