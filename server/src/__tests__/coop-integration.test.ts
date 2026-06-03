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
    await hello(host, "Host");
    await hello(guest, "Guest");

    const { code, roomState } = await createRoom(host, 3);
    expect(roomState.room.seats[0]!.state).toBe("human-connected");
    expect(roomState.room.hostSeatId).toBe("s0");
    expect(roomState.room.yourSeatId).toBe("s0");

    // guest joins by code
    guest.mark();
    guest.send({ type: "joinRoom", code, displayName: "Guest" });
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

  it("solo: create + start with bot-fill, enter combat with per-seat heroes carrying controllerId", async () => {
    const host = await connectClient(server);
    await hello(host, "Solo");
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

  it("shared player phase: human acts + passes, phase ends only when all ready, then enemy phase runs; reach a win", async () => {
    const host = await connectClient(server);
    await hello(host, "Fighter");
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
    await hello(host, "Host");
    await hello(guest, "Guest");
    const { code } = await createRoom(host, 2);

    guest.send({ type: "joinRoom", code, displayName: "Guest" });
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
    const w2 = await hello(guest2, "Guest");
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
    await hello(host, "Host");
    await hello(guest, "Guest");
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code, displayName: "Guest" });
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
    await hello(host, "Host");
    await hello(guest, "Guest");
    const { code } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code, displayName: "Guest" });
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
    const w2 = await hello(guest2, "Guest");
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
    await hello(owner, "Owner");
    const { code } = await createRoom(owner, 2);

    // A second connection with the SAME clientId hello's -> welcome (no reconnect since seat is live).
    const intruder = await connectClient(server, owner.clientId);
    const w = await hello(intruder, "Owner2");
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
    await hello(client, "Replayer");

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
    await hello(client, "Switcher");
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
    await hello(c1, "R");
    await createRoom(c1, 2);
    c1.close();
    await c1.closed;
    await sleep(150); // lobby empties -> run abandoned durably

    // A fresh socket with the same clientId can create again (no UNIQUE-live crash, no silent hang).
    const c2 = await connectClient(server, id);
    await hello(c2, "R");
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
    await hello(host, "SoloDefend");
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
    await hello(host, "Host");
    await hello(late, "Late");
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
