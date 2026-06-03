import type { ServerWebSocket } from "bun";
import type { GameEvent, TeamId } from "shared";
import {
  getVisibleHexes,
  getHexIcon,
  hexKey,
  isAdjacent,
  parseHexKey,
  isDecorationHex,
  createInventory,
  equipFromBag,
  unequipItem,
  getItemAbilities,
  getAnimSet,
  shouldAutoEndTurn,
} from "shared";
import type { HexCoord, HexMapState, HexIconType, InventoryState, ItemDefinition } from "shared";
import { EncounterSession } from "./encounter-session.js";
import {
  saveExploredHex,
  loadExploredHexes,
  clearExploredHexes,
  seedDiscovery,
  startNewRun,
  loadDimension,
  loadEnemyTemplateRegistry,
  loadItems,
} from "./db.js";
import { seedDimension0 } from "./seed.js";
import { seedDimension1 } from "./seed-dimension-1.js";
import { seedDimension2 } from "./seed-dimension-2.js";
import { seedDimension3 } from "./seed-dimension-3.js";
import { seedDimension501 } from "./seed-dimension-501.js";
import { join } from "path";
import { existsSync } from "fs";

export function initSeeds(): void {
  seedDiscovery(15);
  seedDimension0();
  seedDimension1();
  seedDimension2();
  seedDimension3();
  seedDimension501();
}

// Auto-seed on normal boot. Tests/harnesses set GAME_SKIP_SEED=1 (with an
// in-memory GAME_DB_PATH) to import the server without touching disk seeds.
if (process.env.GAME_SKIP_SEED !== "1") {
  initSeeds();
}

type GameMode = "pvp" | "pve" | "duel";
type Phase = "map" | "combat";

// Trimmed playtest loadout: the debug Test Rod plus a few familiar items, nothing else.
const STARTER_ITEM_IDS = [
  "abilitytest", "short-sword", "bow", "staff", "round-shield",
  // dimension 1 – The Shallows
  "barbed-harpoon", "urchin-flail", "crab-claw-gauntlet",
  // dimension 2 – The Gloom Hollows
  "stalactite-spear", "fungal-mace", "geode-knuckles",
  // dimension 3 – The Gilt Barrens
  "sandhorn-bow", "raiders-twinblade", "mirage-staff",
];

function buildDefaultInventory(dimensionId: number): InventoryState {
  const merged = { ...loadItems(0), ...loadItems(1), ...loadItems(2), ...loadItems(3), ...loadItems(dimensionId) };

  const picked: ItemDefinition[] = [];
  for (const id of STARTER_ITEM_IDS) {
    const item = merged[id];
    if (item) picked.push(item);
  }
  return createInventory(picked);
}

interface SocketData {
  team: TeamId | null;
  mode: GameMode;
  dimensionId: number;
  hexMap: HexMapState;
  phase: Phase;
  pendingHex: HexCoord | null;
  visitedThisRun: Set<string>;
  runId: number;
  inventory: InventoryState;
}

const ORIGIN: HexCoord = { q: 0, r: 0 };
const ORIGIN_KEY = hexKey(ORIGIN);

function loadHexMapFromDb(): HexMapState {
  const hexes = loadExploredHexes();
  if (!(ORIGIN_KEY in hexes)) {
    hexes[ORIGIN_KEY] = "explored";
    saveExploredHex(ORIGIN);
  }
  const icons: Record<string, HexIconType> = { [ORIGIN_KEY]: "town" };
  return { playerPos: ORIGIN, hexes, icons };
}

function freshVisitedSet(): Set<string> {
  return new Set([ORIGIN_KEY]);
}

function resetToOrigin(data: SocketData): void {
  data.hexMap = { ...data.hexMap, playerPos: ORIGIN };
  data.visitedThisRun = freshVisitedSet();
  data.runId = startNewRun();
  data.phase = "map";
  data.pendingHex = null;
}

function exploreHex(data: SocketData, target: HexCoord): void {
  const tk = hexKey(target);
  data.hexMap = {
    ...data.hexMap,
    playerPos: target,
    hexes: { ...data.hexMap.hexes, [tk]: "explored" as const },
  };
  data.visitedThisRun.add(tk);
  saveExploredHex(target);
}

let gameMode: GameMode = "pvp";
let session = await EncounterSession.create(gameMode);

