import type { ServerWebSocket } from "bun";
import type { GameState, PlayerAction, TeamId } from "shared";
import { createInitialGameState, resolveAction, serializeGameState } from "shared";

interface SocketData {
  team: TeamId | null;
}

let state: GameState = createInitialGameState();
const players = new Map<TeamId, ServerWebSocket<SocketData>>();

function broadcast(msg: object) {
  const json = JSON.stringify(msg);
  for (const ws of players.values()) {
    ws.send(json);
  }
}

function broadcastState() {
  broadcast({ type: "state", state: serializeGameState(state) });
}

const PORT = Number(process.env.PORT) || 3001;

Bun.serve({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, { data: { team: null } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined;
    }
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws: ServerWebSocket<SocketData>) {
      let team: TeamId | null = null;
      if (!players.has("red")) {
        team = "red";
      } else if (!players.has("blue")) {
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
      ws.send(JSON.stringify({ type: "state", state: serializeGameState(state) }));
      console.log(`${team} connected`);
    },

    message(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
      const team = ws.data.team;
      if (!team) return;

      let msg: { type: string; action: PlayerAction };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }

      if (msg.type === "action") {
        const next = resolveAction(state, msg.action);
        if (next !== state) {
          state = next;
          broadcastState();
        }
      }

      if (msg.type === "reset") {
        state = createInitialGameState();
        broadcastState();
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
