import type { ServerWebSocket } from "bun";
import type { GameEvent, GameState, PlayerAction, TeamId } from "shared";
import {
  createInitialGameState,
  createPveGameState,
  resolveAction,
  serializeGameState,
  AiController,
  getVisibleHexes,
  getHexIcon,
  hexKey,
  isAdjacent,
  parseHexKey,
} from "shared";
import type { HexCoord, HexMapState, HexIconType } from "shared";
import { loadCollisionGrid } from "./collision-loader.js";
import {
  saveExploredHex,
  loadExploredHexes,
  clearExploredHexes,
  seedDiscovery,
} from "./db.js";

seedDiscovery(15);

type GameMode = "pvp" | "pve";
type Phase = "map" | "combat";

interface SocketData {
  team: TeamId | null;
  mode: GameMode;
  hexMap: HexMapState;
  phase: Phase;
  pendingHex: HexCoord | null;
  visitedThisRun: Set<string>;
}

function loadHexMapFromDb(): HexMapState {
  const origin: HexCoord = { q: 0, r: 0 };
  const hexes = loadExploredHexes();
  if (!(hexKey(origin) in hexes)) {
    hexes[hexKey(origin)] = "explored";
    saveExploredHex(origin);
  }
  const icons: Record<string, HexIconType> = { [hexKey(origin)]: "town" };
  return { playerPos: origin, hexes, icons };
}

let gameMode: GameMode = "pvp";
let state: GameState = createInitialGameState();
await loadCollisionGrid(state.grid, state.mapDefinition.objects);

async function resetCombatState() {
  state = gameMode === "pve" ? createPveGameState() : createInitialGameState();
  await loadCollisionGrid(state.grid, state.mapDefinition.objects);
}

const aiTeam: TeamId = "blue";
const ai = new AiController();
const players = new Map<TeamId, ServerWebSocket<SocketData>>();

function broadcast(msg: object) {
  const json = JSON.stringify(msg);
  for (const ws of players.values()) {
    ws.send(json);
  }
}

function broadcastState(events: readonly GameEvent[]) {
  broadcast({ type: "state", state: serializeGameState(state), events });
}

function sendTo(ws: ServerWebSocket<SocketData>, msg: object) {
  ws.send(JSON.stringify(msg));
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
  if (!state.winner || ws.data.phase !== "combat") return;

  const won = state.winner === "red";
  const hexMap = ws.data.hexMap;

  if (won && ws.data.pendingHex) {
    const target = ws.data.pendingHex;
    const tk = hexKey(target);
    const newHexes = { ...hexMap.hexes, [tk]: "explored" as const };
    ws.data.hexMap = { playerPos: target, hexes: newHexes, icons: hexMap.icons };
    ws.data.visitedThisRun.add(tk);
    saveExploredHex(target);
  } else {
    ws.data.hexMap = { playerPos: { q: 0, r: 0 }, hexes: hexMap.hexes, icons: hexMap.icons };
    ws.data.visitedThisRun = new Set([hexKey({ q: 0, r: 0 })]);
  }

  ws.data.phase = "map";
  ws.data.pendingHex = null;
  sendTo(ws, { type: "hexCombatResult", won });
  sendHexMapState(ws);
}

function runAiTurn(ws: ServerWebSocket<SocketData>) {
  if (gameMode !== "pve") return;
  if (state.activeTeam !== aiTeam) return;
  if (state.winner) return;

  const actions = ai.computeActions(state, aiTeam);
  for (const action of actions) {
    const result = resolveAction(state, action);
    if (result.state !== state) {
      state = result.state;
      broadcastState(result.events);
    }
    if (state.winner) {
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
    if (url.pathname === "/ws") {
      const mode = (url.searchParams.get("mode") as GameMode) || "pvp";
      const upgraded = server.upgrade(req, {
        data: {
          team: null,
          mode,
          hexMap: loadHexMapFromDb(),
          phase: (mode === "pve" ? "map" : "combat") as Phase,
          pendingHex: null,
          visitedThisRun: new Set([hexKey({ q: 0, r: 0 })]),
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
        await resetCombatState();
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

      if (gameMode === "pve") {
        sendHexMapState(ws);
      } else {
        sendTo(ws, {
          type: "state",
          state: serializeGameState(state),
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
          await resetCombatState();
          sendTo(ws, { type: "hexCombatStart" });
          sendTo(ws, {
            type: "state",
            state: serializeGameState(state),
            events: [],
          });
        }
        return;
      }

      if (msg.type === "action") {
        const result = resolveAction(state, msg.action);
        if (result.state !== state) {
          state = result.state;
          broadcastState(result.events);
          if (state.winner) {
            checkCombatEnd(ws);
          } else {
            runAiTurn(ws);
          }
        }
      }

      if (msg.type === "debugWin" && ws.data.phase === "combat") {
        state = { ...state, winner: "red" };
        broadcastState([]);
        checkCombatEnd(ws);
      }

      if (msg.type === "reset") {
        if (gameMode === "pve" && ws.data.phase === "combat") {
          ws.data.phase = "map";
          ws.data.pendingHex = null;
          ws.data.hexMap = {
            playerPos: { q: 0, r: 0 },
            hexes: ws.data.hexMap.hexes,
            icons: ws.data.hexMap.icons,
          };
          ws.data.visitedThisRun = new Set([hexKey({ q: 0, r: 0 })]);
          sendTo(ws, { type: "hexCombatResult", won: false });
          sendHexMapState(ws);
        } else if (gameMode === "pve" && ws.data.phase === "map") {
          clearExploredHexes();
          ws.data.hexMap = loadHexMapFromDb();
          ws.data.visitedThisRun = new Set([hexKey({ q: 0, r: 0 })]);
          sendHexMapState(ws);
        } else {
          await resetCombatState();
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
