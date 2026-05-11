import { Application } from "pixi.js";
import { Connection } from "./net/connection.js";
import { CombatStore } from "./state/combat-store.js";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { HexMapRenderer, loadMapIconAssets } from "./renderer/hex-map-renderer.js";
import { FramePacer } from "./renderer/frame-pacer.js";
import { InputManager } from "./input/input-manager.js";
import { loadSpriteAssets, loadDimensionSprites } from "./renderer/sprite-assets.js";
import { loadMapAssets } from "./renderer/grid-renderer.js";
import { ScreenManager } from "./screens/screen-manager.js";
import { MapScreen } from "./screens/map-screen.js";
import { CombatScreen } from "./screens/combat-screen.js";
import { InventoryScreen } from "./screens/inventory-screen.js";
import type { HexCoord, HexMapState } from "shared";
import { hexKey, isAdjacent, getAnimSet } from "shared";

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

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "pvp" ? "pvp" : "pve";
  const dim = parseInt(params.get("dim") ?? "0", 10) || 0;

  await Promise.all([loadSpriteAssets(), loadMapAssets(), loadMapIconAssets()]);
  await loadDimensionSprites(dim);

  const conn = new Connection(
    `ws://${window.location.hostname}:3001/ws?mode=${mode}&dim=${dim}`
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

  let hexMapState: HexMapState | null = null;

  // Inventory screen
  const inventoryScreen = new InventoryScreen(conn);

  // Screen manager
  const screens = new ScreenManager();
  screens.register("map", new MapScreen(hexRenderer, () => hexMapState));
  screens.register("combat", new CombatScreen(combatRenderer, clientState, combatStore, input), true);
  screens.register("inventory", inventoryScreen, true);

  inventoryScreen.onClose(() => screens.switchTo("map"));

  conn.on("inventory", (msg) => {
    hexRenderer.setPlayerAnimSet(getAnimSet(msg.inventory.equipped));
    hexRenderer.setPlayerEquipment(msg.inventory.equipped, msg.inventory.attachments);
  });

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
      }
    };
    requestAnimationFrame(waitForIdle);
  });

  // Inventory toggle
  document.addEventListener("keydown", (e) => {
    if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey) {
      if (screens.isActive("map")) {
        screens.switchTo("inventory");
      } else if (screens.isActive("inventory")) {
        screens.switchTo("map");
      }
    }
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
    screens.switchTo("combat");
  }
}

init();
