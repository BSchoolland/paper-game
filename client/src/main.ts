import { Application } from "pixi.js";
import { Connection } from "./net/connection.js";
import { CombatStore } from "./state/combat-store.js";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { HexMapRenderer, loadMapIconAssets } from "./renderer/hex-map-renderer.js";
import { IrisTransition } from "./renderer/iris-transition.js";
import { InputManager } from "./input/input-manager.js";
import { Hud } from "./ui/hud.js";
import { loadSpriteAssets } from "./renderer/sprite-assets.js";
import { loadMapAssets } from "./renderer/grid-renderer.js";
import type { HexCoord, HexMapState } from "shared";
import { hexKey, isAdjacent } from "shared";

async function init() {
  const app = new Application();
  await app.init({
    background: "#1a140e",
    resizeTo: window,
    antialias: true,
  });

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
  const combatRenderer = new GameRenderer(app, clientState);
  const hud = new Hud(container, clientState);
  const input = new InputManager(app.canvas, clientState, combatRenderer, () => {
    if (!combatStore.hasState()) return;
    combatRenderer.renderOverlay(input.mouseWorld);
    hud.update();
  });
  combatStore.setAnimatingCheck(() => combatRenderer.isAnimating());
  combatStore.subscribeEvents((events) => combatRenderer.pushEvents(events));
  clientState.subscribe(() => {
    if (!combatStore.hasState()) return;
    combatRenderer.render();
    hud.update();
  });
  hud.hide();

  // Hex map screen objects
  const hexRenderer = new HexMapRenderer(app);
  hexRenderer.init();
  hexRenderer.hide();

  const iris = new IrisTransition(app);

  let hexMapState: HexMapState | null = null;
  let activeScreen: "map" | "combat" = mode === "pve" ? "map" : "combat";
  let moveLocked = false;

  function enterMap() {
    activeScreen = "map";
    combatRenderer.exit();
    hud.hide();
    hexRenderer.show();
    if (hexMapState) hexRenderer.render(hexMapState);
  }

  function enterCombatWithTransition() {
    const cx = app.screen.width / 2;
    const cy = app.screen.height / 2;

    iris.bringToFront();
    iris.play(
      cx,
      cy,
      () => {
        activeScreen = "combat";
        hexRenderer.hide();
        combatStore.waitForState().then(() => {
          combatRenderer.enter();
          hud.show();
          hud.update();
        });
      },
      () => {}
    );
  }

  function exitCombatWithTransition() {
    const cx = app.screen.width / 2;
    const cy = app.screen.height / 2;

    iris.bringToFront();
    iris.play(
      cx,
      cy,
      () => {
        enterMap();
      },
      () => {}
    );
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

    const doTransition = () => {
      setTimeout(() => enterCombatWithTransition(), 400);
    };

    if (hexRenderer.isMoving()) {
      hexRenderer.onMoveComplete(doTransition);
    } else {
      doTransition();
    }
  });

  conn.on("hexCombatResult", () => {
    exitCombatWithTransition();
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
    hud.show();
    hud.update();
  }
}

init();
