import { describe, it, expect, beforeAll } from "bun:test";
import type { ServerMessage, SeatId } from "shared";
import { startServer, connectClient, hello, sleep, type HarnessServer, type MockClient } from "./coop-harness.js";
import { rooms } from "../room-registry.js";
import { disposeRoom } from "../room.js";
import { recoverActiveRuns } from "../room-machine.js";
import { loadRun, finalizeRun } from "../db.js";

/**
 * Lifecycle-redesign coverage: mortal games (wipe -> held Game Over), any-player Play Again, mid-game
 * leave = permanent bot, host migration on leave, pause-on-zero-humans + resume, graceful reap -> HOME,
 * crash recovery, and matchmaking (listRooms / quickMatch). The reap/crash paths are driven by directly
 * invoking the same primitives the 5-min timer / boot pass call, so they are deterministic and need no
 * global timeout override (the harness server is a shared singleton).
 */

const DIM = 0;
let server: HarnessServer;

beforeAll(async () => {
  server = await startServer();
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${server.port}/health`)).ok) return;
    } catch {
      /* not up */
    }
    await sleep(50);
  }
  throw new Error("server did not come up");
});

function isRoomState(m: ServerMessage): m is Extract<ServerMessage, { type: "roomState" }> {
  return m.type === "roomState";
}

async function createRoom(client: MockClient, capacity: 2 | 3 | 4) {
  client.send({ type: "createRoom", capacity, dimensionId: DIM });
  await client.nextOf("welcome");
  const rs = await client.waitFor(isRoomState);
  return { code: rs.room.code, runId: rs.room.runId };
}

async function startOverworld(host: MockClient) {
  host.mark();
  host.send({ type: "startGame" });
  await host.waitFor(
    (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
    { consumeBuffered: false, timeoutMs: 6000 },
  );
}

/** Solo human -> a propose onto an unexplored adjacent hex resolves instantly and enters combat. */
async function enterCombatSolo(host: MockClient) {
  host.mark();
  host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
  await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
  await host.nextOf("coopStatus", { timeoutMs: 8000 });
}

describe("co-op lifecycle redesign", () => {
  it("party wipe enters a held Game Over end state (run inactive, room NOT recycled)", async () => {
    const host = await connectClient(server);
    await hello(host, "Solo");
    const { code, runId } = await createRoom(host, 2);
    await startOverworld(host);
    await enterCombatSolo(host);

    host.mark();
    host.send({ type: "debugLose" }); // force winner = blue (party wipe)

    const gameover = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "gameover",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(gameover.room.phase).toBe("gameover");
    const over = await host.nextOf("gameOver", { timeoutMs: 4000 });
    expect(over.outcome).toBe("defeat");

    // The room stays LIVE in memory at gameover (for Play Again / Return Home), but the run is final.
    expect(rooms.get(code)?.phase).toBe("gameover");
    expect(loadRun(runId)?.active).toBe(0);

    host.close();
  });

  it("any player (not just host) can Play Again -> a fresh active run on the same room", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host, "Host");
    await hello(guest, "Guest");
    const { code, runId: wipedRun } = await createRoom(host, 2);

    guest.send({ type: "joinRoom", code, displayName: "Guest" });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);

    await startOverworld(host);
    // Two humans -> vote to enter combat.
    host.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const vote = await host.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    guest.send({ type: "castVote", proposalId: vote.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });

    host.send({ type: "debugLose" });
    await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "gameover",
      { consumeBuffered: false, timeoutMs: 8000 },
    );

    // The NON-host guest restarts.
    guest.mark();
    guest.send({ type: "playAgain" });
    const back = await guest.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 6000 },
    );
    expect(back.room.code).toBe(code); // same room/party
    expect(back.room.runId).not.toBe(wipedRun); // a fresh run
    expect(loadRun(back.room.runId)?.active).toBe(1);
    expect(loadRun(wipedRun)?.active).toBe(0);
    expect(back.room.hostSeatId).toBe("s0"); // both still connected; host unchanged

    host.close();
    guest.close();
  });

  it("mid-game leave converts the seat to a permanent bot; the leaver does NOT reclaim (goes HOME)", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host, "Host");
    await hello(guest, "Guest");
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code, displayName: "Guest" });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    await startOverworld(host);

    // Guest leaves mid-game.
    guest.mark();
    guest.send({ type: "leaveRoom" });
    await guest.nextOf("leftRoom", { fromNow: true, timeoutMs: 4000 });

    // Host sees the guest seat become a permanent bot; the party (room) lives on. (The roomState may
    // already be buffered by the time we await — the leftRoom ack is sent right after it — so scan it.)
    const after = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.seats[1]!.state === "bot",
      { timeoutMs: 4000 },
    );
    expect(after.room.seats[1]!.state).toBe("bot");
    expect(rooms.get(code)).toBeTruthy();

    // The leaver reconnecting with the SAME clientId is NOT auto-reclaimed — it lands on HOME.
    const guest2 = await connectClient(server, guest.clientId);
    const w2 = await hello(guest2, "Guest");
    expect(w2.reconnected).toBeUndefined();

    host.close();
    guest2.close();
  });

  it("when the host leaves mid-game, host migrates to another connected human", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host, "Host");
    await hello(guest, "Guest");
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code, displayName: "Guest" });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    await startOverworld(host);

    guest.mark();
    host.send({ type: "leaveRoom" });

    const migrated = await guest.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.hostSeatId === "s1",
      { consumeBuffered: false, timeoutMs: 4000 },
    );
    expect(migrated.room.hostSeatId).toBe("s1");
    expect(migrated.room.seats[0]!.state).toBe("bot"); // the departed host's seat is a bot now

    guest.close();
  });

  it("combat pauses when the last human leaves and resumes on reconnect (no unwatched cascade)", async () => {
    const host = await connectClient(server);
    await hello(host, "Solo");
    const { code } = await createRoom(host, 2);
    await startOverworld(host);
    await enterCombatSolo(host);

    // The only human drops. After the disconnect grace the seat would normally bot-drive the whole
    // encounter; instead it must PAUSE (no one is watching).
    host.close();
    await host.closed;
    await sleep(3400); // past the 3s disconnect grace

    const room = rooms.get(code);
    expect(room).toBeTruthy();
    expect(room!.phase).toBe("combat"); // NOT auto-resolved to overworld/gameover
    expect(room!.paused).toBe(true);
    expect(room!.session).not.toBeNull();

    // A human reconnects -> combat resumes.
    const host2 = await connectClient(server, host.clientId);
    const w2 = await hello(host2, "Solo");
    expect(w2.reconnected).toBeTruthy();
    await host2.nextOf("coopStatus", { timeoutMs: 6000 });
    expect(rooms.get(code)!.paused).toBe(false);

    host2.send({ type: "debugWin" });
    await host2.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 });
    host2.close();
  });

  it("graceful empty reap finalizes the run -> a later reconnect lands on HOME", async () => {
    const host = await connectClient(server);
    await hello(host, "Solo");
    const { code, runId } = await createRoom(host, 2);
    await startOverworld(host);

    host.close();
    await host.closed;
    await sleep(150);

    // Model the 5-min empty-reap timer firing (reapEmptyRoom = finalizeRun + dispose + remove).
    const room = rooms.get(code)!;
    finalizeRun(room.runId, "abandoned");
    disposeRoom(room);
    rooms.remove(room);

    expect(rooms.get(code)).toBeNull();
    expect(loadRun(runId)?.active).toBe(0);

    // Same clientId reconnect: the run is inactive, so hello welcomes room-less (HOME), no reclaim.
    const host2 = await connectClient(server, host.clientId);
    const w2 = await hello(host2, "Solo");
    expect(w2.reconnected).toBeUndefined();
    host2.close();
  });

  it("crash recovery: an active run with no in-memory room is rebuilt at boot and resumes", async () => {
    const host = await connectClient(server);
    await hello(host, "Solo");
    const { code, runId } = await createRoom(host, 2);
    await startOverworld(host);
    host.close();
    await host.closed;
    await sleep(150);

    // Model a process crash: the in-memory room is gone but the run row stays active=1 (NOT reaped).
    const room = rooms.get(code)!;
    disposeRoom(room);
    rooms.remove(room);
    expect(rooms.getByRun(runId)).toBeNull();
    expect(loadRun(runId)?.active).toBe(1);

    // Model the boot crash-recovery pass (a STARTED run is rebuilt).
    recoverActiveRuns(() => {});
    expect(rooms.getByRun(runId)).toBeTruthy();

    // The player reconnects and resumes the recovered run at the overworld.
    const host2 = await connectClient(server, host.clientId);
    const w2 = await hello(host2, "Solo");
    expect(w2.reconnected).toBeTruthy();
    expect(w2.reconnected!.seatId).toBe("s0" as SeatId);
    const rs = await host2.waitFor(isRoomState, { timeoutMs: 4000 });
    expect(rs.room.phase).toBe("overworld");
    host2.close();
  });

  it("crash recovery does NOT resurrect a never-started lobby run (it is abandoned -> HOME)", async () => {
    const host = await connectClient(server);
    await hello(host, "Lobbyer");
    const { code, runId } = await createRoom(host, 2); // lobby — NOT started
    expect(loadRun(runId)?.phase).toBe("lobby"); // the durable lifecycle SSOT (subsumes the started_at patch)

    // Model a crash caught mid-lobby: in-memory room gone, run still active=1, phase still 'lobby'.
    const room = rooms.get(code)!;
    disposeRoom(room);
    rooms.remove(room);

    recoverActiveRuns(() => {}); // boot pass
    expect(loadRun(runId)?.active).toBe(0); // abandoned, not resurrected as an overworld game
    expect(rooms.getByRun(runId)).toBeNull(); // no room rebuilt

    const host2 = await connectClient(server, host.clientId);
    const w2 = await hello(host2, "Lobbyer");
    expect(w2.reconnected).toBeUndefined(); // routed HOME
    host2.close();
  });

  it("a 'defeat' outcome survives a later empty-reap (finalization is idempotent)", async () => {
    const host = await connectClient(server);
    await hello(host, "Solo");
    const { code, runId } = await createRoom(host, 2);
    await startOverworld(host);
    await enterCombatSolo(host);
    host.send({ type: "debugLose" });
    await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "gameover",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(loadRun(runId)?.outcome).toBe("defeat");

    // The room is reaped later (all sockets gone); the abandon must NOT clobber the recorded 'defeat'.
    finalizeRun(runId, "abandoned");
    expect(loadRun(runId)?.outcome).toBe("defeat");
    expect(rooms.get(code)).toBeTruthy(); // (still in memory until reaped; assertion is on the durable row)

    host.close();
  });

  it("matchmaking: listRooms shows a joinable lobby room and drops it once started", async () => {
    const host = await connectClient(server);
    await hello(host, "Host");
    const { code } = await createRoom(host, 3);

    const browser = await connectClient(server);
    await hello(browser, "Browser");
    browser.send({ type: "listRooms" });
    const list1 = await browser.nextOf("roomList", { timeoutMs: 4000 });
    const mine1 = list1.rooms.find((r) => r.code === code);
    expect(mine1).toBeTruthy();
    expect(mine1!.totalSeats).toBe(3);
    expect(mine1!.openSeats).toBe(2); // host took one of three

    // Once the host starts, the room leaves the lobby phase and is no longer listed.
    await startOverworld(host);
    browser.mark();
    browser.send({ type: "listRooms" });
    const list2 = await browser.nextOf("roomList", { fromNow: true, timeoutMs: 4000 });
    expect(list2.rooms.find((r) => r.code === code)).toBeUndefined();

    host.close();
    browser.close();
  });

  it("matchmaking: quickMatch seats a player into an open room", async () => {
    const host = await connectClient(server);
    await hello(host, "Host");
    await createRoom(host, 3); // guarantee at least one joinable lobby room exists

    const seeker = await connectClient(server);
    await hello(seeker, "Seeker");
    seeker.mark(); // skip the hello-welcome so we read the quickMatch welcome
    seeker.send({ type: "quickMatch", dimensionId: DIM });
    const w = await seeker.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
    expect(w.reconnected).toBeTruthy(); // seated into a room (joined or freshly created)
    const rs = await seeker.waitFor(isRoomState, { timeoutMs: 4000 });
    expect(rs.room.yourSeatId).toBeTruthy();

    host.close();
    seeker.close();
  });
});