const aiTeam: TeamId = "blue";
const players = new Map<TeamId, ServerWebSocket<SocketData>>();

function broadcast(msg: object) {
  const json = JSON.stringify(msg);
  for (const ws of players.values()) {
    ws.send(json);
  }
}

function broadcastState(events: readonly GameEvent[]) {
  broadcast({ type: "state", state: session.serialize(), events });
}

function sendTo(ws: ServerWebSocket<SocketData>, msg: object) {
  ws.send(JSON.stringify(msg));
}

function sendInventory(ws: ServerWebSocket<SocketData>) {
  sendTo(ws, { type: "inventory", inventory: ws.data.inventory });
}

function sendHexMapState(ws: ServerWebSocket<SocketData>) {
  const visible = getVisibleHexes(ws.data.hexMap);
  const icons: Record<string, HexIconType> = {};
  for (const key of Object.keys(visible)) {
    const coord = parseHexKey(key);
    const icon = getHexIcon(coord, ws.data.hexMap.icons);
    if (icon) icons[key] = icon;
  }
  sendTo(ws, {
    type: "hexMapState",
    hexMap: { playerPos: ws.data.hexMap.playerPos, hexes: visible, icons },
  });
}

function checkCombatEnd(ws: ServerWebSocket<SocketData>) {
  if (!session.state.winner || ws.data.phase !== "combat") return;

  const won = session.state.winner === "red";

  if (won && ws.data.pendingHex) {
    exploreHex(ws.data, ws.data.pendingHex);
    ws.data.phase = "map";
    ws.data.pendingHex = null;
  } else {
    resetToOrigin(ws.data);
  }

  sendTo(ws, { type: "hexCombatResult", won });
  sendHexMapState(ws);
}

function runAiTurn(ws: ServerWebSocket<SocketData>) {
  if (gameMode !== "pve" && gameMode !== "duel") return;
  if (session.state.activeTeam !== aiTeam || session.state.winner) {
    console.log(`[AI] skip runAiTurn — activeTeam=${session.state.activeTeam} aiTeam=${aiTeam} winner=${session.state.winner}`);
    return;
  }
  console.log(`[AI] startAiTurn team=${aiTeam} turn=${session.state.turnNumber}`);
  session.startAiTurn(aiTeam);
  driveAiSteps(ws);
}

function driveAiSteps(ws: ServerWebSocket<SocketData>) {
  let safety = 0;
  while (true) {
    if (++safety > 200) {
      console.error("[AI] driveAiSteps safety break — too many iterations");
      return;
    }
    const step = session.stepAi();
    if (step.type === "done") {
      console.log(`[AI] step done — activeTeam=${session.state.activeTeam}`);
      return;
    }
    if (step.type === "defendPrompt") {
      console.log(`[AI] step defendPrompt — attacker=${step.attackerId} targets=${step.targetIds.join(",")}`);
      sendTo(ws, step);
      return;
    }
    console.log(`[AI] step events=${step.events.map(e => e.type).join(",")} won=${step.won}`);
    broadcast({ type: "state", state: step.serializedState, events: step.events });
    if (step.won) {
      checkCombatEnd(ws);
      return;
    }
  }
}

