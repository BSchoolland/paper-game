import { Application } from "pixi.js";
import { Connection } from "./net/connection.js";
import { CombatStore } from "./state/combat-store.js";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { HexMapRenderer, loadMapIconAssets } from "./renderer/hex-map-renderer.js";
import { FramePacer } from "./renderer/frame-pacer.js";
import { InputManager } from "./input/input-manager.js";
import { loadSpriteAssets } from "./renderer/sprite-assets.js";
import { loadMapAssets } from "./renderer/grid-renderer.js";
import { ScreenManager } from "./screens/screen-manager.js";
import { MapScreen } from "./screens/map-screen.js";
import { CombatScreen } from "./screens/combat-screen.js";
import type { HexCoord, HexMapState } from "shared";
import { hexKey, isAdjacent } from "shared";

async function init() {
  const app = new Application();
  await app.init({
    background: "#efddac",
    resizeTo: window,
    antialias: true,
  });

  const pacer = new FramePacer(app.ticker);

  const container = document.getElementById("game-container")!;
  container.appendChild(app.canvas);

  await Promise.all([loadSpriteAssets(), loadMapAssets(), loadMapIconAssets()]);

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "pvp" ? "pvp" : "pve";

  const conn = new Connection(
    `ws://${window.location.hostname}:3001/ws?mode=${mode}`
  );
  const combatStore = new CombatStore(conn);

  // Combat screen objects
  const clientState = new ClientState(combatStore);
  const combatRenderer = new GameRenderer(app, clientState, pacer);
  const input = new InputManager(app.canvas, clientState, combatRenderer, () => {
    if (!combatStore.hasState()) return;
    combatRenderer.renderOverlay(input.mouseWorld);
  });
  combatStore.setAnimatingCheck(() => combatRenderer.isAnimating());
  combatStore.subscribeEvents((events) => combatRenderer.pushEvents(events));
  clientState.subscribe(() => {
    if (!combatStore.hasState()) return;
    combatRenderer.render();
  });

  // Hex map screen objects
  const hexRenderer = new HexMapRenderer(app, pacer);
  hexRenderer.init();
  hexRenderer.hide();

  // Screen manager
  const screens = new ScreenManager();
  screens.register("map", new MapScreen(hexRenderer));
  screens.register("combat", new CombatScreen(combatRenderer, clientState, combatStore));

  let hexMapState: HexMapState | null = null;
  let moveLocked = false;

  // Hex map input
  hexRenderer.onHexClick((coord: HexCoord) => {
    if (!screens.isActive("map") || !hexMapState || moveLocked) return;
    if (!isAdjacent(hexMapState.playerPos, coord)) return;
    if (!(hexKey(coord) in hexMapState.hexes)) return;

    moveLocked = true;
    hexRenderer.animateMoveTo(coord);
    hexRenderer.onMoveComplete(() => {
      conn.send({ type: "hexMove", target: coord });
    });
  });

  // Hex map messages
  conn.on("hexMapState", (msg) => {
    hexMapState = msg.hexMap;
    moveLocked = false;
    if (screens.isActive("map")) hexRenderer.render(hexMapState!);
  });

  conn.on("hexCombatStart", () => {
    if (hexRenderer.isMoving()) {
      hexRenderer.onMoveComplete(() => screens.switchTo("combat"));
    } else {
      screens.switchTo("combat");
    }
  });

  conn.on("hexCombatResult", () => {
    const waitForIdle = () => {
      if (combatRenderer.isAnimating()) {
        requestAnimationFrame(waitForIdle);
      } else {
        screens.switchTo("map");
        if (hexMapState) hexRenderer.render(hexMapState);
      }
    };
    requestAnimationFrame(waitForIdle);
  });

  // Debug: F2 to instantly win combat
  document.addEventListener("keydown", (e) => {
    if (e.key === "F2" && screens.isActive("combat")) {
      e.preventDefault();
      conn.send({ type: "debugWin" });
    }
  });

  // Boot
  await conn.ready();

  if (mode === "pve") {
    screens.switchTo("map");
  } else {
    await combatStore.waitForState();
    combatRenderer.enter();
  }
}

init();
