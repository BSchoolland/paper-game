import { Application } from "pixi.js";
import { Connection } from "./net/connection.js";
import { CombatStore } from "./state/combat-store.js";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { DefendPrompt } from "./renderer/defend-prompt.js";
import { HexMapRenderer, loadMapIconAssets } from "./renderer/hex-map-renderer.js";
import { FramePacer } from "./renderer/frame-pacer.js";
import { InputManager } from "./input/input-manager.js";
import { loadSpriteAssets, loadDimensionSprites } from "./renderer/sprite-assets.js";
import { loadMapAssets } from "./renderer/grid-renderer.js";
import { ScreenManager } from "./screens/screen-manager.js";
import { MapScreen } from "./screens/map-screen.js";
import { CombatScreen } from "./screens/combat-screen.js";
import { InventoryScreen } from "./screens/inventory-screen.js";
import { ReplayScreen } from "./screens/replay-screen.js";
import { ReplayStore } from "./state/replay-store.js";
import type { HexCoord, HexMapState } from "shared";
import { hexKey, isAdjacent, getAnimSet } from "shared";

function waitForQueue(store: CombatStore, renderer: GameRenderer): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!renderer.isAnimating()) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

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
  const rawMode = params.get("mode");
  const mode = rawMode === "pvp" ? "pvp" : rawMode === "duel" ? "duel" : "pve";
  const dim = parseInt(params.get("dim") ?? "0", 10) || 0;

  await Promise.all([loadSpriteAssets(), loadMapAssets(), loadMapIconAssets()]);
  await loadDimensionSprites(dim);

  if (rawMode === "replay") {
    await runReplay(app, pacer, params.get("log") ?? "/replay.json");
    return;
  }

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

  const defendPrompt = new DefendPrompt(clientState);
  defendPrompt.setRenderer(combatRenderer);
  conn.on("defendPrompt", async (msg) => {
    console.log("[DEFEND] prompt received", msg);
    await waitForQueue(combatStore, combatRenderer);
    console.log("[DEFEND] queue drained, running prompt");
    const results: Record<string, number> = {};
    for (const targetId of msg.targetIds as string[]) {
      const power = await defendPrompt.run(targetId);
      console.log(`[DEFEND] target=${targetId} power=${power.toFixed(2)}`);
      results[targetId] = power;
    }
    console.log("[DEFEND] sending result", results);
    conn.send({ type: "defendResult", results });
  });
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

async function runReplay(app: Application, pacer: FramePacer, logUrl: string) {
  const store = new ReplayStore();
  const clientState = new ClientState(store);
  const renderer = new GameRenderer(app, clientState, pacer);
  store.setAnimatingCheck(() => renderer.isAnimating());
  store.subscribeEvents((events) => renderer.pushEvents(events));
  clientState.subscribe(() => { if (store.hasState()) renderer.render(); });

  const screens = new ScreenManager();
  screens.register("replay", new ReplayScreen(renderer));

  const res = await fetch(logUrl);
  if (!res.ok) {
    console.error(`Replay log not found at ${logUrl} — run \`bun scripts/sim-battle.ts\` first.`);
    return;
  }
  const data = await res.json();
  if (Array.isArray(data.dimensions)) {
    await Promise.all(data.dimensions.map((d: number) => loadDimensionSprites(d)));
  }
  store.loadFrames(data.frames);
  screens.switchTo("replay");

  const SPEEDS = [0.5, 1, 2, 4];
  let speedIdx = Math.max(0, SPEEDS.indexOf(Number(localStorage.getItem("replaySpeed") ?? "1")));
  if (speedIdx < 0) speedIdx = 1;
  const applySpeed = () => {
    renderer.setPlaybackSpeed(SPEEDS[speedIdx]!);
    localStorage.setItem("replaySpeed", String(SPEEDS[speedIdx]!));
    refreshHud();
  };

  const hud = document.createElement("div");
  hud.style.cssText = "position:fixed;left:8px;bottom:8px;font:12px monospace;color:#4a3728;background:rgba(239,221,172,0.85);padding:4px 8px;border-radius:4px;pointer-events:none;white-space:pre;";
  document.body.appendChild(hud);
  function refreshHud() {
    const f = store.current();
    hud.textContent =
      `frame ${store.position}/${store.total - 1}   turn ${f?.turnNumber ?? "?"} ${f?.team ?? ""}   speed ${SPEEDS[speedIdx]}×${store.atEnd ? "   [END]" : ""}\n` +
      `[.] step   [Enter] play turn   [,] restart   [ and ] adjust speed`;
  }
  store.subscribe(refreshHud);
  applySpeed();

  document.addEventListener("keydown", (e) => {
    if (e.key === "." || e.key === " ") { e.preventDefault(); store.step(); }
    else if (e.key === "Enter") { e.preventDefault(); store.playTurn(); }
    else if (e.key === ",") { e.preventDefault(); store.reset(); }
    else if (e.key === "]") { e.preventDefault(); speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); applySpeed(); }
    else if (e.key === "[") { e.preventDefault(); speedIdx = Math.max(0, speedIdx - 1); applySpeed(); }
  });
}

init();
