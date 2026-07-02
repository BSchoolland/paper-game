import { Application } from "pixi.js";
import { RoomConnection } from "./net/connection.js";
import { SeatContext } from "./state/seat-context.js";
import { CombatStore } from "./state/combat-store.js";
import { ClientState } from "./state/client-state.js";
import { GameRenderer } from "./renderer/game-renderer.js";
import { DefendPrompt } from "./renderer/defend-prompt.js";
import { PartyHud } from "./renderer/party-hud.js";
import { VotePanel } from "./renderer/vote-panel.js";
import { ContractHud } from "./renderer/contract-hud.js";
import { LootPanel } from "./renderer/loot-panel.js";
import { HexMapRenderer, loadMapIconAssets } from "./renderer/hex-map-renderer.js";
import { FramePacer } from "./renderer/frame-pacer.js";
import { InputManager } from "./input/input-manager.js";
import { loadSpriteAssets, loadDimensionSprites } from "./renderer/sprite-assets.js";
import { loadMapAssets } from "./renderer/grid-renderer.js";
import { ScreenManager } from "./screens/screen-manager.js";
import { HomeScreen } from "./screens/home-screen.js";
import { LobbyScreen } from "./screens/lobby-screen.js";
import { GameOverScreen, type XpBankedMsg, type CodexBankedMsg } from "./screens/game-over-screen.js";
import { MapScreen } from "./screens/map-screen.js";
import { CombatScreen } from "./screens/combat-screen.js";
import { InventoryScreen } from "./screens/inventory-screen.js";
import { ReplayScreen } from "./screens/replay-screen.js";
import { ReplayStore } from "./state/replay-store.js";
import { AccountStore } from "./state/account-store.js";
import { CodexStore } from "./state/codex-store.js";
import { ChatStore } from "./state/chat-store.js";
import { ChatPanel } from "./screens/chat-panel.js";
import { AuthModal, AUTH_ERROR_CODES } from "./screens/auth-modal.js";
import { FriendsDock } from "./screens/friends-panel.js";
import { THEME, FONT } from "./screens/ui-kit.js";
import { clearStoredSeat, setAuthToken } from "./net/player-token.js";
import type { GatewayInfo, HexMapState, RoomCode, RoomPhase } from "shared";
import { archetypeById, getAnimSet, hexKey, titleById } from "shared";

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

/**
 * A bottom-right stack of gold reward/notice toasts (XP, titles, room invites). Unlike the
 * refusal toast these are interactive (pointer-events on) so an invite can carry a Join button.
 * `content` is either plain text or a builder handed a dismiss callback.
 */
