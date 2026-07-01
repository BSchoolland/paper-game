import { describe, it, expect } from "bun:test";

process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const accounts = await import("../accounts.js");
accounts.seedTitles();
const { handleLogin } = await import("../auth-handlers.js");
import type { ServerWebSocket } from "bun";
import type { SeatId, ServerEnvelope } from "shared";
import type { SocketData } from "../room.js";

function fakeSocket(data: SocketData): { ws: ServerWebSocket<SocketData>; sent: ServerEnvelope[] } {
  const sent: ServerEnvelope[] = [];
  const ws = {
    data,
    readyState: 1,
    remoteAddress: "127.0.0.1",
    send(payload: string) {
      sent.push(JSON.parse(payload) as ServerEnvelope);
      return payload.length;
    },
  } as unknown as ServerWebSocket<SocketData>;
  return { ws, sent };
}

describe("login vs joinRoom race (§4.4 AUTH_IN_ROOM across the verify await)", () => {
  it("a seat bound mid-verify aborts the account switch with AUTH_IN_ROOM", async () => {
    await accounts.registerAccount("ClaimedUser", "correcthorsebattery");

    const guest = accounts.resolveGuestAccount("race-login-dev");
    const { ws, sent } = fakeSocket({
      clientId: "race-login-dev",
      sessionToken: "",
      roomCode: null, // at HOME: pre-await AUTH_IN_ROOM guard passes
      seatId: null,
      seq: 0,
      accountId: guest.id,
      authToken: accounts.mintSession(guest.id),
    });

    // Fire login; do NOT await — routeMessage dispatches it as `void handleLogin(ws, msg)`.
    const login = handleLogin(ws, {
      type: "login",
      username: "ClaimedUser",
      password: "correcthorsebattery",
    });

    // Synchronously simulate handleJoinRoom running during the Bun.password.verify await:
    // it binds the seat to ws.data.accountId (the guest) and sets roomCode/seatId.
    const seatBoundAccountId = ws.data.accountId;
    ws.data.roomCode = "ABCD";
    ws.data.seatId = "s0" as SeatId;

    await login;

    // The seat keeps its frozen guest attribution AND the socket account never swaps out from
    // under it — the login is rejected by the post-await AUTH_IN_ROOM re-check.
    expect(seatBoundAccountId).toBe(guest.id);
    expect(ws.data.accountId).toBe(guest.id);
    const err = sent.map((e) => e.msg).find((m) => m.type === "error");
    expect(err).toMatchObject({ type: "error", code: "AUTH_IN_ROOM" });
  });
});
