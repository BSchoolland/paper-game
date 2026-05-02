import { Application } from "pixi.js";
import { GameLoop } from "./game-loop.js";

async function init() {
  const app = new Application();
  await app.init({
    background: "#2a2a3e",
    resizeTo: window,
    antialias: true,
  });

  const container = document.getElementById("game-container")!;
  container.appendChild(app.canvas);

  const game = new GameLoop(app);
  game.init();
}

init();
