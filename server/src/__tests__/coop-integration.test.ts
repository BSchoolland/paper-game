import { describe, it, expect, beforeAll } from "bun:test";
import type { ServerMessage, SeatId, Entity, GameState } from "shared";
import { startServer, connectClient, hello, sleep, type HarnessServer, type MockClient } from "./coop-harness.js";
import { rooms } from "../room-registry.js";

const DIM = 0; // seeded dimension with real encounters

let server: HarnessServer;

beforeAll(async () => {
  server = await startServer();
  // health-check the booted instance
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

// --- small helpers built on the harness ---

function isRoomState(m: ServerMessage): m is Extract<ServerMessage, { type: "roomState" }> {
  return m.type === "roomState";
}

async function createRoom(client: MockClient, capacity: 2 | 3 | 4) {
  client.send({ type: "createRoom", capacity, dimensionId: DIM });
  const welcome = await client.nextOf("welcome");
  const roomState = await client.waitFor(isRoomState);
  return { welcome, code: roomState.room.code, roomState };
}

async function startAndReachOverworld(host: MockClient) {
  host.mark();
  host.send({ type: "startGame" });
  // overworld roomState + hexMapState
  const rs = await host.waitFor(
    (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
  );
  await host.nextOf("hexMapState");
  return rs;
}

/** Move the party onto an unexplored adjacent hex (single human resolves instantly), then await combat. */
async function enterCombat(host: MockClient, others: MockClient[] = []) {
  const target = { q: 1, r: 0 }; // adjacent to origin, visible (seeded radius-15), not cleared
  for (const c of [host, ...others]) c.mark();
  host.send({ type: "proposeMove", target });
  // single human path resolves instantly; multi-human needs votes (caller handles)
  return target;
}

describe("co-op integration lifecycle", () => {
  it("hello -> welcome carries a session token", async () => {
    const a = await connectClient(server);
    const w = await hello(a);
    expect(w.type).toBe("welcome");
    expect(typeof w.sessionToken).toBe("string");
    expect(w.sessionToken.length).toBeGreaterThan(0);
    a.close();
  });

  it("create + join: roster shows two humans; start bot-fills the empty seat; party reaches overworld", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);

    const { code, roomState } = await createRoom(host, 3);
    expect(roomState.room.seats[0]!.state).toBe("human-connected");
    expect(roomState.room.hostSeatId).toBe("s0");
    expect(roomState.room.yourSeatId).toBe("s0");

    // guest joins by code
    guest.mark();
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    const guestRs = await guest.waitFor(isRoomState);
    expect(guestRs.room.yourSeatId).toBe("s1");

    // host now sees two humans
    const hostRoster = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" &&
        m.room.seats.filter((s) => s.state === "human-connected").length === 2,
    );
    expect(hostRoster.room.seats.filter((s) => s.state === "human-connected").length).toBe(2);
    expect(hostRoster.room.seats[2]!.state).toBe("open");

    // host starts; the empty seat (s2) becomes a bot, party in overworld
    const overworld = await startAndReachOverworld(host);
    expect(overworld.room.phase).toBe("overworld");
    expect(overworld.room.seats[2]!.state).toBe("bot");
    expect(overworld.room.seats.filter((s) => s.state === "human-connected").length).toBe(2);

    host.close();
    guest.close();
  });

  it("lobby leave clears the seat's account identity; bot-fill + host reset survive it", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    const guestWelcome = await hello(guest);
    const guestAccountId = guestWelcome.auth.accountId;

    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.seats[1]?.accountId === guestAccountId,
    );

    // Leaver's identity must not linger on the reopened seat (accountId/level/title all null).
    host.mark();
    guest.send({ type: "leaveRoom" });
    await guest.nextOf("leftRoom");
    const reopened = await host.nextOf("roomState", { fromNow: true });
    expect(reopened.room.seats[1]!.state).toBe("open");
    expect(reopened.room.seats[1]!.accountId).toBeNull();
    expect(reopened.room.seats[1]!.level).toBeNull();
    expect(reopened.room.seats[1]!.equippedTitleId).toBeNull();

    // Start bot-fills the reopened seat; the host reset re-persists every seat and must complete
    // (a stale accountId on the bot seat would throw in upsertRunSeat mid-run-swap).
    const overworld = await startAndReachOverworld(host);
    const oldRunId = overworld.room.runId;
    host.send({ type: "reset" });
    const afterReset = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.runId !== oldRunId,
      { consumeBuffered: false },
    );
    expect(afterReset.room.phase).toBe("overworld");
    expect(afterReset.room.seats[1]!.state).toBe("bot");
    expect(afterReset.room.seats[1]!.accountId).toBeNull();

    host.close();
    guest.close();
  });

  it("solo: create + start with bot-fill, enter combat with per-seat heroes carrying controllerId", async () => {
    const host = await connectClient(server);
    await hello(host);
    await createRoom(host, 2);
    await startAndReachOverworld(host);

    // single human -> propose resolves instantly -> combat
    host.mark();
    await enterCombat(host);
    const combatStart = await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    expect(combatStart.encounterHex).toEqual({ q: 1, r: 0 });

    const state = await host.nextOf("state", { timeoutMs: 8000 });
    const entities = state.state.entities;
    const s0Hero = entities["s0-hero"];
    const s1Hero = entities["s1-hero"];
    expect(s0Hero).toBeTruthy();
    expect(s1Hero).toBeTruthy();
    expect(s0Hero!.controllerId).toBe("s0");
    expect(s1Hero!.controllerId).toBe("s1");
    expect(s0Hero!.teamId).toBe("red");
    // there is at least one blue enemy
    expect(Object.values(entities).some((e) => e.teamId === "blue")).toBe(true);

    // coopStatus reports the player phase, s0 human, s1 bot
    const coop = await host.nextOf("coopStatus", { timeoutMs: 8000 });
    expect(coop.coop.phase).toBe("player");
    const s0Status = coop.coop.seats.find((s) => s.seatId === "s0")!;
    const s1Status = coop.coop.seats.find((s) => s.seatId === "s1")!;
    expect(s0Status.controller).toBe("human");
    expect(s1Status.controller).toBe("ai");

    host.close();
  });

  it("community discovery is GLOBAL per dimension: a hex one run clears is discovered for a later separate room, yet still triggers combat in that new run (per-run cleared gate)", async () => {
    const TARGET = { q: 1, r: 0 };
    const tk = `${TARGET.q},${TARGET.r}`;

    // Run A: enter combat at TARGET, win it, return to overworld -> TARGET is community-discovered.
    const a = await connectClient(server);
    await hello(a);
    const { code: codeA } = await createRoom(a, 2);
    await startAndReachOverworld(a);
    a.mark();
    await enterCombat(a);
    await a.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    a.send({ type: "debugWin" });
    await a.nextOf("combatEnd", { fromNow: true, timeoutMs: 8000 });
    await a.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(rooms.get(codeA)!.hexMap.hexes[tk]).toBe("explored");
    a.close();
    await a.closed;

    // Run B: a brand-new room in the SAME dimension. Its hexMapState already shows TARGET explored
    // (community-shared), even though run B has fought nothing.
    const b = await connectClient(server);
    await hello(b);
    const { code: codeB } = await createRoom(b, 2);
    const overworld = await startAndReachOverworld(b);
    expect(overworld.room.code).toBe(codeB);
    const hexMap = await b.nextOf("hexMapState", { timeoutMs: 8000 });
    expect(hexMap.hexMap.hexes[tk]).toBe("explored"); // discovered by run A, visible to run B

    // ...but TARGET is NOT cleared for run B, so moving onto it still triggers a fresh combat.
    const roomB = rooms.get(codeB)!;
    expect(roomB.visitedThisRun.has(tk)).toBe(false);
    b.mark();
    b.send({ type: "proposeMove", target: TARGET });
    const combatStart = await b.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    expect(combatStart.encounterHex).toEqual(TARGET);

    b.send({ type: "debugWin" });
    await b.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 }).catch(() => null);
    b.close();
  }, 30000);

  it("winning combat on a never-before-discovered (uncharted) hex broadcasts the hexDiscovered KEY MOMENT", async () => {
    // The seeded radius-15 disc is already in the community map, so hexes within it are never
    // first-ever. Enter combat normally, then point the live room's pendingHex at an UNCHARTED hex
    // (outside the seed disc, untouched by any other test) before debugWin — exercising the real
    // endCombat -> exploreHex -> commitExplore(firstEver) -> hexDiscovered broadcast path.
    const UNCHARTED = { q: 99, r: -7 };
    const host = await connectClient(server);
    await hello(host);
    const { code } = await createRoom(host, 2);
    await startAndReachOverworld(host);
    host.mark();
    await enterCombat(host);
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });

    const room = rooms.get(code)!;
    expect(room.phase).toBe("combat");
    room.pendingHex = UNCHARTED; // redirect the win onto an uncharted tile

    host.mark();
    host.send({ type: "debugWin" });
    const discovered = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "hexDiscovered" }> => m.type === "hexDiscovered",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(discovered.coord).toEqual(UNCHARTED);
    host.close();
  }, 30000);

  it("shared player phase: human acts + passes, phase ends only when all ready, then enemy phase runs; reach a win", async () => {
    const host = await connectClient(server);
    await hello(host);
    await createRoom(host, 2);
    await startAndReachOverworld(host);

    host.mark();
    await enterCombat(host);
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    const firstState = await host.nextOf("state", { timeoutMs: 8000 });

    // s0 is the human seat; perform a legal small move for its hero.
    const hero = firstState.state.entities["s0-hero"]!;
    const dest = { x: hero.position.x + 8, y: hero.position.y };
    host.mark();
    host.send({ type: "action", seatId: "s0", action: { type: "ability", entityId: "s0-hero", abilityId: "move", destination: dest } });
    // Either a fresh state (move applied) or actionRejected if move was illegal at that spot.
    const moveResp = await host.waitFor(
      (m): m is ServerMessage => m.type === "state" || m.type === "actionRejected",
      { consumeBuffered: false, timeoutMs: 4000 },
    );
    expect(["state", "actionRejected"]).toContain(moveResp.type);

    // Pass the human seat; with the bot already auto-ready, the player phase should end and the
    // enemy phase should run (coopStatus flips to "enemy" at some point).
    host.mark();
    host.send({ type: "pass" });

    // The phase machine should drive to either an enemy phase, a defend prompt, or straight to a
    // win/combatEnd. We just assert the room keeps progressing (no deadlock) by reaching combatEnd
    // via debugWin as the deterministic terminator below if needed.
    // First, give the enemy phase a chance to run.
    const sawEnemyOrEnd = await host.waitFor(
      (m): m is ServerMessage =>
        (m.type === "coopStatus" && m.coop.phase === "enemy") ||
        m.type === "combatEnd" ||
        m.type === "defendPrompt",
      { consumeBuffered: false, timeoutMs: 12000 },
    );
    expect(["coopStatus", "combatEnd", "defendPrompt"]).toContain(sawEnemyOrEnd.type);

    // Deterministically end the fight with a host debugWin -> combatEnd(won) -> overworld.
    host.mark();
    host.send({ type: "debugWin" });
    const end = await host.nextOf("combatEnd", { fromNow: true, timeoutMs: 8000 });
    expect(end.won).toBe(true);
    const back = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(back.room.phase).toBe("overworld");

    host.close();
  });

  it("disconnect mid-combat flips the seat to a bot and the phase still progresses; reconnect reclaims", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);

    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    const guestSeatId: SeatId = "s1";

    await startAndReachOverworld(host);

    // Two humans => proposeMove opens a vote; both vote yes to enter combat.
    host.mark();
    guest.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const vote = await host.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    expect(vote.vote).toBeTruthy();
    const proposalId = vote.vote!.proposalId;
    guest.send({ type: "castVote", proposalId, vote: "yes" });

    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    await host.nextOf("coopStatus", { timeoutMs: 8000 });

    // Guest disconnects mid-combat. After the 3s grace its seat flips human->bot, drives, and the
    // phase progresses. We observe the seat is no longer "human-connected".
    guest.close();
    await guest.closed;

    // host should see the guest seat become human-disconnected then bot-driven.
    const disc = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "coopStatus" }> =>
        m.type === "coopStatus" &&
        m.coop.seats.find((s) => s.seatId === guestSeatId)?.connected === false,
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(disc.coop.seats.find((s) => s.seatId === guestSeatId)!.connected).toBe(false);

    // Host passes; with the disconnected seat bot-driven (after grace) the phase must not deadlock.
    // Wait past the grace, then pass.
    await sleep(3500);
    host.mark();
    host.send({ type: "pass" });
    const progressed = await host.waitFor(
      (m): m is ServerMessage =>
        (m.type === "coopStatus" && m.coop.phase === "enemy") ||
        m.type === "combatEnd" ||
        m.type === "defendPrompt" ||
        (m.type === "coopStatus" && m.coop.phase === "player"),
      { consumeBuffered: false, timeoutMs: 12000 },
    );
    expect(progressed).toBeTruthy();

    // Guest reconnects with the SAME clientId -> auto-reclaims its seat (socket was dead).
    const guest2 = await connectClient(server, guest.clientId);
    const w2 = await hello(guest2);
    expect(w2.reconnected).toBeTruthy();
    expect(w2.reconnected!.seatId).toBe(guestSeatId);

    // Cleanly terminate the fight.
    host.send({ type: "debugWin" });
    await host.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 });

    host.close();
    guest2.close();
  });

  it("routes a defend prompt to the targeted seat; submit resolves it (R11) — deterministic", async () => {
    // Two humans + an in-process injection: we reach into the live Room's session and place a
    // single blue enemy adjacent to seat-1's human hero, so the enemy phase deterministically
    // attacks it and the defendPrompt must route to s1 (not s0). This exercises the real
    // room-machine defend round + WS delivery without depending on slow/organic AI pathing.
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    await startAndReachOverworld(host);

    // Two humans -> vote; both yes -> combat.
    host.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const vote = await host.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    guest.send({ type: "castVote", proposalId: vote.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    await host.nextOf("coopStatus", { timeoutMs: 8000 });

    // Inject a controlled state into the live session: keep both heroes, replace enemies with one
    // adjacent to s1-hero.
    const room = rooms.get(code)!;
    expect(room).toBeTruthy();
    expect(room.phase).toBe("combat");
    const session = room.session!;
    const live = session.state;
    const s0 = live.entities.get("s0-hero")!;
    const s1 = live.entities.get("s1-hero")!;
    const enemyTemplate = [...live.entities.values()].find((e) => e.teamId === "blue")!;
    const enemy: Entity = {
      ...enemyTemplate,
      id: "enemyX",
      dead: false,
      hp: enemyTemplate.maxHp,
      position: { x: s1.position.x + 36, y: s1.position.y },
      energy: { ...enemyTemplate.energy, red: enemyTemplate.energy.maxRed, blue: enemyTemplate.energy.maxBlue },
    };
    const newEntities = new Map<string, Entity>();
    newEntities.set("s0-hero", { ...s0, position: { x: s0.position.x, y: s0.position.y } });
    newEntities.set("s1-hero", { ...s1 });
    newEntities.set("enemyX", enemy);
    const injected: GameState = { ...live, entities: newEntities, activeTeam: "red", winner: null };
    session.state = injected;

    // Both humans pass; the player phase ends, the enemy phase runs, the adjacent enemy slashes
    // s1-hero, and the defendPrompt must arrive at the GUEST (seat s1), not the host.
    guest.mark();
    host.mark();
    host.send({ type: "pass" });
    guest.send({ type: "pass" });

    const prompt = await guest.waitFor(
      (m): m is Extract<ServerMessage, { type: "defendPrompt" }> => m.type === "defendPrompt",
      { consumeBuffered: false, timeoutMs: 15000 },
    );
    expect(prompt.seatId).toBe("s1");
    expect(prompt.targetEntityId).toBe("s1-hero");

    // The host (a different seat) must NOT receive the defendPrompt addressed to s1; instead it
    // sees the pending defend in coopStatus ("waiting on Guest").
    expect(host.inbox.some((m) => m.type === "defendPrompt")).toBe(false);
    const hostCoop = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "coopStatus" }> =>
        m.type === "coopStatus" && m.coop.pendingDefends.some((p) => p.seatId === "s1" && !p.answered),
      { consumeBuffered: false, timeoutMs: 4000 },
    );
    expect(hostCoop.coop.pendingDefends.some((p) => p.seatId === "s1")).toBe(true);

    // Guest answers -> the round resolves exactly once and combat continues.
    guest.send({ type: "defendResult", seatId: "s1", promptId: prompt.promptId, power: 0.5 });
    const resolved = await guest.waitFor(
      (m): m is Extract<ServerMessage, { type: "coopStatus" }> =>
        m.type === "coopStatus" && m.coop.pendingDefends.length === 0,
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(resolved.coop.pendingDefends.length).toBe(0);

    // Clean up deterministically.
    host.send({ type: "debugWin" });
    await host.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 }).catch(() => null);
    host.close();
    guest.close();
  }, 30000);

  it("reconnecting mid-defend-round re-sends the pending defendPrompt to the reclaiming human (R11/§5)", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    await startAndReachOverworld(host);

    host.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const vote = await host.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    guest.send({ type: "castVote", proposalId: vote.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    await host.nextOf("coopStatus", { timeoutMs: 8000 });

    // Inject one blue enemy adjacent to s1-hero (the guest) so the enemy phase prompts s1's defend.
    const room = rooms.get(code)!;
    const session = room.session!;
    const live = session.state;
    const s0 = live.entities.get("s0-hero")!;
    const s1 = live.entities.get("s1-hero")!;
    const enemyTemplate = [...live.entities.values()].find((e) => e.teamId === "blue")!;
    const enemy: Entity = {
      ...enemyTemplate,
      id: "enemyX",
      dead: false,
      hp: enemyTemplate.maxHp,
      position: { x: s1.position.x + 36, y: s1.position.y },
      energy: { ...enemyTemplate.energy, red: enemyTemplate.energy.maxRed, blue: enemyTemplate.energy.maxBlue },
    };
    const newEntities = new Map<string, Entity>();
    newEntities.set("s0-hero", { ...s0 });
    newEntities.set("s1-hero", { ...s1 });
    newEntities.set("enemyX", enemy);
    session.state = { ...live, entities: newEntities, activeTeam: "red", winner: null };

    // Both pass -> the enemy attacks s1-hero -> a defendPrompt routes to the guest.
    guest.mark();
    host.mark();
    host.send({ type: "pass" });
    guest.send({ type: "pass" });
    const firstPrompt = await guest.waitFor(
      (m): m is Extract<ServerMessage, { type: "defendPrompt" }> => m.type === "defendPrompt",
      { consumeBuffered: false, timeoutMs: 15000 },
    );
    expect(firstPrompt.seatId).toBe("s1");

    // Guest disconnects WITHOUT answering, then immediately reconnects (within the ~6s round window).
    // The reclaiming socket must receive the pending defendPrompt again (not just see it in coopStatus).
    guest.close();
    await guest.closed;
    const guest2 = await connectClient(server, guest.clientId);
    const w2 = await hello(guest2);
    expect(w2.reconnected!.seatId).toBe("s1");

    const rePrompt = await guest2.waitFor(
      (m): m is Extract<ServerMessage, { type: "defendPrompt" }> => m.type === "defendPrompt",
      { consumeBuffered: false, timeoutMs: 6000 },
    );
    expect(rePrompt.seatId).toBe("s1");
    expect(rePrompt.targetEntityId).toBe("s1-hero");
    expect(rePrompt.attackerId).toBe("enemyX");

    // The reconnected human can now actually answer it.
    guest2.send({ type: "defendResult", seatId: "s1", promptId: rePrompt.promptId, power: 0.5 });

    host.send({ type: "debugWin" });
    await host.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 }).catch(() => null);
    host.close();
    guest2.close();
  }, 30000);

  // --- negative identity tests (R5/R6) ---

  it("reclaim of a LIVE seat is rejected SEAT_IN_USE; force closes the old socket and sends displaced", async () => {
    const owner = await connectClient(server);
    await hello(owner);
    const { code } = await createRoom(owner, 2);

    // A second connection with the SAME clientId hello's -> welcome (no reconnect since seat is live).
    const intruder = await connectClient(server, owner.clientId);
    const w = await hello(intruder);
    // The owner's seat is live, so hello does NOT auto-reclaim; client is room-less.
    expect(w.reconnected).toBeUndefined();

    // Reclaim without force -> SEAT_IN_USE.
    intruder.mark();
    intruder.send({ type: "reclaimSeat", code, seatId: "s0" });
    const err = await intruder.nextOf("error", { fromNow: true, timeoutMs: 4000 });
    expect(err.code).toBe("SEAT_IN_USE");

    // Reclaim WITH force -> the old socket gets displaced + closed; intruder takes the seat.
    owner.mark();
    intruder.mark();
    intruder.send({ type: "reclaimSeat", code, seatId: "s0", force: true });
    const displaced = await owner.nextOf("displaced", { fromNow: true, timeoutMs: 4000 });
    expect(displaced.type).toBe("displaced");
    const w2 = await intruder.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
    expect(w2.reconnected!.seatId).toBe("s0");
    await owner.closed;

    intruder.close();
  });

  it("abandon a lobby room then create another with the SAME clientId succeeds (R32, no UNIQUE crash)", async () => {
    const client = await connectClient(server);
    await hello(client);

    // Room A (lobby). Then leave it explicitly.
    const a = await createRoom(client, 2);
    client.mark();
    client.send({ type: "leaveRoom" });
    await sleep(100); // let the durable left_at-stamp + run-inactivate land

    // Room B with the same clientId: previously threw UNIQUE constraint failed and the client got
    // NO welcome (the throw was swallowed). Now the prior seat is cleaned up first, so it succeeds.
    client.mark();
    client.send({ type: "createRoom", capacity: 2, dimensionId: DIM });
    const w = await client.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
    expect(w.reconnected).toBeTruthy();
    expect(w.reconnected!.code).not.toBe(a.code);

    client.close();
  });

  it("createRoom while already seated in a lobby room (same socket) switches rooms without closing it (R32)", async () => {
    const client = await connectClient(server);
    await hello(client);
    const a = await createRoom(client, 2);

    // Create room B on the SAME socket without leaving A first. The prior seat must be abandoned and
    // the socket re-bound to B — NOT closed (which would kill this very request).
    client.mark();
    client.send({ type: "createRoom", capacity: 2, dimensionId: DIM });
    const w = await client.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
    expect(w.reconnected).toBeTruthy();
    expect(w.reconnected!.code).not.toBe(a.code);
    // The socket is still open and bound to B: a follow-up host action succeeds (reaches overworld).
    const overworld = await startAndReachOverworld(client);
    expect(overworld.room.code).toBe(w.reconnected!.code);

    client.close();
  });

  it("create a room, abandon by closing the socket, then create again with the same clientId (R32)", async () => {
    const id = `replay-${Math.random().toString(36).slice(2)}`;
    const c1 = await connectClient(server, id);
    await hello(c1);
    await createRoom(c1, 2);
    c1.close();
    await c1.closed;
    await sleep(150); // lobby empties -> run abandoned durably

    // A fresh socket with the same clientId can create again (no UNIQUE-live crash, no silent hang).
    const c2 = await connectClient(server, id);
    await hello(c2);
    c2.mark();
    c2.send({ type: "createRoom", capacity: 2, dimensionId: DIM });
    const w = await c2.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
    expect(w.reconnected).toBeTruthy();
    c2.close();
  });

  it("an unanswered (bot-owned) defend target takes FULL damage, not zero (R11 neutral=power 0)", async () => {
    // Solo: s0 human, s1 bot. Inject one blue enemy adjacent to the BOT hero (s1) so the enemy phase
    // attacks it. The defend round has no human target -> resolves with the neutral default, which
    // MUST be full damage (the bug made it zero = invulnerable). Assert s1-hero loses HP.
    const host = await connectClient(server);
    await hello(host);
    const { code } = await createRoom(host, 2);
    await startAndReachOverworld(host);

    host.mark();
    await enterCombat(host);
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    await host.nextOf("coopStatus", { timeoutMs: 8000 });

    const room = rooms.get(code)!;
    expect(room.phase).toBe("combat");
    const session = room.session!;
    const live = session.state;
    const s0 = live.entities.get("s0-hero")!;
    const s1 = live.entities.get("s1-hero")!;
    const enemyTemplate = [...live.entities.values()].find((e) => e.teamId === "blue")!;
    const enemy: Entity = {
      ...enemyTemplate,
      id: "enemyX",
      dead: false,
      hp: enemyTemplate.maxHp,
      position: { x: s1.position.x + 36, y: s1.position.y },
      energy: { ...enemyTemplate.energy, red: enemyTemplate.energy.maxRed, blue: enemyTemplate.energy.maxBlue },
    };
    const s1HpBefore = s1.maxHp;
    const newEntities = new Map<string, Entity>();
    newEntities.set("s0-hero", { ...s0 });
    newEntities.set("s1-hero", { ...s1, hp: s1HpBefore });
    newEntities.set("enemyX", enemy);
    const injected: GameState = { ...live, entities: newEntities, activeTeam: "red", winner: null };
    session.state = injected;

    // Host passes; s1 is a bot (auto-ready). Player phase ends, enemy phase runs, the adjacent enemy
    // attacks the bot-owned s1-hero. The all-bot-target defend round resolves immediately at neutral.
    host.mark();
    host.send({ type: "pass" });

    // Wait for a state where s1-hero has taken damage (full neutral damage), proving power 0 != perfect.
    const damaged = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "state" }> =>
        m.type === "state" && (m.state.entities["s1-hero"]?.hp ?? s1HpBefore) < s1HpBefore,
      { consumeBuffered: false, timeoutMs: 15000 },
    );
    expect(damaged.state.entities["s1-hero"]!.hp).toBeLessThan(s1HpBefore);

    host.send({ type: "debugWin" });
    await host.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 }).catch(() => null);
    host.close();
  }, 30000);

  it("a join to an already-started room is rejected ALREADY_STARTED", async () => {
    const host = await connectClient(server);
    const late = await connectClient(server);
    await hello(host);
    await hello(late);
    const { code } = await createRoom(host, 2);
    await startAndReachOverworld(host);

    late.mark();
    late.send({ type: "joinRoom", code });
    const err = await late.nextOf("error", { fromNow: true, timeoutMs: 4000 });
    expect(err.code).toBe("ALREADY_STARTED");

    host.close();
    late.close();
  });
});

