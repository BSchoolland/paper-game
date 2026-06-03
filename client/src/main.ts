import { Application } from "pixi.js";
import { RoomConnection } from "./net/connection.js";
import { SeatContext } from "./state/seat-context.js";
import { CombatStore } from "./state/combat-store.js";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { DefendPrompt } from "./renderer/defend-prompt.js";
import { PartyHud } from "./renderer/party-hud.js";
import { VotePanel } from "./renderer/vote-panel.js";
import { HexMapRenderer, loadMapIconAssets } from "./renderer/hex-map-renderer.js";
import { FramePacer } from "./renderer/frame-pacer.js";
import { InputManager } from "./input/input-manager.js";
import { loadSpriteAssets, loadDimensionSprites } from "./renderer/sprite-assets.js";
import { loadMapAssets } from "./renderer/grid-renderer.js";
import { ScreenManager } from "./screens/screen-manager.js";
import { LobbyScreen } from "./screens/lobby-screen.js";
import { MapScreen } from "./screens/map-screen.js";
import { CombatScreen } from "./screens/combat-screen.js";
import { InventoryScreen } from "./screens/inventory-screen.js";
import { ReplayScreen } from "./screens/replay-screen.js";
import { ReplayStore } from "./state/replay-store.js";
import type { HexMapState, RoomPhase } from "shared";
import { getAnimSet } from "shared";

function showBanner(text: string): void {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
    padding: 12px; text-align: center; font-family: monospace; font-size: 14px;
    color: #fffaf0; background: #8b3a3a;
  `;
  document.body.appendChild(el);
}

/** A pinned status bar (e.g. "Disconnected — reconnecting…"). Replaces its text; hidden when null. */
function makeStatusBar(): (text: string | null) => void {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 1100;
    padding: 8px; text-align: center; font-family: monospace; font-size: 13px;
    color: #fffaf0; background: #b06a2a; display: none;
  `;
  document.body.appendChild(el);
  return (text) => {
    if (text === null) {
      el.style.display = "none";
    } else {
      el.textContent = text;
      el.style.display = "block";
    }
  };
}

