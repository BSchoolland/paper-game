import { describe, it, expect, beforeAll } from "bun:test";
import type { ServerMessage } from "shared";
import { startServer, connectClient, hello, timeline, sleep, type HarnessServer, type MockClient } from "./coop-harness.js";

let server: HarnessServer;

beforeAll(async () => {
  server = await startServer();
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${server.port}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(50);
  }
  throw new Error("server did not come up");
});

function isRoomState(m: ServerMessage): m is Extract<ServerMessage, { type: "roomState" }> {
  return m.type === "roomState";
}

/** Assert one client's envelope stream is exactly 1..N with strictly increasing emit ordinals. */
function expectContiguous(client: MockClient): void {
  expect(client.envelopes.length).toBeGreaterThan(0);
  client.envelopes.forEach((env, i) => expect(env.seq).toBe(i + 1));
  for (let i = 1; i < client.envelopes.length; i++) {
    expect(client.envelopes[i]!.t).toBeGreaterThan(client.envelopes[i - 1]!.t);
  }
}

describe("server envelope stamping", () => {
  it("wraps every message in a ServerEnvelope with per-connection seq from 1 and monotonic t", async () => {
    const a = await connectClient(server);
    await hello(a);
    a.send({ type: "listRooms" });
    await a.nextOf("roomList");
    expectContiguous(a);
    for (const env of a.envelopes) expect(typeof env.msg.type).toBe("string");
    a.close();
  });

  it("broadcast stamps each socket independently: both streams stay contiguous", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);

    host.send({ type: "createRoom", capacity: 3, dimensionId: 0 });
    const rs = await host.waitFor(isRoomState);
    guest.send({ type: "joinRoom", code: rs.room.code });
    await guest.waitFor(isRoomState);
    // The join broadcast lands on both sockets; each copy carries that CONNECTION's next seq.
    await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.seats.filter((s) => s.state === "human-connected").length === 2,
    );

    expectContiguous(host);
    expectContiguous(guest);
    // The two connections did different amounts of traffic, so identical broadcast payloads
    // arrive under different seq numbers — the counter is per-socket, not global.
    const hostJoinSeq = host.envelopes.find(
      (e) => e.msg.type === "roomState" && e.msg.room.seats.some((s) => s.seatId === "s1" && s.state === "human-connected"),
    )!.seq;
    const guestJoinSeq = guest.envelopes.find(
      (e) => e.msg.type === "roomState" && e.msg.room.seats.some((s) => s.seatId === "s1" && s.state === "human-connected"),
    )!.seq;
    expect(hostJoinSeq).not.toBe(guestJoinSeq);

    host.close();
    guest.close();
  });

  it("a reconnecting socket restarts at seq 1 and its snapshot is timeline-noted", async () => {
    const host = await connectClient(server);
    await hello(host);
    host.send({ type: "createRoom", capacity: 2, dimensionId: 0 });
    const rs = await host.waitFor(isRoomState);
    const code = rs.room.code;

    host.mark();
    host.send({ type: "startGame" });
    await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
    );

    // Enter combat (single human: proposeMove resolves without a vote).
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    await host.nextOf("state", { timeoutMs: 8000 });

    // The combat-entry empty broadcast is annotated at the emit site.
    const emptyState = timeline(code).find((r) => r.type === "state" && r.note === "state-empty");
    expect(emptyState).toBeTruthy();
    expect(emptyState!.dir).toBe("send");

    // Drop the socket mid-combat and reclaim the seat on a fresh connection.
    host.close();
    await host.closed;
    const host2 = await connectClient(server, host.clientId);
    const w2 = await hello(host2);
    expect(w2.reconnected?.code).toBe(code);
    await host2.nextOf("state", { timeoutMs: 8000 });

    // Fresh connection => fresh counter, starting over at 1.
    expectContiguous(host2);
    // The reconnect snapshot (state with events: []) is annotated in the server timeline.
    expect(timeline(code).some((r) => r.type === "state" && r.note === "snapshot")).toBe(true);

    host2.send({ type: "debugWin" });
    await host2.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 }).catch(() => null);
    host2.close();
  }, 30000);
});
