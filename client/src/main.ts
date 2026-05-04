import { Application } from "pixi.js";
import { RemoteGameStore } from "./state/remote-game-store.js";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { HexMapRenderer } from "./renderer/hex-map-renderer.js";
import { InputManager } from "./input/input-manager.js";
import { Hud } from "./ui/hud.js";
import { loadSpriteAssets } from "./renderer/sprite-assets.js";
import { loadMapAssets } from "./renderer/grid-renderer.js";
import type { HexCoord, HexMapState } from "shared";
import { hexKey, isAdjacent } from "shared";

type ScreenPhase = "map" | "combat";

async function init() {
  const app = new Application();
  await app.init({
    background: "#1a140e",
    resizeTo: window,
    antialias: true,
  });

  const container = document.getElementById("game-container")!;
  container.appendChild(app.canvas);

  await Promise.all([loadSpriteAssets(), loadMapAssets()]);

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "pvp" ? "pvp" : "pve";

  const gameStore = new RemoteGameStore(
    `ws://${window.location.hostname}:3001/ws?mode=${mode}`
  );

  let phase: ScreenPhase = mode === "pve" ? "map" : "combat";
  let hexMapState: HexMapState | null = null;

  const hexRenderer = new HexMapRenderer(app);
  hexRenderer.init();

  let clientState: ClientState | null = null;
  let combatRenderer: GameRenderer | null = null;
  let hud: Hud | null = null;
  let input: InputManager | null = null;
  let combatEverInitialized = false;
  let waitingForCombatState = false;

  function showMap() {
    phase = "map";
    hexRenderer.show();
    if (combatRenderer) combatRenderer.hide();
    if (hud) hud.hide();
    if (hexMapState) hexRenderer.render(hexMapState);
  }

  function showCombat() {
    phase = "combat";
    hexRenderer.hide();
    if (combatRenderer) combatRenderer.show();
    if (hud) hud.show();
  }

  function ensureCombatObjects() {
    if (clientState) return;
    clientState = new ClientState(gameStore);
    combatRenderer = new GameRenderer(app, clientState);
    hud = new Hud(container, clientState);
    input = new InputManager(app.canvas, clientState, combatRenderer, () => {
      combatRenderer!.renderOverlay(input!.mouseWorld);
      hud!.update();
    });
    gameStore.setAnimatingCheck(() => combatRenderer!.isAnimating());
    gameStore.subscribeEvents((events) => combatRenderer!.pushEvents(events));
    clientState.subscribe(() => {
      if (waitingForCombatState) {
        waitingForCombatState = false;
        if (clientState) {
          clientState.selectedEntityId = null;
          clientState.inputMode = "select";
        }
        if (!combatEverInitialized) {
          combatEverInitialized = true;
          combatRenderer!.init();
        } else {
          combatRenderer!.rebuild();
        }
        showCombat();
      }
      combatRenderer!.render();
      hud!.update();
    });
  }

  hexRenderer.onHexClick((coord: HexCoord) => {
    if (phase !== "map" || !hexMapState) return;
    if (!isAdjacent(hexMapState.playerPos, coord)) return;
    const vis = hexMapState.hexes;
    if (!(hexKey(coord) in vis)) return;
    gameStore.sendRaw({ type: "hexMove", target: coord });
  });

  gameStore.onHexMessage((msg: any) => {
    if (msg.type === "hexMapState") {
      hexMapState = msg.hexMap;
      if (phase === "map") hexRenderer.render(hexMapState!);
    } else if (msg.type === "hexCombatStart") {
      ensureCombatObjects();
      waitingForCombatState = true;
    } else if (msg.type === "hexCombatResult") {
      showMap();
    }
  });

  if (mode === "pve") {
    await gameStore.readyForHex();
    showMap();
  } else {
    await gameStore.ready();
    ensureCombatObjects();
    combatEverInitialized = true;
    combatRenderer!.init();
    hud!.update();
    showCombat();
  }
}

init();