/** An auto-dismissing top banner for non-terminal run-end notices (defeat/victory). */
function makeTransientBanner(): (text: string) => void {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 1050;
    padding: 14px; text-align: center; font-family: monospace; font-size: 15px; font-weight: bold;
    color: #fffaf0; background: #4a3728; display: none;
  `;
  document.body.appendChild(el);
  let hideTimer: number | null = null;
  return (text) => {
    el.textContent = text;
    el.style.display = "block";
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { el.style.display = "none"; }, 4500);
  };
}

/** A transient toast for recoverable refusals (rejected move/vote/host action). */
function makeToast(): (text: string) => void {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 1100;
    padding: 10px 16px; text-align: center; font-family: monospace; font-size: 13px;
    color: #fffaf0; background: rgba(139, 58, 58, 0.95); border-radius: 6px;
    box-shadow: 0 3px 10px rgba(0,0,0,0.3); display: none; pointer-events: none;
  `;
  document.body.appendChild(el);
  let hideTimer: number | null = null;
  return (text) => {
    el.textContent = text;
    el.style.display = "block";
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { el.style.display = "none"; }, 3000);
  };
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
  const dim = parseInt(params.get("dim") ?? "0", 10) || 0;

  await Promise.all([loadSpriteAssets(), loadMapAssets(), loadMapIconAssets()]);
  await loadDimensionSprites(dim);

  if (rawMode === "replay") {
    await runReplay(app, pacer, params.get("log") ?? "/replay.json");
    return;
  }

  const conn = new RoomConnection(`ws://${window.location.hostname}:3001/ws`);
  const seat = new SeatContext();
  const combatStore = new CombatStore(conn, seat);

  conn.on("roomState", (msg) => seat.setRoom(msg.room));
  conn.on("coopStatus", (msg) => seat.setCoop(msg.coop));
  conn.on("protocolMismatch", (msg) =>
    showBanner(`Protocol mismatch — refresh to update (server v${msg.serverVersion}, client v${msg.clientVersion}).`),
  );
  conn.on("displaced", () => showBanner("Your seat was taken over from another tab."));

  // Connection status (reconnect/backoff) banner.
  const setStatus = makeStatusBar();
  conn.onStatus((status) => {
    if (status === "open") setStatus(null);
    else if (status === "reconnecting") setStatus("Disconnected — reconnecting…");
    else setStatus("Connecting…");
  });

  // Recoverable refusals not owned by the lobby (rejected move/vote/host action/loadout) toast so
  // the player learns why an action did nothing. The lobby owns its own join/create error display.
  const toast = makeToast();
  const lobbyOwnedErrors = new Set(["ROOM_NOT_FOUND", "ROOM_FULL", "ALREADY_STARTED", "ROOM_CREATE_FAILED", "SEAT_IN_USE", "NOT_YOUR_SEAT"]);
  conn.on("error", (msg) => {
    if (lobbyOwnedErrors.has(msg.code)) return;
    toast(msg.message);
  });

  // The party-wipe / victory run-end banner. The server sends `gameOver` alongside the roomState
  // that swaps back to the overworld; surface it so a defeat isn't a silent teleport to town.
  const runEndBanner = makeTransientBanner();
  conn.on("gameOver", (msg) =>
    runEndBanner(
      msg.outcome === "defeat"
        ? "Your party was defeated — a new expedition begins at the town."
        : "Victory! The expedition prevails.",
    ),
  );

  // Load the room's dimension sprites (idempotent) so combat renders the right enemies/structures
  // even when the room's dimension differs from the ?dim preload (e.g. a joiner inherits the host's).
  // The combat screen-switch awaits this so the first frame isn't drawn with missing sprites.
  // `dim` was already preloaded above, so the initial promise is resolved.
  let dimensionReady: Promise<unknown> = Promise.resolve();
  let loadedRoomDimension = dim;
  conn.on("roomState", (msg) => {
    if (msg.room.dimensionId !== loadedRoomDimension) {
      loadedRoomDimension = msg.room.dimensionId;
      dimensionReady = loadDimensionSprites(msg.room.dimensionId);
    }
  });

  // Combat screen objects
  const clientState = new ClientState(combatStore, seat);
  combatStore.subscribeRejected(() => clientState.clearSubmitLock());
  combatStore.subscribeSelfActed(() => clientState.clearSubmitLock());
  const combatRenderer = new GameRenderer(app, clientState, pacer);
  const input = new InputManager(app.canvas, clientState, combatRenderer, () => {
    if (!combatStore.hasState()) return;
    combatRenderer.renderOverlay(input.mouseWorld);
  });
  combatStore.setAnimatingCheck(() => combatRenderer.isAnimating());
  combatStore.subscribeEvents((events) => combatRenderer.pushEvents(events));

  // Route the defend prompt only to the seat the server targeted; an idempotency guard drops a
  // duplicate prompt for a round this seat is already answering.
  const defendPrompt = new DefendPrompt(clientState, combatRenderer);
  let activeDefendPromptId: string | null = null;
  conn.on("defendPrompt", async (msg) => {
    if (msg.seatId !== seat.mySeatId) return;
    if (activeDefendPromptId === msg.promptId) return;
    activeDefendPromptId = msg.promptId;
    await waitForIdle(combatRenderer);
    const power = await defendPrompt.run({
      promptId: msg.promptId,
      attackerId: msg.attackerId,
      attackerPosition: msg.attackerPosition,
      aimDirection: msg.aimDirection,
      ability: msg.ability,
      targetIds: [msg.targetEntityId],
    });
    conn.send({ type: "defendResult", seatId: msg.seatId, promptId: msg.promptId, power });
    activeDefendPromptId = null;
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

  // HUDs (in-combat party panel + overworld vote panel)
  const partyHud = new PartyHud(seat, clientState);
  new VotePanel(conn, seat);

  // Inventory (own bag; loadout-editable only off-combat)
  const inventoryScreen = new InventoryScreen(conn, () => seat.room?.phase !== "combat");

  // Screen manager + registration
  const screens = new ScreenManager();
  screens.register("lobby", new LobbyScreen(conn, seat, () => screens.switchTo("inventory"), dim));
  screens.register("map", new MapScreen(hexRenderer, conn, () => hexMapState));
  screens.register("combat", new CombatScreen(combatRenderer, clientState, combatStore, input), true);
  screens.register("inventory", inventoryScreen, true);

  inventoryScreen.onClose(() => switchForPhase(seat.room?.phase ?? "lobby"));

  conn.on("inventory", (msg) => {
    hexRenderer.setPlayerAnimSet(getAnimSet(msg.inventory.equipped));
    hexRenderer.setPlayerEquipment(msg.inventory.equipped, msg.inventory.attachments);
  });

  conn.on("hexMapState", (msg) => {
    hexMapState = msg.hexMap;
    if (screens.isActive("map")) hexRenderer.render(hexMapState);
  });

  // The PartyHud follows combat: shown while in the combat screen, hidden otherwise.
  let combatActive = false;
  const setCombatActive = (active: boolean) => {
    if (active === combatActive) return;
    combatActive = active;
    if (active) partyHud.show();
    else partyHud.hide();
  };

  // `roomState.phase` is the authoritative screen selector. Leaving combat waits for the renderer
  // to finish playing the final events before swapping to the overworld.
  let pendingPhase: RoomPhase | null = null;
  conn.on("combatEnd", () => {
    pendingPhase = "overworld";
  });

  function switchForPhase(phase: RoomPhase): void {
    switch (phase) {
      case "lobby":
      case "gameover":
        setCombatActive(false);
        screens.switchTo("lobby");
        return;
      case "overworld":
        setCombatActive(false);
        screens.switchTo("map");
        return;
      case "combat":
        // Wait for the room's dimension sprites before showing combat (avoids a missing-sprite flash).
        void dimensionReady.then(() => {
          if (seat.room?.phase !== "combat") return;
          setCombatActive(true);
          screens.switchTo("combat");
        });
        return;
    }
  }

  conn.on("roomState", (msg) => {
    const phase = msg.room.phase;
    // While the inventory overlay is open, stay on it; the base screen still tracks the phase and
    // is revealed on close. Otherwise follow the phase, deferring a combat->overworld swap until
    // the combat animation queue drains (combatEnd gate).
    if (screens.isActive("inventory")) return;
    if (phase === "overworld" && pendingPhase === "overworld" && combatActive) {
      waitForIdle(combatRenderer).then(() => {
        pendingPhase = null;
        switchForPhase("overworld");
      });
      return;
    }
    pendingPhase = null;
    switchForPhase(phase);
  });

  // Inventory toggle (lobby/overworld only — combat has no loadout editing).
  document.addEventListener("keydown", (e) => {
    if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey) {
      const phase = seat.room?.phase;
      if (phase === "combat") return;
      if (screens.isActive("inventory")) switchForPhase(phase ?? "lobby");
      else screens.switchTo("inventory");
    }
  });

  // Debug: F2 to instantly win combat (host-gated server-side).
  document.addEventListener("keydown", (e) => {
    if (e.key === "F2" && screens.isActive("combat")) {
      e.preventDefault();
      conn.send({ type: "debugWin" });
    }
  });

  try {
    await conn.ready();
  } catch (err) {
    // The protocolMismatch handler already showed its own banner; only the connect-failure path
    // needs the generic message.
    if ((err as Error)?.message !== "protocolMismatch") {
      showBanner("Could not reach the game server — refresh to retry.");
    }
    return;
  }

  // A stored clientId means hello may auto-reconnect into a live/durable run; the resulting
  // roomState drives the screen. Until a roomState arrives, the lobby is the entry point.
  screens.switchTo("lobby");
  if (seat.room) switchForPhase(seat.room.phase);
}

function waitForIdle(renderer: GameRenderer): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!renderer.isAnimating()) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
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
