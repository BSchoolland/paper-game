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

  // Combat screen objects (created once, entered/exited many times)
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

  let hexMapState: HexMapState | null = null;
  let activeScreen: "map" | "combat" = mode === "pve" ? "map" : "combat";
  let moveLocked = false;

  function enterMap() {
    activeScreen = "map";
    combatRenderer.exit();
    hexRenderer.setInputEnabled(true);
    hexRenderer.show();
    if (hexMapState) hexRenderer.render(hexMapState);
  }

  function enterCombat() {
    activeScreen = "combat";
    hexRenderer.hideControls();
    hexRenderer.setInputEnabled(false);
    combatStore.waitForState().then(() => {
      combatRenderer.enter();
    });
  }

  function exitCombat() {
    enterMap();
  }

  // Hex map input
  hexRenderer.onHexClick((coord: HexCoord) => {
    if (activeScreen !== "map" || !hexMapState || moveLocked) return;
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
    if (activeScreen === "map") hexRenderer.render(hexMapState!);
  });

  conn.on("hexCombatStart", () => {
    clientState.resetSelection();
    combatStore.resetDisplayState();

    if (hexRenderer.isMoving()) {
      hexRenderer.onMoveComplete(() => enterCombat());
    } else {
      enterCombat();
    }
  });

  conn.on("hexCombatResult", () => {
    exitCombat();
  });

  // Debug: F2 to instantly win combat
  document.addEventListener("keydown", (e) => {
    if (e.key === "F2" && activeScreen === "combat") {
      e.preventDefault();
      conn.send({ type: "debugWin" });
    }
  });

  // Boot
  await conn.ready();

  if (mode === "pve") {
    enterMap();
  } else {
    await combatStore.waitForState();
    activeScreen = "combat";
    combatRenderer.enter();
  }
}

init();
