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
  getEquippedWeapon,
  ITEMS,
} from "shared";
import type { HexCoord, HexMapState, HexIconType, InventoryState } from "shared";
import { EncounterSession } from "./encounter-session.js";
import {
  saveExploredHex,
  loadExploredHexes,
  clearExploredHexes,
  seedDiscovery,
  startNewRun,
} from "./db.js";

seedDiscovery(15);

type GameMode = "pvp" | "pve";
type Phase = "map" | "combat";

const DEFAULT_INVENTORY = createInventory([
  ITEMS["short-sword"]!,
  ITEMS["spear"]!,
  ITEMS["bow"]!,
  ITEMS["potion"]!,
]);

interface SocketData {
  team: TeamId | null;
  mode: GameMode;
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
  if (gameMode !== "pve") return;

  const results = session.runAi(aiTeam);
  for (const { serializedState, events, won } of results) {
    broadcast({ type: "state", state: serializedState, events });
    if (won) {
      checkCombatEnd(ws);
      break;
    }
  }
}

const PORT = Number(process.env.PORT) || 3001;

Bun.serve({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", uptime: process.uptime() });
    }
    if (url.pathname === "/ws") {
      const mode = (url.searchParams.get("mode") as GameMode) || "pvp";
      const upgraded = server.upgrade(req, {
        data: {
          team: null,
          mode,
          hexMap: loadHexMapFromDb(),
          phase: (mode === "pve" ? "map" : "combat") as Phase,
          pendingHex: null,
          visitedThisRun: freshVisitedSet(),
          runId: startNewRun(),
          inventory: DEFAULT_INVENTORY,
        },
      });
      if (!upgraded)
        return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined;
    }
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    async open(ws: ServerWebSocket<SocketData>) {
      const newMode = ws.data.mode;

      if (newMode !== gameMode || (newMode === "pve" && players.has("red"))) {
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
          const eqWeapon = getEquippedWeapon(ws.data.inventory);
          const weapon = eqWeapon?.type === "weapon" ? eqWeapon.weapon : undefined;
          session = await EncounterSession.create(gameMode, hexType, target, ws.data.runId, weapon);
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
        const { changed, events } = session.applyAction(msg.action);
        if (changed) {
          broadcastState(events);
          if (session.state.winner) {
            checkCombatEnd(ws);
          } else {
            runAiTurn(ws);
          }
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