const PORT = Number(process.env.PORT) || 3001;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", uptime: process.uptime() });
    }
    if (url.pathname === "/ws") {
      const mode = (url.searchParams.get("mode") as GameMode) || "pvp";
      const dimensionId = parseInt(url.searchParams.get("dim") ?? "0", 10) || 0;
      const upgraded = server.upgrade(req, {
        data: {
          team: null,
          mode,
          dimensionId,
          hexMap: loadHexMapFromDb(),
          phase: (mode === "pve" ? "map" : "combat") as Phase,
          pendingHex: null,
          visitedThisRun: freshVisitedSet(),
          runId: startNewRun(),
          inventory: buildDefaultInventory(dimensionId),
        },
      });
      if (!upgraded)
        return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined;
    }
    const spritesPrefix = "/api/sprites/";
    if (url.pathname.startsWith(spritesPrefix)) {
      const relativePath = url.pathname.slice(spritesPrefix.length);
      if (relativePath.includes("..")) return new Response("Forbidden", { status: 403 });
      const filePath = join(import.meta.dir, "..", "sprites", relativePath);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname.startsWith("/api/dimensions/")) {
      const dimId = parseInt(url.pathname.split("/")[3]!, 10);
      if (isNaN(dimId)) return new Response("Invalid dimension id", { status: 400 });
      const dimension = loadDimension(dimId);
      if (!dimension) return new Response("Dimension not found", { status: 404 });
      const registry = loadEnemyTemplateRegistry(dimId);
      const spritePaths: string[] = [];
      for (const template of Object.values(registry)) {
        if (template.sprites) {
          for (const path of Object.values(template.sprites)) {
            if (!spritePaths.includes(path)) spritePaths.push(path);
          }
        }
      }
      const structureSprites: Record<string, string> = {};
      for (const s of dimension.structures) {
        if (s.spritePath) structureSprites[s.name] = s.spritePath;
      }
      const dimItems = loadItems(dimId);
      const itemSprites: Record<string, string> = {};
      const itemsRoot = join(import.meta.dir, "..", "..", "client", "public");
      for (const item of Object.values(dimItems)) {
        const prefix = item.dimensionId === 0 ? "" : `dimension-${item.dimensionId}/`;
        const rel = `sprites/items/${prefix}${item.sprite}`;
        const ext = existsSync(join(itemsRoot, `${rel}.png`)) ? "png" : "webp";
        itemSprites[item.sprite] = `${rel}.${ext}`;
      }
      return Response.json({
        id: dimId,
        name: dimension.name,
        spritePaths,
        structureSprites,
        itemSprites,
        backgroundPath: dimension.backgroundPath,
        hexDecorationsPath: dimension.hexDecorationsPath,
      }, { headers: CORS_HEADERS });
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    async open(ws: ServerWebSocket<SocketData>) {
      const newMode = ws.data.mode;

      if (newMode !== gameMode || ((newMode === "pve" || newMode === "duel") && players.has("red"))) {
        const old = players.get("red");
        if (old) {
          old.close();
          players.delete("red");
        }
        const oldBlue = players.get("blue");
        if (oldBlue) {
          oldBlue.close();
          players.delete("blue");
        }
        gameMode = newMode;
        session = await EncounterSession.create(gameMode);
      }

      let team: TeamId | null = null;
      if (!players.has("red")) {
        team = "red";
      } else if (!players.has("blue") && gameMode === "pvp") {
        team = "blue";
      }

      if (!team) {
        sendTo(ws, { type: "error", message: "Game is full" });
        ws.close();
        return;
      }

      ws.data.team = team;
      players.set(team, ws);
      sendTo(ws, { type: "team", team });

      sendInventory(ws);

      if (gameMode === "pve") {
        sendHexMapState(ws);
      } else {
        sendTo(ws, {
          type: "state",
          state: session.serialize(),
          events: [],
        });
      }

      console.log(`${team} connected (${gameMode})`);
    },

    async message(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
      const team = ws.data.team;
      if (!team) return;

      let msg: any;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }

      if (
        msg.type === "hexMove" &&
        gameMode === "pve" &&
        ws.data.phase === "map"
      ) {
        const target: HexCoord = msg.target;
        if (!isAdjacent(ws.data.hexMap.playerPos, target)) return;

        const visible = getVisibleHexes(ws.data.hexMap);
        const tk = hexKey(target);
        if (!(tk in visible)) return;

        if (ws.data.visitedThisRun.has(tk)) {
          ws.data.hexMap = { ...ws.data.hexMap, playerPos: target };
          sendHexMapState(ws);
        } else {
          ws.data.phase = "combat";
          ws.data.pendingHex = target;
          const hexType = getHexIcon(target, ws.data.hexMap.icons)
            ?? (isDecorationHex(target) ? "dense-wilderness" : "wilderness");
          const itemAbilities = getItemAbilities(ws.data.inventory.equipped);
          const animSet = getAnimSet(ws.data.inventory.equipped);
          session = await EncounterSession.create(gameMode, hexType, target, ws.data.runId, itemAbilities, animSet, ws.data.inventory.equipped, ws.data.inventory.attachments, ws.data.dimensionId);
          console.log(`encounter run=${ws.data.runId} hex=(${target.q},${target.r}) type=${hexType}`);
          sendTo(ws, { type: "hexCombatStart" });
          sendTo(ws, {
            type: "state",
            state: session.serialize(),
            events: [],
          });
        }
        return;
      }

      if (msg.type === "action") {
        // Defense in depth: drop player actions when it isn't the player's turn. In PvE/duel
        // the human is always red; a stray endTurn or ability during the AI turn (e.g. a
        // focused End Turn button activating on space-press) would otherwise flip the active
        // team mid-AI-resolution and break the pending-defense state machine.
        if ((gameMode === "pve" || gameMode === "duel") && session.state.activeTeam !== "red") {
          console.log(`[ACTION] dropped ${msg.action.type} — activeTeam=${session.state.activeTeam}`);
          // Ack with the authoritative state so the client reconciles out of its optimistic
          // "submittingAction" lock instead of freezing on a dropped action.
          sendTo(ws, { type: "state", state: session.serialize(), events: [] });
          return;
        }
        console.log(`[ACTION] ${msg.action.type} activeTeam=${session.state.activeTeam}`);
        const { changed, events } = session.applyAction(msg.action);
        console.log(`[ACTION] result changed=${changed} events=${events.map(e => e.type).join(",")}`);
        if (changed) {
          let allEvents = events;
          if (msg.action.type !== "endTurn" && !session.state.winner && shouldAutoEndTurn(session.state)) {
            const endResult = session.applyAction({ type: "endTurn" });
            if (endResult.changed) {
              allEvents = [...allEvents, ...endResult.events];
            }
          }
          broadcastState(allEvents);
          if (session.state.winner) {
            checkCombatEnd(ws);
          } else {
            runAiTurn(ws);
          }
        } else {
          // No-op (illegal move into a wall, unaffordable, etc.): the resolver changed nothing
          // and would otherwise send no reply, stranding the client in "submittingAction". Ack
          // with the current state so it unlocks.
          sendTo(ws, { type: "state", state: session.serialize(), events: [] });
        }
      }

      if (msg.type === "defendResult" && session.pendingDefend) {
        console.log(`[DEFEND] result received: ${JSON.stringify(msg.results)}`);
        const step = session.resolveDefend(msg.results ?? {});
        if (step.type === "events") {
          broadcast({ type: "state", state: step.serializedState, events: step.events });
          if (step.won) {
            checkCombatEnd(ws);
          } else {
            driveAiSteps(ws);
          }
        } else if (step.type === "defendPrompt") {
          sendTo(ws, step);
        } else {
          driveAiSteps(ws);
        }
      }

      if (msg.type === "debugWin" && ws.data.phase === "combat") {
        session.state = { ...session.state, winner: "red" };
        broadcastState([]);
        checkCombatEnd(ws);
      }

      if (msg.type === "equip" && typeof msg.bagIndex === "number") {
        ws.data.inventory = equipFromBag(ws.data.inventory, msg.bagIndex);
        sendInventory(ws);
        return;
      }

      if (msg.type === "unequip" && typeof msg.equippedIndex === "number") {
        ws.data.inventory = unequipItem(ws.data.inventory, msg.equippedIndex);
        sendInventory(ws);
        return;
      }

      if (msg.type === "updateAttachment" && typeof msg.itemId === "string" && msg.attachment) {
        ws.data.inventory = {
          ...ws.data.inventory,
          attachments: {
            ...ws.data.inventory.attachments,
            [msg.itemId]: msg.attachment,
          },
        };
        sendInventory(ws);
        return;
      }

      if (msg.type === "reset") {
        if (gameMode === "pve" && ws.data.phase === "combat") {
          resetToOrigin(ws.data);
          sendTo(ws, { type: "hexCombatResult", won: false });
          sendHexMapState(ws);
        } else if (gameMode === "pve" && ws.data.phase === "map") {
          clearExploredHexes();
          ws.data.hexMap = loadHexMapFromDb();
          ws.data.visitedThisRun = freshVisitedSet();
          ws.data.runId = startNewRun();
          sendHexMapState(ws);
        } else {
          session = await EncounterSession.create(gameMode);
          broadcastState([]);
          runAiTurn(ws);
        }
      }
    },

    close(ws: ServerWebSocket<SocketData>) {
      const team = ws.data.team;
      if (team) {
        players.delete(team);
        console.log(`${team} disconnected`);
      }
    },
  },
});

console.log(`Game server running on port ${PORT}`);
