import type { ServerWebSocket } from "bun";
import type { GameEvent, GameState, PlayerAction, TeamId } from "shared";
import { createInitialGameState, createPveGameState, resolveAction, serializeGameState, AiController } from "shared";
import { loadCollisionGrid } from "./collision-loader.js";

type GameMode = "pvp" | "pve";

interface SocketData {
  team: TeamId | null;
  mode: GameMode;
}

let gameMode: GameMode = "pvp";
let state: GameState = createInitialGameState();
await loadCollisionGrid(state.grid, state.mapDefinition.objects);

async function resetState() {
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

function runAiTurn() {
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
    if (state.winner) break;
  }
}

const PORT = Number(process.env.PORT) || 3001;

Bun.serve({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const mode = (url.searchParams.get("mode") as GameMode) || "pvp";
      const upgraded = server.upgrade(req, { data: { team: null, mode } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined;
    }
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    async open(ws: ServerWebSocket<SocketData>) {
      const newMode = ws.data.mode;

      if (newMode !== gameMode || (newMode === "pve" && players.has("red"))) {
        const old = players.get("red");
        if (old) { old.close(); players.delete("red"); }
        const oldBlue = players.get("blue");
        if (oldBlue) { oldBlue.close(); players.delete("blue"); }
        gameMode = newMode;
        await resetState();
      }

      let team: TeamId | null = null;
      if (!players.has("red")) {
        team = "red";
      } else if (!players.has("blue") && gameMode === "pvp") {
        team = "blue";
      }

      if (!team) {
        ws.send(JSON.stringify({ type: "error", message: "Game is full" }));
        ws.close();
        return;
      }

      ws.data.team = team;
      players.set(team, ws);
      ws.send(JSON.stringify({ type: "team", team }));
      ws.send(JSON.stringify({ type: "state", state: serializeGameState(state), events: [] }));
      console.log(`${team} connected (${gameMode})`);
    },

    async message(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
      const team = ws.data.team;
      if (!team) return;

      let msg: { type: string; action: PlayerAction };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }

      if (msg.type === "action") {
        const result = resolveAction(state, msg.action);
        if (result.state !== state) {
          state = result.state;
          broadcastState(result.events);
          runAiTurn();
        }
      }

      if (msg.type === "reset") {
        await resetState();
        broadcastState([]);
        runAiTurn();
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