function makeToastStack(): (content: string | ((dismiss: () => void) => HTMLElement), opts?: { ttlMs?: number }) => void {
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    position: fixed; right: 16px; bottom: 16px; z-index: 1090;
    display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
  `;
  document.body.appendChild(wrap);
  return (content, opts) => {
    const el = document.createElement("div");
    el.style.cssText = `
      padding: 10px 16px; font: 13px ${FONT.body}; color: ${THEME.parch};
      background: rgba(17,13,9,0.92); border: 1px solid ${THEME.goldLine}; border-radius: 8px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.5); pointer-events: auto;
    `;
    const dismiss = () => el.remove();
    if (typeof content === "string") el.textContent = content;
    else el.appendChild(content(dismiss));
    wrap.appendChild(el);
    window.setTimeout(dismiss, opts?.ttlMs ?? 4500);
  };
}

/** A fixed "Leave game" button for a started game (overworld/combat). Returns a visibility setter. */
function makeLeaveButton(onLeave: () => void): (visible: boolean) => void {
  const b = document.createElement("button");
  b.textContent = "Leave game";
  b.tabIndex = -1;
  b.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 1000; display: none;
    padding: 7px 12px; font-family: monospace; font-size: 12px; font-weight: bold;
    color: #fffaf0; background: rgba(139, 58, 58, 0.92); border: 1px solid #6b3030;
    border-radius: 6px; cursor: pointer;
  `;
  b.addEventListener("click", onLeave);
  document.body.appendChild(b);
  return (visible) => { b.style.display = visible ? "block" : "none"; };
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

  // Credentials (passwords, long-lived authTokens) ride this socket — never plaintext ws
  // from a TLS page (browsers block it as mixed content anyway).
  const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
  const conn = new RoomConnection(`${wsScheme}://${window.location.hostname}:3001/ws`);
  const seat = new SeatContext();
  const combatStore = new CombatStore(conn, seat);
  const accountStore = new AccountStore();
  const codexStore = new CodexStore();
  const chatStore = new ChatStore();
  const authModal = new AuthModal(conn);

  conn.on("roomState", (msg) => seat.setRoom(msg.room));
  conn.on("coopStatus", (msg) => seat.setCoop(msg.coop));

  // Account/social state (docs/meta-loop/01-accounts.md §7.1). A rejected saved token still
  // resolves to a usable guest underneath; the modal is a dismissable "log back in" prompt.
  // Skipped when the same welcome auto-reclaimed a live seat: login is server-rejected while
  // seated (AUTH_IN_ROOM), so the prompt could never succeed — the HOME profile card carries
  // the authRejected notice for after the run.
  conn.on("welcome", (msg) => {
    accountStore.setAuth(msg.auth);
    if (msg.auth.authRejected && !msg.reconnected) authModal.open("login");
  });
  conn.on("authState", (msg) => {
    setAuthToken(msg.auth.authToken);
    accountStore.setAuth(msg.auth);
    // Identity switched (login/logout/claim): the shelf/picker must show the NEW account's codex.
    conn.send({ type: "getCodex" });
  });
  conn.on("profile", (msg) => accountStore.setProfile(msg.profile));
  conn.on("friendsList", (msg) => accountStore.setFriends(msg.friends));

  // Codex snapshots (getCodex responses) land in the shared store; Home/Lobby render from it.
  conn.on("codex", (msg) => codexStore.setEntries(msg.entries));

  // Room chat: scoped to one room — replaced by the reconnect replay, cleared on room change.
  conn.on("chat", (msg) => chatStore.append(msg.entry));
  conn.on("chatHistory", (msg) => chatStore.replaceAll(msg.entries));
  let chatRoomCode: RoomCode | null = null;
  conn.on("roomState", (msg) => {
    if (msg.room.code !== chatRoomCode) {
      chatRoomCode = msg.room.code;
      chatStore.clear();
    }
  });

  // Private reward pushes + friend room invites (gold toast stack, bottom-right).
  const pushToast = makeToastStack();
  conn.on("xpAward", (msg) => pushToast(`+${msg.amount} XP — ${msg.pending} pending`));
  conn.on("titlesEarned", (msg) => {
    for (const id of msg.titleIds) pushToast(`Title earned — ${titleById(id).name}`);
  });
  conn.on("roomInvite", (msg) =>
    pushToast(
      (dismiss) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:12px;";
        const text = document.createElement("span");
        const who = document.createElement("b");
        who.textContent = msg.from.displayName;
        who.style.color = THEME.gold;
        text.append(who, document.createTextNode(` invited you to room ${msg.code}`));
        row.appendChild(text);
        // joinRoom while seated abandons the live run server-side — same room-less gate as
        // FriendsPanel's Join, re-checked at click because the toast outlives room changes.
        if (seat.room === null) {
          const join = document.createElement("button");
          join.textContent = "Join";
          join.tabIndex = -1;
          join.style.cssText = `
            padding: 5px 14px; font: 600 12px ${FONT.cinzel}; letter-spacing: 0.06em; cursor: pointer;
            color: #221a0c; background: linear-gradient(180deg, ${THEME.gold}, ${THEME.goldDeep});
            border: 1px solid ${THEME.gold}; border-radius: 6px;
          `;
          join.addEventListener("click", () => {
            dismiss();
            if (seat.room !== null) {
              pushToast("Leave your current game before joining another room.");
              return;
            }
            conn.send({ type: "joinRoom", code: msg.code });
          });
          row.appendChild(join);
        }
        return row;
      },
      { ttlMs: 15000 },
    ),
  );
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
  // the player learns why an action did nothing. The lobby owns its own join/create error display;
  // the friends panels own friend-request errors; the auth modal owns auth errors while open.
  const toast = makeToast();
  const lobbyOwnedErrors = new Set(["ROOM_NOT_FOUND", "ROOM_FULL", "ALREADY_STARTED", "ROOM_CREATE_FAILED", "SEAT_IN_USE", "NOT_YOUR_SEAT"]);
  const friendsOwnedErrors = new Set(["NO_SUCH_USER", "CLAIM_REQUIRED"]);
  conn.on("error", (msg) => {
    if (lobbyOwnedErrors.has(msg.code)) return;
    if (friendsOwnedErrors.has(msg.code)) return;
    if (authModal.isOpen() && AUTH_ERROR_CODES.has(msg.code)) return;
    toast(msg.message);
  });

  // A party wipe now lands on the held Game Over end state (GameOverScreen), so no transient banner is
  // needed; the `gameOver` message is informational and the `gameover` roomState phase drives the screen.

  // First-ever community discovery (GLOBAL per dimension) — a celebratory key moment.
  const discoveryBanner = makeTransientBanner();
  conn.on("hexDiscovered", () =>
    discoveryBanner("✨ Uncharted territory — your party discovered a hex no one has ever seen!"),
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
    await waitForIdle(combatRenderer, combatStore);
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
  let gatewayMap: Record<string, GatewayInfo> = {};

  // HUDs (in-combat party panel + overworld vote panel + floating chat/friends panels — the
  // latter live outside every screen's DOM so lobby re-renders can never blur their inputs)
  const partyHud = new PartyHud(seat, clientState);
  new VotePanel(conn, seat);
  new LootPanel(conn, seat);
  const contractHud = new ContractHud(conn, seat, () => hexMapState, () => gatewayMap);
  new ChatPanel(conn, seat, chatStore);
  new FriendsDock(conn, accountStore, seat, (mode) => authModal.open(mode));

  // Run-scoped XP state: the pending accrual feeds the ContractHud chip; the last settlement push
  // is held for the GameOverScreen's banked line. Both reset when a fresh run begins (new runId /
  // room left); lastBank additionally clears on any overworld snapshot so a reconnect mid-run
  // can never show a stale bank on a later game over.
  let lastBank: XpBankedMsg | null = null;
  let lastCodexBank: CodexBankedMsg | null = null;
  let seenRunId: number | null = null;
  conn.on("xpAward", (msg) => contractHud.setPending(msg.pending));
  conn.on("xpBanked", (msg) => {
    lastBank = msg;
    contractHud.setPending(0);
    pushToast(msg.leveledUp ? `Banked ${msg.banked} XP — Level up! Now LV ${msg.level}` : `Banked ${msg.banked} XP`);
  });
  // Codex settlement push (docs/meta-loop/03-loot-codex.md §6.7): held for the game-over screen's
  // codex line, celebrated in the toast stack, and re-fetched into the store so the HOME shelf is
  // current the moment the player returns.
  conn.on("codexBanked", (msg) => {
    lastCodexBank = msg;
    if (msg.entries.length > 0) pushToast(`Codex — ${msg.entries.length} new design(s) banked`);
    for (const _ of msg.firstItemIds) pushToast("✦ World first! Design recovered for the first time anywhere");
    conn.send({ type: "getCodex" });
  });
  // Drop-moment celebration; pool truth rides roomState (the LootPanel renders from it).
  conn.on("lootFound", (msg) => {
    for (const d of msg.drops) pushToast(`Spoils — ${d.item.name}`);
  });
  conn.on("roomState", (msg) => {
    if (msg.room.phase === "overworld") {
      lastBank = null;
      lastCodexBank = null;
    }
    if (msg.room.runId !== seenRunId) {
      seenRunId = msg.room.runId;
      contractHud.setPending(0);
    }
  });
  conn.on("leftRoom", () => {
    lastBank = null;
    lastCodexBank = null;
    seenRunId = null;
    contractHud.setPending(0);
  });

  // Inventory (own bag; loadout-editable only off-combat)
  const inventoryScreen = new InventoryScreen(conn, () => seat.room?.phase !== "combat");

  // Screen manager + registration
  const screens = new ScreenManager();
  const homeScreen = new HomeScreen(conn, seat, dim, accountStore, codexStore, (mode) => authModal.open(mode));
  screens.register("home", homeScreen);
  screens.register("lobby", new LobbyScreen(conn, seat, accountStore, codexStore, () => screens.switchTo("inventory")));
  screens.register("gameover", new GameOverScreen(conn, seat, () => lastBank, () => lastCodexBank));
  screens.register("map", new MapScreen(hexRenderer, conn, () => hexMapState));
  screens.register("combat", new CombatScreen(combatRenderer, clientState, combatStore, input), true);
  screens.register("inventory", inventoryScreen, true);

  conn.on("roomList", (msg) => homeScreen.setRooms(msg.rooms));

  inventoryScreen.onClose(() => route());

  conn.on("inventory", (msg) => {
    hexRenderer.setPlayerAnimSet(getAnimSet(msg.inventory.equipped));
    hexRenderer.setPlayerEquipment(msg.inventory.equipped, msg.inventory.attachments);
  });

  conn.on("hexMapState", (msg) => {
    hexMapState = msg.hexMap;
    gatewayMap = msg.gateways;
    contractHud.setHexMap(msg.hexMap);
    if (screens.isActive("map")) hexRenderer.render(hexMapState);
  });

  // Gateway attunement result at a cleared gateway hex (docs/meta-loop/04-portals.md §6.1):
  // a fixed destination, or null when the pool was empty (flag #4's player-facing half).
  conn.on("gatewayUpdate", (msg) => {
    if (msg.gateway) {
      gatewayMap[hexKey(msg.hex)] = msg.gateway;
      pushToast(`A gateway attunes — ${msg.gateway.toName} (Tier ${msg.gateway.toTier}) lies beyond.`);
    } else {
      pushToast("The gateway is unattuned — no new dimension is ready beyond it.");
    }
    contractHud.refresh();
  });

  // Difficulty flavor (docs/meta-loop/05-difficulty.md §6.1): combat entry announces the rolled
  // archetype; a rest grant announces the fortify. Phase routing still rides roomState.
  conn.on("combatStart", (msg) => pushToast(archetypeById(msg.archetype).flavor));
  conn.on("restUpdate", (msg) => {
    // The hex-entered grant path broadcasts no roomState (only hexMapState), so this message
    // is the HUD's only source of truth for `rested` there — patch it into the seat context.
    if (seat.room) seat.setRoom({ ...seat.room, rested: msg.rested });
    if (msg.rested) pushToast("The party rests — fortified for the next battle.");
  });

  // The PartyHud follows combat: shown while in the combat screen, hidden otherwise.
  let combatActive = false;
  const setCombatActive = (active: boolean) => {
    if (active === combatActive) return;
    combatActive = active;
    if (active) partyHud.show();
    else partyHud.hide();
  };

  // Always-on "Leave game" control, shown only in a started game (overworld/combat). The staging
  // lobby and the Game Over screen carry their own leave/return buttons.
  const setLeaveVisible = makeLeaveButton(() => conn.send({ type: "leaveRoom" }));

  // Room presence + `roomState.phase` is the authoritative screen selector. Leaving combat waits for
  // the renderer to finish the final events before swapping to the overworld OR the Game Over screen.
  let leavingCombat = false;
  conn.on("combatEnd", () => {
    leavingCombat = true;
  });

  // The single screen-selection entry point: HOME when room-less, else the room's current phase.
  function route(): void {
    if (!seat.room) {
      setCombatActive(false);
      setLeaveVisible(false);
      screens.switchTo("home");
      return;
    }
    switchForPhase(seat.room.phase);
  }

  function switchForPhase(phase: RoomPhase): void {
    setLeaveVisible(phase === "overworld" || phase === "combat");
    switch (phase) {
      case "lobby":
        setCombatActive(false);
        screens.switchTo("lobby");
        return;
      case "gameover":
        setCombatActive(false);
        screens.switchTo("gameover");
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

  // The server confirms a voluntary leave / finalized run by telling this client it is now room-less.
  conn.on("leftRoom", () => {
    seat.setRoom(null);
    gatewayMap = {};
    clearStoredSeat();
    chatStore.clear();
    chatRoomCode = null;
    route();
  });

  conn.on("roomState", (msg) => {
    const phase = msg.room.phase;
    // While the inventory overlay is open, stay on it; the base screen still tracks the phase and is
    // revealed on close. Otherwise follow the phase, deferring a combat->overworld/gameover swap until
    // the combat animation queue drains (combatEnd gate) so the final death/clear animation plays out.
    if (screens.isActive("inventory")) return;
    if (combatActive && leavingCombat && (phase === "overworld" || phase === "gameover")) {
      waitForIdle(combatRenderer, combatStore).then(() => {
        leavingCombat = false;
        switchForPhase(phase);
      });
      return;
    }
    leavingCombat = false;
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

  // hello may auto-rejoin a still-live game (the resulting roomState drives the screen); otherwise the
  // client is room-less and lands on HOME. route() picks correctly either way.
  route();
}

/**
 * Resolve once combat is fully at rest: the network batch queue has drained AND no visual is
 * mid-animation. Gating on `store.isIdle()` (not just the renderer) is load-bearing — the server
 * broadcasts a whole enemy sweep synchronously before a `defendPrompt`, so when the prompt lands
 * the move that precedes the attack is still queued. Waiting only on `renderer.isAnimating()` would
 * resolve in the gap between batches and fire the attack telegraph over the un-played move.
 */
function waitForIdle(renderer: GameRenderer, store: CombatStore): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (store.isIdle() && !renderer.isAnimating()) resolve();
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
