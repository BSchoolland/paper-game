import { describe, it, expect, beforeAll } from "bun:test";
import type { ServerMessage, SeatId, Entity, GameState, ItemDefinition } from "shared";
import { hexKey, createContractState, archetypeById, effectiveEnemyBudget, getEncounterProfile, getHexIcon, isDecorationHex, hexDistance, scaledXp, levelForXp, XP_ENCOUNTER_WIN, contractById } from "shared";
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

  it("create + join: roster shows two humans; start drops the empty seat (no bots); party reaches overworld", async () => {
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

    // host starts; the empty seat (s2) is dropped — no bots — leaving a party of the two humans
    const overworld = await startAndReachOverworld(host);
    expect(overworld.room.phase).toBe("overworld");
    expect(overworld.room.seats.length).toBe(2);
    expect(overworld.room.seats.every((s) => s.state === "human-connected")).toBe(true);

    host.close();
    guest.close();
  });

  it("lobby leave clears the seat's account identity; drop-empty-seats + host reset survive it", async () => {
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

    // Start drops the reopened seat (no bots) -> the host starts solo; the host reset then re-persists
    // the lone seat and must complete (a stale accountId anywhere would throw in upsertRunSeat).
    const overworld = await startAndReachOverworld(host);
    const oldRunId = overworld.room.runId;
    expect(overworld.room.seats.length).toBe(1);
    host.send({ type: "reset" });
    const afterReset = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.runId !== oldRunId,
      { consumeBuffered: false },
    );
    expect(afterReset.room.phase).toBe("overworld");
    expect(afterReset.room.seats.length).toBe(1);
    expect(afterReset.room.seats[0]!.state).toBe("human-connected");

    host.close();
    guest.close();
  });

  it("solo: create + start with no bots, enter combat with the lone hero carrying controllerId", async () => {
    const host = await connectClient(server);
    await hello(host);
    await createRoom(host, 2);
    const overworld = await startAndReachOverworld(host);
    expect(overworld.room.seats.length).toBe(1); // the unfilled seat was dropped, not bot-filled

    // single human -> propose resolves instantly -> combat
    host.mark();
    await enterCombat(host);
    const combatStart = await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    expect(combatStart.encounterHex).toEqual({ q: 1, r: 0 });

    const state = await host.nextOf("state", { timeoutMs: 8000 });
    const entities = state.state.entities;
    const s0Hero = entities["s0-hero"];
    expect(s0Hero).toBeTruthy();
    expect(entities["s1-hero"]).toBeUndefined(); // no bot hero for the dropped seat
    expect(s0Hero!.controllerId).toBe("s0");
    expect(s0Hero!.teamId).toBe("red");
    // there is at least one blue enemy
    expect(Object.values(entities).some((e) => e.teamId === "blue")).toBe(true);

    // coopStatus reports the player phase with the single human seat
    const coop = await host.nextOf("coopStatus", { timeoutMs: 8000 });
    expect(coop.coop.phase).toBe("player");
    expect(coop.coop.seats.length).toBe(1);
    expect(coop.coop.seats.find((s) => s.seatId === "s0")!.controller).toBe("human");

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
    // s0 human, s1 a guest who disconnects mid-combat -> s1 flips to a bot. Inject one blue enemy
    // adjacent to the BOT hero (s1) so the enemy phase attacks it. The defend round has no human
    // target -> resolves with the neutral default, which MUST be full damage (the bug made it zero =
    // invulnerable). Assert s1-hero loses HP.
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    await startAndReachOverworld(host);

    // Two humans -> proposeMove opens a vote; both vote yes to enter combat.
    host.mark();
    guest.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const vote = await host.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    guest.send({ type: "castVote", proposalId: vote.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    await host.nextOf("coopStatus", { timeoutMs: 8000 });

    // Guest drops; after the 3s grace its seat (s1) is bot-driven.
    guest.close();
    await guest.closed;
    await sleep(3500);

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

  it("an encounter win accrues 25 PENDING XP + greenhorn PRIVATELY (profile xp unchanged mid-run); a wipe banks 50% and bumps wipes (§6/02 §7.7)", async () => {
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
    expect(xp).toMatchObject({ amount: 25, pending: 25 }); // provisional accrual, no level
    const titles = await host.nextOf("titlesEarned", { fromNow: true, timeoutMs: 4000 });
    expect(titles.titleIds).toEqual(["greenhorn"]);

    // The post-award roomState carries account/level on the lone human seat (solo start, no bots).
    const rs = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(rs.room.seats.length).toBe(1);
    const s0 = rs.room.seats[0]!;
    expect(s0.accountId).toBe(accountId);
    expect(s0.level).toBe(1);

    host.mark();
    host.send({ type: "getProfile" });
    const prof = await host.nextOf("profile", { fromNow: true, timeoutMs: 4000 });
    expect(prof.profile.xp).toBe(0); // the reconciliation proof: XP is pending, NOT on the profile
    expect(prof.profile.stats.encountersWon).toBe(1);
    expect(prof.profile.stats.hexesCharted).toBe(1);
    expect(prof.profile.stats.dimensionsDiscovered).toBe(1); // recorded at startGame
    expect(prof.profile.titles).toContain("greenhorn");

    // Now wipe on a fresh encounter -> wipes+1 and the pending ledger banks at 0.5.
    host.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 1 } });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    host.send({ type: "debugLose" });
    const banked = await host.nextOf("xpBanked", { fromNow: true, timeoutMs: 8000 });
    expect(banked).toMatchObject({ pending: 25, multiplier: 0.5, banked: 12, xp: 12, level: 1, leveledUp: false });
    await host.waitFor((m): m is ServerMessage => m.type === "gameOver", { consumeBuffered: false, timeoutMs: 8000 });
    host.mark();
    host.send({ type: "getProfile" });
    const prof2 = await host.nextOf("profile", { fromNow: true, timeoutMs: 4000 });
    expect(prof2.profile.xp).toBe(12); // floor(25 * 0.5) banked by the wipe
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

// =====================================================================================
// Contracts & run outcomes (docs/meta-loop/02-contracts.md §8 integration additions)
// =====================================================================================

describe("contracts & run outcomes integration", () => {
  it("lobby offer board: host and joiner receive contractOffers; the pick is host-gated and rides roomState.contract", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);

    const hostOffers = await host.nextOf("contractOffers", { timeoutMs: 4000 });
    expect(hostOffers.offers.some((o) => o.type === "chart-hexes")).toBe(true); // always available

    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    const guestOffers = await guest.nextOf("contractOffers", { timeoutMs: 4000 });
    expect(guestOffers.offers.map((o) => o.type)).toEqual(hostOffers.offers.map((o) => o.type)); // deterministic scan

    // Pre-pick, the lobby has no contract yet (flag #2: the default lands at startGame).
    const lobbyRs = await guest.waitFor(isRoomState, { timeoutMs: 4000 });
    expect(lobbyRs.room.contract).toBeNull();

    // Non-host pick -> NOT_HOST.
    guest.mark();
    guest.send({ type: "chooseContract", contractType: "chart-hexes" });
    const err = await guest.nextOf("error", { fromNow: true, timeoutMs: 4000 });
    expect(err.code).toBe("NOT_HOST");

    // Host pick -> both sockets see the selection on roomState.contract.
    host.mark();
    guest.mark();
    host.send({ type: "chooseContract", contractType: "chart-hexes" });
    for (const c of [host, guest]) {
      const rs = await c.waitFor(
        (m): m is Extract<ServerMessage, { type: "roomState" }> =>
          m.type === "roomState" && m.room.contract?.type === "chart-hexes",
        { timeoutMs: 4000 },
      );
      expect(rs.room.contract).toMatchObject({ type: "chart-hexes", progress: 0, required: 10, completed: false });
    }

    host.close();
    guest.close();
  });

  it("startGame without a host pick assigns the default chart-hexes contract (exactly-one invariant)", async () => {
    const host = await connectClient(server);
    await hello(host);
    await createRoom(host, 2);
    const overworld = await startAndReachOverworld(host);
    expect(overworld.room.contract).toMatchObject({ type: "chart-hexes", progress: 0, completed: false });
    host.close();
  });

  it("full chart-hexes victory: 10 cleared hexes settle the run — gameOver victory, 1.0 bank with the reward, sealbearer (§8)", async () => {
    const host = await connectClient(server);
    const w = await hello(host); // fresh guest at 0 XP
    await createRoom(host, 2);
    host.send({ type: "chooseContract", contractType: "chart-hexes" });
    await startAndReachOverworld(host);

    // March east: each target is adjacent to the party (which advances onto every won hex).
    for (let k = 1; k <= 10; k++) {
      host.mark();
      host.send({ type: "proposeMove", target: { q: k, r: 0 } });
      await host.nextOf("combatStart", { fromNow: true, timeoutMs: 10000 });
      host.mark();
      host.send({ type: "debugWin" });
      if (k < 10) {
        const rs = await host.waitFor(
          (m): m is Extract<ServerMessage, { type: "roomState" }> =>
            m.type === "roomState" && m.room.phase === "overworld" && m.room.contract?.progress === k,
          { consumeBuffered: false, timeoutMs: 10000 },
        );
        expect(rs.room.contract).toMatchObject({ type: "chart-hexes", progress: k, completed: false });
      }
    }

    // The 10th win completes the contract -> victory settles the run.
    const over = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "gameOver" }> => m.type === "gameOver",
      { consumeBuffered: false, timeoutMs: 10000 },
    );
    expect(over.outcome).toBe("victory");
    const rs = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "gameover",
      { timeoutMs: 8000 },
    );
    expect(rs.room.outcome).toBe("victory");
    expect(rs.room.contract).toMatchObject({ type: "chart-hexes", progress: 10, required: 10, completed: true });

    // 10 wins + the chart-hexes reward, banked at the 1.0 victory multiplier. Under feature 5 the win
    // XP scales by hex distance from origin (hexes 3-10 sit past the grace radius), so the total is
    // computed from the same shared scaledXp the server accrues with (§4.5/§4.6, start tier 0).
    let expectedPending = scaledXp(contractById("chart-hexes").xpReward, 0, 0); // reward at start tier 0, distance 0
    for (let k = 1; k <= 10; k++) expectedPending += scaledXp(XP_ENCOUNTER_WIN, 0, hexDistance({ q: k, r: 0 }, { q: 0, r: 0 }));
    const expectedLevel = levelForXp(expectedPending);
    const banked = host.inbox.find((m) => m.type === "xpBanked") as Extract<ServerMessage, { type: "xpBanked" }>;
    expect(banked).toMatchObject({ pending: expectedPending, multiplier: 1, banked: expectedPending, xp: expectedPending, level: expectedLevel, leveledUp: expectedLevel > levelForXp(0) });
    const titleSends = host.inbox.filter(
      (m): m is Extract<ServerMessage, { type: "titlesEarned" }> => m.type === "titlesEarned",
    );
    expect(titleSends.some((t) => t.titleIds.includes("sealbearer"))).toBe(true);

    host.mark();
    host.send({ type: "getProfile" });
    const prof = await host.nextOf("profile", { fromNow: true, timeoutMs: 4000 });
    expect(prof.profile.accountId).toBe(w.auth.accountId);
    expect(prof.profile.xp).toBe(expectedPending);
    expect(prof.profile.level).toBe(expectedLevel);
    expect(prof.profile.stats.contractsCompleted).toBe(1);
    expect(prof.profile.titles).toContain("sealbearer");

    // Play Again after victory funnels into the rematch lobby exactly as after defeat.
    host.mark();
    host.send({ type: "playAgain" });
    await host.nextOf("welcome", { fromNow: true, timeoutMs: 6000 });
    const lobby = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "lobby",
      { consumeBuffered: false, timeoutMs: 6000 },
    );
    expect(lobby.room.contract).toBeNull(); // a fresh lobby: no pick yet
    host.close();
  }, 90000);

  it("a reconnecting socket lands in the gameover room via reclaim and reads the outcome from roomState (no gameOver message needed)", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    await startAndReachOverworld(host);

    // A second device for the guest helloes while the run is LIVE: its welcome carries the seat's
    // re-derived HMAC token (seat live -> no auto-reclaim), which stays valid across the settle.
    const guest2 = await connectClient(server, guest.clientId);
    const w2 = await hello(guest2);
    expect(w2.reconnected).toBeUndefined(); // seat live elsewhere -> room-less welcome

    // Drive a defeat with both humans seated.
    host.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const vote = await host.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    expect(vote.vote!.kind).toBe("move"); // the generalized payload still types move votes
    guest.send({ type: "castVote", proposalId: vote.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    host.send({ type: "debugLose" });
    await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "gameover",
      { consumeBuffered: false, timeoutMs: 8000 },
    );

    // The guest's first socket drops at the Game Over screen; the second device reclaims the seat.
    guest.close();
    await guest.closed;
    guest2.mark();
    guest2.send({ type: "reclaimSeat", code, seatId: "s1" });
    const rw = await guest2.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
    expect(rw.reconnected).toEqual({ code, seatId: "s1" });

    // The end screen renders from roomState alone: outcome + contract, no transient gameOver replay.
    const rs = await guest2.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "gameover",
      { timeoutMs: 4000 },
    );
    expect(rs.room.outcome).toBe("defeat");
    expect(rs.room.contract).toMatchObject({ type: "chart-hexes", completed: false });
    expect(guest2.inbox.some((m) => m.type === "gameOver")).toBe(false);

    host.close();
    guest2.close();
  }, 30000);
});

