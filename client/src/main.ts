import { Application } from "pixi.js";
import { createInitialGameState } from "shared";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { InputManager } from "./input/input-manager.js";
import { Hud } from "./ui/hud.js";

async function init() {
  const app = new Application();
  await app.init({
    background: "#2a2a3e",
    resizeTo: window,
    antialias: true,
  });

  const container = document.getElementById("game-container")!;
  container.appendChild(app.canvas);

  const clientState = new ClientState(createInitialGameState());
  const renderer = new GameRenderer(app, clientState);
  const hud = new Hud(container, clientState);
  const input = new InputManager(app.canvas, clientState, () => {
    renderer.renderOverlay(input.mouseWorld);
    hud.update();
  });

  renderer.init();
  hud.update();

  clientState.subscribe(() => {
    renderer.render();
    hud.update();
  });
}

init();