// =====================================================================================
// Accounts & community (docs/meta-loop/01-accounts.md §9 integration additions)
// =====================================================================================

let acctSeq = 0;
function uniqueName(prefix: string): string {
  return `${prefix}${++acctSeq}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
}

async function claim(client: MockClient, username: string) {
  client.mark();
  client.send({ type: "claimAccount", username, password: "password123" });
  return client.nextOf("authState", { fromNow: true, timeoutMs: 8000 });
}

function isFriendsList(m: ServerMessage): m is Extract<ServerMessage, { type: "friendsList" }> {
  return m.type === "friendsList";
}

/** Next friendsList (from the client's mark() cursor) matching `pred` — buffered pushes included,
 *  so a push that landed before the waiter registered is not missed. */
async function nextFriendsListMatching(
  client: MockClient,
  pred: (m: Extract<ServerMessage, { type: "friendsList" }>) => boolean,
): Promise<Extract<ServerMessage, { type: "friendsList" }>> {
  const deadline = Date.now() + 4000;
  while (true) {
    const msg = await client.nextOf("friendsList", { fromNow: true, timeoutMs: Math.max(50, deadline - Date.now()) });
    if (pred(msg)) return msg;
    if (Date.now() > deadline) throw new Error("no friendsList matched the predicate in time");
  }
}

describe("accounts & community integration", () => {
  it("hello mints a guest with a token; the token restores the SAME account; sans token the same clientId re-resolves the same guest (J1)", async () => {
    const a = await connectClient(server);
    const w1 = await hello(a);
    expect(w1.auth.isGuest).toBe(true);
    expect(w1.auth.username).toBeNull();
    expect(w1.auth.authToken.length).toBeGreaterThan(0);
    expect(w1.auth.authRejected).toBeUndefined();
    expect(w1.auth.profile.displayName.startsWith("Wanderer-")).toBe(true);
    a.close();
    await a.closed;

    const b = await connectClient(server, a.clientId);
    const w2 = await hello(b, { authToken: w1.auth.authToken });
    expect(w2.auth.accountId).toBe(w1.auth.accountId);
    expect(w2.auth.authRejected).toBeUndefined();
    b.close();
    await b.closed;

    const c = await connectClient(server, a.clientId);
    const w3 = await hello(c);
    expect(w3.auth.accountId).toBe(w1.auth.accountId); // mint is idempotent per clientId
    c.close();
  });

  it("a garbage token is surfaced as authRejected 'invalid' with a usable guest; a claimed seat's attribution survives the authRejected reclaim (never-overwrite)", async () => {
    const dbmod = await import("../db.js");
    const owner = await connectClient(server);
    await hello(owner);
    const auth = await claim(owner, uniqueName("Keeper_"));
    expect(auth.auth.isGuest).toBe(false);
    const claimedId = auth.auth.accountId;

    const { roomState } = await createRoom(owner, 2);
    const runId = roomState.room.runId;
    expect(dbmod.loadRunSeats(runId)[0]!.account_id).toBe(claimedId);
    await startAndReachOverworld(owner); // a started seat survives a disconnect (reclaimable)
    owner.close();
    await owner.closed;

    const back = await connectClient(server, owner.clientId);
    const w2 = await hello(back, { authToken: "garbage-token" });
    expect(w2.auth.authRejected).toBe("invalid");
    expect(w2.auth.isGuest).toBe(true); // downgraded connection identity, claimed account untouched
    expect(w2.auth.accountId).not.toBe(claimedId);
    expect(w2.reconnected).toBeTruthy(); // the HMAC seat-reclaim path is orthogonal and intact

    // Never-overwrite: the seat still credits the claimed account, in memory and durably.
    const room = rooms.get(w2.reconnected!.code)!;
    expect(room.seats[0]!.accountId).toBe(claimedId);
    expect(dbmod.loadRunSeats(runId)[0]!.account_id).toBe(claimedId);
    back.close();
  });

  it("claim upgrades in place (J2); login while seated is AUTH_IN_ROOM; a second device logs into the same account (J3) and a friend sees presence flip", async () => {
    const alice = await connectClient(server);
    const wA = await hello(alice);
    const aliceName = uniqueName("Alice_");
    const authA = await claim(alice, aliceName);
    expect(authA.auth.isGuest).toBe(false);
    expect(authA.auth.username).toBe(aliceName);
    expect(authA.auth.accountId).toBe(wA.auth.accountId); // guest upgraded in place, not swapped
    const aliceId = authA.auth.accountId;

    const bob = await connectClient(server);
    await hello(bob);
    const authB = await claim(bob, uniqueName("Bob_"));
    const bobId = authB.auth.accountId;

    // Befriend: bob requests by username, alice accepts.
    alice.mark();
    bob.mark();
    bob.send({ type: "friendRequest", username: aliceName });
    const incoming = await alice.nextOf("friendsList", { fromNow: true, timeoutMs: 4000 });
    expect(incoming.friends.incoming.map((r) => r.accountId)).toEqual([bobId]);
    alice.send({ type: "friendAccept", accountId: bobId });
    const bobList = await nextFriendsListMatching(bob, (m) =>
      m.friends.friends.some((f) => f.accountId === aliceId && f.online),
    );
    expect(bobList.friends.friends.find((f) => f.accountId === aliceId)!.displayName).toBe(aliceName);

    // Seated auth switches are frozen: login from a seated socket -> AUTH_IN_ROOM.
    await createRoom(alice, 2);
    alice.mark();
    alice.send({ type: "login", username: aliceName, password: "password123" });
    const err = await alice.nextOf("error", { fromNow: true, timeoutMs: 4000 });
    expect(err.code).toBe("AUTH_IN_ROOM");

    // Alice's device disappears -> bob's friends panel flips her offline.
    bob.mark();
    alice.close();
    await alice.closed;
    await nextFriendsListMatching(bob, (m) =>
      m.friends.friends.some((f) => f.accountId === aliceId && !f.online),
    );

    // A brand-new device (fresh clientId, fresh guest) logs into the claimed account.
    const device2 = await connectClient(server);
    const w2 = await hello(device2);
    expect(w2.auth.accountId).not.toBe(aliceId); // throwaway guest first
    bob.mark();
    device2.mark();
    device2.send({ type: "login", username: aliceName, password: "password123" });
    const auth2 = await device2.nextOf("authState", { fromNow: true, timeoutMs: 8000 });
    expect(auth2.auth.accountId).toBe(aliceId); // same account, passwordless next time via the token
    expect(auth2.auth.isGuest).toBe(false);
    await nextFriendsListMatching(bob, (m) =>
      m.friends.friends.some((f) => f.accountId === aliceId && f.online),
    );

    bob.close();
    device2.close();
  });

  it("chat relays in lobby + overworld, replays chatHistory on reconnect, and is BAD_PHASE in combat (J5)", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);

    // Lobby chat reaches every seat (including the sender).
    guest.mark();
    host.mark();
    host.send({ type: "chatSend", text: "hello lobby" });
    const atGuest = await guest.nextOf("chat", { fromNow: true, timeoutMs: 4000 });
    expect(atGuest.entry.text).toBe("hello lobby");
    expect(atGuest.entry.seatId).toBe("s0");
    await host.nextOf("chat", { fromNow: true, timeoutMs: 4000 });

    await startAndReachOverworld(host);
    guest.mark();
    guest.send({ type: "chatSend", text: "onward" });
    const overworldChat = await guest.nextOf("chat", { fromNow: true, timeoutMs: 4000 });
    expect(overworldChat.entry.seatId).toBe("s1");

    // Reconnect replays the room's chat history.
    guest.close();
    await guest.closed;
    const guest2 = await connectClient(server, guest.clientId);
    const w2 = await hello(guest2);
    expect(w2.reconnected).toBeTruthy();
    const history = await guest2.nextOf("chatHistory", { timeoutMs: 4000 });
    expect(history.entries.map((e) => e.text)).toEqual(["hello lobby", "onward"]);

    // Combat blocks chat with BAD_PHASE.
    host.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const vote = await host.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    guest2.send({ type: "castVote", proposalId: vote.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    host.mark();
    host.send({ type: "chatSend", text: "mid-combat" });
    const err = await host.nextOf("error", { fromNow: true, timeoutMs: 4000 });
    expect(err.code).toBe("BAD_PHASE");

    host.send({ type: "debugWin" });
    await host.waitFor((m): m is ServerMessage => m.type === "combatEnd", { consumeBuffered: false, timeoutMs: 8000 }).catch(() => null);
    host.close();
    guest2.close();
  }, 30000);

  it("the 6th chat message inside 10s is RATE_LIMITED", async () => {
    const host = await connectClient(server);
    await hello(host);
    await createRoom(host, 2);

    host.mark();
    for (let i = 0; i < 5; i++) host.send({ type: "chatSend", text: `msg ${i}` });
    for (let i = 0; i < 5; i++) await host.nextOf("chat", { fromNow: true, timeoutMs: 4000 });
    host.send({ type: "chatSend", text: "one too many" });
    const err = await host.nextOf("error", { fromNow: true, timeoutMs: 4000 });
    expect(err.code).toBe("RATE_LIMITED");
    host.close();
  });

  it("an encounter win awards 25 XP + greenhorn PRIVATELY, the roster carries the level, a wipe bumps wipes; bot seats stay null (§6)", async () => {
    const host = await connectClient(server);
    const w = await hello(host); // fresh clientId -> fresh guest at 0 XP
    const accountId = w.auth.accountId;
    await createRoom(host, 2);
    await startAndReachOverworld(host);

    host.mark();
    await enterCombat(host);
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    host.mark();
    host.send({ type: "debugWin" });

    const xp = await host.nextOf("xpAward", { fromNow: true, timeoutMs: 8000 });
    expect(xp).toMatchObject({ amount: 25, xp: 25, level: 1, leveledUp: false });
    const titles = await host.nextOf("titlesEarned", { fromNow: true, timeoutMs: 4000 });
    expect(titles.titleIds).toEqual(["greenhorn"]);

    // The post-award roomState carries account/level on the human seat; the bot seat is all-null.
    const rs = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    const s0 = rs.room.seats[0]!;
    const s1 = rs.room.seats[1]!;
    expect(s0.accountId).toBe(accountId);
    expect(s0.level).toBe(1);
    expect(s1.state).toBe("bot");
    expect(s1.accountId).toBeNull();
    expect(s1.level).toBeNull();
    expect(s1.equippedTitleId).toBeNull();

    host.mark();
    host.send({ type: "getProfile" });
    const prof = await host.nextOf("profile", { fromNow: true, timeoutMs: 4000 });
    expect(prof.profile.xp).toBe(25);
    expect(prof.profile.stats.encountersWon).toBe(1);
    expect(prof.profile.stats.hexesCharted).toBe(1);
    expect(prof.profile.stats.dimensionsDiscovered).toBe(1); // recorded at startGame
    expect(prof.profile.titles).toContain("greenhorn");

    // Now wipe on a fresh encounter -> wipes+1.
    host.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 1 } });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    host.send({ type: "debugLose" });
    await host.waitFor((m): m is ServerMessage => m.type === "gameOver", { consumeBuffered: false, timeoutMs: 8000 });
    host.mark();
    host.send({ type: "getProfile" });
    const prof2 = await host.nextOf("profile", { fromNow: true, timeoutMs: 4000 });
    expect(prof2.profile.stats.wipes).toBe(1);
    expect(prof2.profile.stats.encountersWon).toBe(1);
    host.close();
  }, 30000);

  it("friendInvite reaches the room-less friend's socket with the right code; Join seats them under their profile name (J4)", async () => {
    const a = await connectClient(server);
    const b = await connectClient(server);
    await hello(a);
    await hello(b);
    const aName = uniqueName("Host_");
    const bName = uniqueName("Pal_");
    const authA = await claim(a, aName);
    const authB = await claim(b, bName);

    b.send({ type: "friendRequest", username: aName });
    a.mark();
    await a.nextOf("friendsList", { fromNow: true, timeoutMs: 4000 });
    a.mark();
    a.send({ type: "friendAccept", accountId: authB.auth.accountId });
    await a.waitFor(
      (m): m is Extract<ServerMessage, { type: "friendsList" }> =>
        isFriendsList(m) && m.friends.friends.some((f) => f.accountId === authB.auth.accountId),
      { consumeBuffered: false, timeoutMs: 4000 },
    );

    const { code } = await createRoom(a, 2);
    b.mark();
    a.send({ type: "friendInvite", accountId: authB.auth.accountId });
    const invite = await b.nextOf("roomInvite", { fromNow: true, timeoutMs: 4000 });
    expect(invite.code).toBe(code);
    expect(invite.from.accountId).toBe(authA.auth.accountId);
    expect(invite.from.displayName).toBe(aName);

    b.send({ type: "joinRoom", code: invite.code });
    const wb = await b.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
    expect(wb.reconnected!.code).toBe(code);
    const rs = await b.waitFor(isRoomState, { timeoutMs: 4000 });
    expect(rs.room.seats[1]!.displayName).toBe(bName); // profiles are the single name source
    expect(rs.room.seats[1]!.accountId).toBe(authB.auth.accountId);

    a.close();
    b.close();
  });
});