describe("portals & tiered multiverse integration", () => {
  it("lobby dimensionOptions + host-gated chooseDimension (eligibility, re-derivation, re-sent offers)", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    const hw = await hello(host);
    await hello(guest);
    const hostAccountId = hw.auth.accountId;
    const { code } = await createRoom(host, 2);

    // The host lands with the run-start picker: tier-0 surface dims present, uncharted deep (dim 2) absent.
    const opts = await host.nextOf("dimensionOptions", { timeoutMs: 4000 });
    const ids = opts.options.map((o) => o.id);
    expect(ids).toContain(0);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2); // tier-1, uncharted -> not offered
    expect(opts.options.find((o) => o.id === 0)).toMatchObject({ tier: 0, name: "Greenlands" });

    // The joiner also receives the picker (re-broadcast on join).
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    const gOpts = await guest.nextOf("dimensionOptions", { timeoutMs: 4000 });
    expect(gOpts.options.map((o) => o.id).sort()).toEqual(ids.slice().sort());

    // Non-host chooseDimension -> NOT_HOST.
    guest.mark();
    guest.send({ type: "chooseDimension", dimensionId: 1 });
    expect((await guest.nextOf("error", { fromNow: true, timeoutMs: 4000 })).code).toBe("NOT_HOST");

    // Host picks an uncharted deep dim -> INVALID_INPUT.
    host.mark();
    host.send({ type: "chooseDimension", dimensionId: 2 });
    expect((await host.nextOf("error", { fromNow: true, timeoutMs: 4000 })).code).toBe("INVALID_INPUT");

    // Chart dim 2 for the host's account (dynamic import shares the harness :memory: DB), then the pick
    // succeeds: both sockets see dim 2 (tier 1) on roomState and contractOffers are re-sent.
    const { recordDimensionSeen } = await import("../accounts.js");
    recordDimensionSeen(hostAccountId, 2);
    host.send({ type: "chooseDimension", dimensionId: 2 });
    for (const c of [host, guest]) {
      // Scan buffered too: the shared broadcast may land before this seat's waitFor registers.
      const rs = await c.waitFor(
        (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.dimensionId === 2,
        { timeoutMs: 4000 },
      );
      expect(rs.room.dimensionName).toBe("The Gloom Hollows");
      expect(rs.room.dimensionTier).toBe(1);
    }
    await host.nextOf("contractOffers", { fromNow: true, timeoutMs: 4000 }); // re-derived per new map

    host.close();
    guest.close();
  });

  it("travel end-to-end over ws: gateway clear attunes, reconnect snapshot carries gateways, descent vote travels, wipe rematches at the START dimension", async () => {
    const db = await import("../db.js");
    // Destination fixture: the ONLY ready NULL-tier pool candidate in the harness DB (seeded dims are
    // all tiered). Combat-capable via dim 0's real enemy templates (composite PK — no clobbering).
    const DEST = 9010;
    db.saveDimension(DEST, "E2E Depths", [], "bg-e2e.png", undefined, "approved");
    db.db.prepare(
      "INSERT OR REPLACE INTO enemy_templates (id, dimension_id, template_json) SELECT id, ?, template_json FROM enemy_templates WHERE dimension_id = 0",
    ).run(DEST);
    db.db.prepare("INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES ('e2e-depths-item', ?, '{}')").run(DEST);
    // A gateway hex adjacent to dim 0's origin (community icon override; (0,1) is unused by other tests).
    const GATE = { q: 0, r: 1 };
    const GATE_KEY = "0,1";
    db.saveDiscoveredHexIcon(0, GATE, "gateway");

    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await startAndReachOverworld(host);

    // Move onto the gateway hex (two humans -> movement vote) and win the fight.
    host.mark();
    guest.mark();
    host.send({ type: "proposeMove", target: GATE });
    const mv = await guest.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    guest.send({ type: "castVote", proposalId: mv.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    host.send({ type: "debugWin" });

    // Attunement: both sockets get gatewayUpdate with the fixed destination, and the win's
    // hexMapState broadcast already carries the new gateway (recorder runs before the broadcast).
    for (const c of [host, guest]) {
      const gu = await c.nextOf("gatewayUpdate", { fromNow: true, timeoutMs: 8000 });
      expect(gu.hex).toEqual(GATE);
      expect(gu.gateway).toEqual({ toDimensionId: DEST, toName: "E2E Depths", toTier: 1 });
    }
    const hm = await host.nextOf("hexMapState", { fromNow: true, timeoutMs: 4000 });
    expect(hm.gateways[GATE_KEY]).toEqual({ toDimensionId: DEST, toName: "E2E Depths", toTier: 1 });

    // Reconnect (fresh socket + hello auto-reclaim): the overworld snapshot carries the gateways map.
    guest.close();
    await guest.closed;
    const guest2 = await connectClient(server, guest.clientId);
    const w2 = await hello(guest2);
    expect(w2.reconnected).toBeTruthy();
    const snap = await guest2.nextOf("hexMapState", { timeoutMs: 4000 });
    expect(snap.gateways[GATE_KEY]).toEqual({ toDimensionId: DEST, toName: "E2E Depths", toTier: 1 });

    // Descent: proposeTravel opens a travel vote carrying the destination; the second yes travels.
    host.mark();
    guest2.mark();
    host.send({ type: "proposeTravel" });
    const tv = await guest2.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    expect(tv.vote).toMatchObject({
      kind: "travel",
      target: null,
      travel: { toDimensionId: DEST, toName: "E2E Depths", toTier: 1 },
    });
    guest2.send({ type: "castVote", proposalId: tv.vote!.proposalId, vote: "yes" });
    for (const c of [host, guest2]) {
      const rs = await c.waitFor(
        (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.dimensionId === DEST,
        { timeoutMs: 4000 },
      );
      expect(rs.room.dimensionName).toBe("E2E Depths");
      expect(rs.room.dimensionTier).toBe(1);
      expect(rs.room.phase).toBe("overworld");
    }
    // First travel bumps dimensions_traveled -> Depthfarer (dimension-entered recorder, flag #14).
    // Emitted BEFORE the arrival broadcasts, so consume it first (fromNow cursor ordering).
    const titles = await host.nextOf("titlesEarned", { fromNow: true, timeoutMs: 4000 });
    expect(titles.titleIds).toContain("depthfarer");
    const arrival = await host.nextOf("hexMapState", { fromNow: true, timeoutMs: 4000 });
    expect(arrival.hexMap.playerPos).toEqual({ q: 0, r: 0 });

    // Wipe in the destination -> Play Again rematches at the START dimension (flag #6), not the depth.
    host.mark();
    guest2.mark();
    host.send({ type: "proposeMove", target: { q: 1, r: 0 } });
    const mv2 = await guest2.nextOf("voteState", { fromNow: true, timeoutMs: 4000 });
    guest2.send({ type: "castVote", proposalId: mv2.vote!.proposalId, vote: "yes" });
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    host.send({ type: "debugLose" });
    await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "gameOver" }> => m.type === "gameOver",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    host.send({ type: "playAgain" });
    const rematch = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.phase === "lobby" && m.room.dimensionId === 0,
      { consumeBuffered: false, timeoutMs: 4000 },
    );
    expect(rematch.room.code).not.toBe(code);

    host.close();
    guest2.close();
  });

  it("createRoom dimensionId validation + GAME_ALLOW_UNCHARTED_DIMENSIONS dev override", async () => {
    const solo = await connectClient(server);
    await hello(solo);

    // An uncharted deep dim is rejected before any room is created.
    solo.mark();
    solo.send({ type: "createRoom", capacity: 2, dimensionId: 2 });
    expect((await solo.nextOf("error", { fromNow: true, timeoutMs: 4000 })).code).toBe("INVALID_INPUT");

    // The dev knob skips the eligibility check (existence still enforced) so a tierless/uncharted dim boots.
    process.env.GAME_ALLOW_UNCHARTED_DIMENSIONS = "1";
    try {
      solo.mark();
      solo.send({ type: "createRoom", capacity: 2, dimensionId: 2 });
      await solo.nextOf("welcome", { fromNow: true, timeoutMs: 4000 });
      const rs = await solo.waitFor(
        (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.dimensionId === 2,
        { consumeBuffered: false, timeoutMs: 4000 },
      );
      expect(rs.room.dimensionTier).toBe(1);
    } finally {
      delete process.env.GAME_ALLOW_UNCHARTED_DIMENSIONS;
    }
    solo.close();
  });
});

// =====================================================================================
// Feature 3 — loot & codex (docs/meta-loop/03-loot-codex.md §8 integration additions)
// =====================================================================================

function isOverworldRoomState(m: ServerMessage): m is Extract<ServerMessage, { type: "roomState" }> {
  return m.type === "roomState" && m.room.phase === "overworld";
}

/** Enter combat from the origin frontier and return the live room (icon overrides go on it). */
async function enterCombatLive(host: MockClient, code: string): Promise<import("../room.js").Room> {
  host.mark();
  await enterCombat(host);
  await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
  const room = rooms.get(code as never)!;
  expect(room.phase).toBe("combat");
  return room;
}

describe("loot & codex integration", () => {
  it("a treasure-hex win drops loot straight into the shared party bag", async () => {
    const host = await connectClient(server);
    await hello(host);
    const { code } = await createRoom(host, 2);
    await startAndReachOverworld(host);
    const room = await enterCombatLive(host, code);
    const ph = room.pendingHex!;
    // Override the winning hex to a treasure icon (dropChance 1.0, 2 rolls) for a guaranteed drop.
    room.hexMap = { ...room.hexMap, icons: { ...room.hexMap.icons, [hexKey(ph)]: "treasure" } };

    host.mark();
    host.send({ type: "debugWin" });
    const found = await host.nextOf("lootFound", { fromNow: true, timeoutMs: 8000 });
    expect(found.drops.length).toBeGreaterThanOrEqual(1);
    const dropIds = found.drops.map((d) => d.bagId);
    // The post-combat roomState carries every drop in the shared bag (same bagIds as the toast).
    const rs = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.phase === "overworld" &&
        dropIds.every((id) => m.room.partyBag.some((e) => e.bagId === id)),
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(rs.room.partyBag.length).toBeGreaterThanOrEqual(found.drops.length);
    host.close();
  }, 30000);

  it("a slay-boss victory banks the run's drops; getCodex from a fresh socket returns them with 'by you' provenance", async () => {
    const dbmod = await import("../db.js");
    const host = await connectClient(server);
    const w = await hello(host);
    const { code } = await createRoom(host, 2);
    await startAndReachOverworld(host);
    const room = await enterCombatLive(host, code);
    // Drops roll from the room's CURRENT dimension pool: point the live room at a private tiered
    // dimension so the first-recovery assertions can't race other tests' random dim-0 banks
    // (codex_firsts is global across the process-shared :memory: DB).
    const bossDim = 9100;
    dbmod.saveDimension(bossDim, "E2E Boss Vault", []);
    dbmod.db.prepare("UPDATE dimensions SET tier = 1 WHERE id = ?").run(bossDim);
    const relic: ItemDefinition = {
      type: "weapon", id: `e2e-bank-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "E2E Relic", description: "", rarity: "rare", sprite: "x.webp", dimensionId: bossDim,
      slotCost: { hand: 1 }, animSet: "sword", abilities: [],
    };
    dbmod.db.prepare("INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES (?, ?, ?)")
      .run(relic.id, bossDim, JSON.stringify(relic));
    room.dimensionId = bossDim;
    const ph = room.pendingHex!;
    // A boss win completes a slay-boss contract (-> victory) AND drops apex loot that banks at settle.
    room.hexMap = { ...room.hexMap, icons: { ...room.hexMap.icons, [hexKey(ph)]: "boss" } };
    room.contract = createContractState("slay-boss", ph, room.dimensionId);

    host.mark();
    host.send({ type: "debugWin" });
    const banked = await host.nextOf("codexBanked", { fromNow: true, timeoutMs: 8000 });
    expect(banked.entries.length).toBe(1); // apex rolls 2 from a one-design pool -> dedup to one entry
    expect(banked.entries[0]!.item.id).toBe(relic.id);
    expect(banked.firstItemIds).toEqual([relic.id]); // solo banker gets every first
    const over = await host.nextOf("gameOver", { fromNow: true, timeoutMs: 8000 });
    expect(over.outcome).toBe("victory");

    // A FRESH socket for the SAME account fetches the codex with resolved provenance.
    const fresh = await connectClient(server, host.clientId);
    await hello(fresh, { authToken: w.auth.authToken });
    fresh.mark();
    fresh.send({ type: "getCodex" });
    const codex = await fresh.nextOf("codex", { fromNow: true, timeoutMs: 8000 });
    const entry = codex.entries.find((e) => e.item.id === relic.id);
    expect(entry).toBeDefined();
    expect(entry!.dimensionName).toBe("E2E Boss Vault");
    expect(entry!.tier).toBe(1);
    expect(entry!.first.mine).toBe(true);
    host.close();
    fresh.close();
  }, 30000);

  it("chooseManifest stages a banked design; it lands in the party bag at start; a tier-gated design is rejected", async () => {
    const dbmod = await import("../db.js");
    const acctMod = await import("../accounts.js");
    const host = await connectClient(server);
    await hello(host);
    const acctId = acctMod.resolveGuestAccount(host.clientId).id;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const design: ItemDefinition = {
      type: "weapon", id: `e2e-mf-${suffix}`, name: "E2E Blade", description: "", rarity: "uncommon",
      sprite: "x.webp", dimensionId: 0, slotCost: { hand: 1 }, animSet: "sword", abilities: [],
    };
    const highDesign: ItemDefinition = { ...design, id: `e2e-mf-high-${suffix}`, rarity: "rare" };
    dbmod.bankCodexEntry(acctId, design, 0);
    dbmod.recordCodexFirst(design, acctId);
    dbmod.bankCodexEntry(acctId, highDesign, 2); // tier 2 > dim-0 starting tier 0
    dbmod.recordCodexFirst(highDesign, acctId);

    const { roomState } = await createRoom(host, 2);
    const mySeat = roomState.room.yourSeatId!;

    host.mark();
    host.send({ type: "chooseManifest", itemIds: [design.id] });
    // Manifests are lobby staging only now: the roster's manifestIds update, the loadout doesn't.
    const rs = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && (m.room.seats.find((s) => s.seatId === mySeat)?.manifestIds ?? []).includes(design.id),
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(rs.room.seats.find((s) => s.seatId === mySeat)!.manifestIds).toContain(design.id);

    host.mark();
    host.send({ type: "chooseManifest", itemIds: [highDesign.id] });
    const err = await host.nextOf("error", { fromNow: true, timeoutMs: 8000 });
    expect(err.message).toBe("That design's tier exceeds this expedition");

    // Re-stage the eligible design, then start: it materializes into the shared party bag.
    host.send({ type: "chooseManifest", itemIds: [design.id] });
    host.send({ type: "startGame" });
    const over = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(over.room.partyBag.some((e) => e.item.id === design.id)).toBe(true);
    host.close();
  }, 30000);

  it("two humans: an unequipped item lands in the shared bag and the other seat can equip it", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    await startAndReachOverworld(host);
    void code;

    // Guest returns its sword to the shared bag; the deposit is visible to the host too.
    const ginv = guest.latest("inventory")!;
    const swordIdx = ginv.inventory.equipped.findIndex((i) => i.id === "short-sword");
    expect(swordIdx).toBeGreaterThanOrEqual(0);
    guest.send({ type: "unequip", equippedIndex: swordIdx });
    const withDeposit = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.partyBag.some((e) => e.item.id === "short-sword"),
      { timeoutMs: 8000 },
    );
    const deposited = withDeposit.room.partyBag.find((e) => e.item.id === "short-sword")!;

    // Host frees a hand (its own sword goes to the bag), then wields the guest's sword.
    const hinv = host.latest("inventory")!;
    const hostSwordIdx = hinv.inventory.equipped.findIndex((i) => i.id === "short-sword");
    host.mark();
    host.send({ type: "unequip", equippedIndex: hostSwordIdx });
    await host.nextOf("inventory", { fromNow: true, timeoutMs: 8000 });
    host.mark();
    host.send({ type: "equip", bagId: deposited.bagId });
    const after = await host.nextOf("inventory", { fromNow: true, timeoutMs: 8000 });
    expect(after.inventory.equipped.some((i) => i.id === "short-sword")).toBe(true);
    // The guest's specific deposit is gone from the bag; the host's own deposit remains.
    // (Positive match on the host's deposit so buffered empty-bag lobby states can't satisfy it.)
    const drained = await guest.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" &&
        m.room.partyBag.some((e) => e.item.id === "short-sword") &&
        !m.room.partyBag.some((e) => e.bagId === deposited.bagId),
      { timeoutMs: 8000 },
    );
    expect(drained.room.partyBag.some((e) => e.item.id === "short-sword")).toBe(true);
    host.close();
    guest.close();
  }, 30000);
});

// =====================================================================================
// Feature 5 — difficulty & themed encounters (docs/meta-loop/05-difficulty.md §8 additions)
// =====================================================================================

describe("difficulty & rest integration", () => {
  it("combatStart carries a themed archetype resolvable via the shared catalog", async () => {
    const host = await connectClient(server);
    await hello(host);
    await createRoom(host, 2);
    await startAndReachOverworld(host);
    host.mark();
    await enterCombat(host);
    const cs = await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    expect(typeof cs.archetype).toBe("string");
    const a = archetypeById(cs.archetype); // throws on an unknown id
    expect(a.id).toBe(cs.archetype);
    expect(a.flavor.length).toBeGreaterThan(0);
    host.close();
  }, 20000);

  it("clearing a town arms rest (restUpdate + roomState truth); the next combat entry consumes it", async () => {
    const host = await connectClient(server);
    await hello(host);
    const { code } = await createRoom(host, 2);
    await startAndReachOverworld(host);
    const room = await enterCombatLive(host, code);
    const ph = room.pendingHex!;
    // Make the hex the party just entered a town (a rest node): winning it liberates the settlement.
    room.hexMap = { ...room.hexMap, icons: { ...room.hexMap.icons, [hexKey(ph)]: "town" } };

    host.mark();
    host.send({ type: "debugWin" });

    // restUpdate is broadcast (io.broadcast fans to every seat — the both-sockets fan-out is asserted
    // deterministically at the machine level); the overworld roomState truth carries rested: true.
    const rest = await host.nextOf("restUpdate", { fromNow: true, timeoutMs: 8000 });
    expect(rest.rested).toBe(true);
    const restedState = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.phase === "overworld" && m.room.rested,
      { consumeBuffered: false, timeoutMs: 8000 },
    );
    expect(restedState.room.rested).toBe(true);
    expect(room.rested).toBe(true);

    // Enter the next fight on a different frontier hex -> rest is consumed on entry (server truth
    // flips synchronously before combatStart is broadcast).
    host.mark();
    host.send({ type: "proposeMove", target: { q: 2, r: 0 } }); // solo -> resolves instantly
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });
    expect(room.rested).toBe(false);

    host.close();
  }, 30000);

  it("a solo start scales its first encounter's budget down to party size 1 (no bot padding)", async () => {
    const host = await connectClient(server);
    await hello(host);
    const { code } = await createRoom(host, 4); // 4-seat room, but only the host starts -> party of 1
    const overworld = await startAndReachOverworld(host);
    expect(overworld.room.seats.length).toBe(1); // the three open seats were dropped, not bot-filled
    host.mark();
    await enterCombat(host); // single human -> resolves instantly
    await host.nextOf("combatStart", { fromNow: true, timeoutMs: 8000 });

    const room = rooms.get(code as never)!;
    expect(room.seats.length).toBe(1);
    const ph = room.pendingHex!;
    const hexType = getHexIcon(ph, room.hexMap.icons) ?? (isDecorationHex(ph) ? "dense-wilderness" : "wilderness");
    const base = getEncounterProfile(hexType).enemyBudget;
    const expected = effectiveEnemyBudget(base, {
      dimensionTier: room.dimensionTier,
      distanceFromOrigin: hexDistance(ph, { q: 0, r: 0 }),
      partySize: 1, // seats.length, not the room capacity of 4
    });
    expect(room.session!.effectiveBudget).toBe(expected);

    const blue = [...room.session!.state.entities.values()].filter((e) => e.teamId === "blue");
    expect(blue.length).toBeGreaterThanOrEqual(1);
    expect(blue.length).toBeLessThanOrEqual(12); // MAX_ENCOUNTER_ENEMIES ceiling
    host.close();
  }, 20000);
});
