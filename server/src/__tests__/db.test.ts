import { describe, it, expect } from "bun:test";

// db.ts opens its Database at module load from GAME_DB_PATH, so set the env BEFORE importing
// it (a static import would hoist above these assignments). :memory: keeps the test hermetic.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");

describe("durable run-scoped DB (Phase 3)", () => {
  it("creates runs and scopes exploration, with monotonic `cleared`", () => {
    const runId = db.startNewRun(3, "clientA", 4);
    expect(runId).toBeGreaterThan(0);

    db.saveExploredHex(runId, { q: 0, r: 0 }, true);
    db.saveExploredHex(runId, { q: 1, r: 0 }, false);
    db.saveExploredHex(runId, { q: 1, r: 0 }, true); // ON CONFLICT MAX => stays cleared
    db.seedDiscovery(runId, 1);

    const hexes = db.loadExploredHexes(runId);
    const cleared = db.loadClearedHexes(runId);
    expect(Object.keys(hexes).length).toBe(7); // origin + (1,0) + radius-1 ring
    expect([...cleared].sort()).toEqual(["0,0", "1,0"]);

    // a different run is fully isolated
    const other = db.startNewRun(1, "clientB", 2);
    expect(Object.keys(db.loadExploredHexes(other)).length).toBe(0);
  });

  it("binds seats, finds the live seat for a client, and stamps them on run end", () => {
    const runId = db.startNewRun(1, "owner", 2);
    db.upsertRunSeat(runId, 0, { clientId: "owner", displayName: "Ann", controllerKind: "human", tokenSalt: db.newTokenSalt() });
    db.upsertRunSeat(runId, 1, { clientId: null, displayName: "Bot", controllerKind: "bot", tokenSalt: null });

    const seats = db.loadRunSeats(runId);
    expect(seats.map((s) => s.controller_kind)).toEqual(["human", "bot"]);

    expect(db.findActiveSeatForClient("owner")).toEqual({ runId, seatIndex: 0 });

    db.markRunInactive(runId, "victory");
    expect(db.findActiveSeatForClient("owner")).toBeNull(); // run inactive + seat left-stamped
  });

  it("enforces one live human seat per client across runs (R6/R32)", () => {
    const r1 = db.startNewRun(1, "dup", 2);
    db.upsertRunSeat(r1, 0, { clientId: "dup", displayName: "A", controllerKind: "human", tokenSalt: db.newTokenSalt() });
    const r2 = db.startNewRun(1, "dup", 2);
    expect(() =>
      db.upsertRunSeat(r2, 0, { clientId: "dup", displayName: "A", controllerKind: "human", tokenSalt: db.newTokenSalt() }),
    ).toThrow(); // unique partial index on live (left_at IS NULL) client_id
  });

  it("persists and updates party position", () => {
    const runId = db.startNewRun(2, "p", 3);
    db.updateRunPartyPos(runId, { q: 2, r: -1 });
    const run = db.loadRun(runId)!;
    expect([run.party_q, run.party_r]).toEqual([2, -1]);
    expect(run.capacity).toBe(3);
    expect(run.dimension_id).toBe(2);
  });

  it("round-trips a per-seat inventory (empty) and tolerates no seeded items", () => {
    const runId = db.startNewRun(1, "inv", 2);
    db.saveSeatInventory(runId, 0, { bag: new Array(16).fill(null), equipped: [], attachments: {} });
    const inv = db.loadSeatInventory(runId, 0, 1);
    expect(inv.bag.length).toBe(16);
    expect(inv.equipped.length).toBe(0);
  });

  it("abandonPriorSeatForClient frees the client to take a new seat without a UNIQUE crash (R32)", () => {
    const r1 = db.startNewRun(1, "switcher", 2);
    db.upsertRunSeat(r1, 0, { clientId: "switcher", displayName: "S", controllerKind: "human", tokenSalt: db.newTokenSalt() });
    expect(db.findActiveSeatForClient("switcher")).toEqual({ runId: r1, seatIndex: 0 });

    // Abandon the prior seat (solo run -> run inactivated), then a fresh create reuses the clientId.
    const result = db.abandonPriorSeatForClient("switcher");
    expect(result).toEqual({ runId: r1, seatIndex: 0, runInactivated: true });
    expect(db.findActiveSeatForClient("switcher")).toBeNull();
    expect(db.loadRun(r1)!.active).toBe(0);

    const r2 = db.startNewRun(1, "switcher", 2);
    expect(() =>
      db.upsertRunSeat(r2, 0, { clientId: "switcher", displayName: "S", controllerKind: "human", tokenSalt: db.newTokenSalt() }),
    ).not.toThrow();
    expect(db.findActiveSeatForClient("switcher")).toEqual({ runId: r2, seatIndex: 0 });
  });

  it("abandonPriorSeatForClient leaves a multi-human prior run active (only stamps the leaving seat)", () => {
    const r = db.startNewRun(1, "host2", 2);
    db.upsertRunSeat(r, 0, { clientId: "host2", displayName: "H", controllerKind: "human", tokenSalt: db.newTokenSalt() });
    db.upsertRunSeat(r, 1, { clientId: "guest2", displayName: "G", controllerKind: "human", tokenSalt: db.newTokenSalt() });

    const result = db.abandonPriorSeatForClient("guest2");
    expect(result).toEqual({ runId: r, seatIndex: 1, runInactivated: false });
    expect(db.loadRun(r)!.active).toBe(1); // host still live -> run stays active
    expect(db.findActiveSeatForClient("host2")).toEqual({ runId: r, seatIndex: 0 });
    expect(db.findActiveSeatForClient("guest2")).toBeNull();
  });

  it("commitExplore advances cleared+icon+party position atomically (write point 4 / R13.2)", () => {
    const runId = db.startNewRun(1, "explorer", 2);
    db.saveExploredHex(runId, { q: 0, r: 0 }, true);
    db.commitExplore(runId, { q: 1, r: 0 }, "wilderness");

    expect([...db.loadClearedHexes(runId)].sort()).toEqual(["0,0", "1,0"]);
    expect(db.loadExploredHexIcons(runId)["1,0"]).toBe("wilderness");
    const run = db.loadRun(runId)!;
    expect([run.party_q, run.party_r]).toEqual([1, 0]);
  });

  it("eraseClient hard-deletes every durable row for a client's runs (R33)", () => {
    const runId = db.startNewRun(1, "gdpr", 2);
    db.upsertRunSeat(runId, 0, { clientId: "gdpr", displayName: "X", controllerKind: "human", tokenSalt: db.newTokenSalt() });
    db.saveSeatInventory(runId, 0, { bag: new Array(16).fill(null), equipped: [], attachments: {} });
    db.saveExploredHex(runId, { q: 0, r: 0 }, true);

    const erased = db.eraseClient("gdpr");
    expect(erased).toBe(1);
    expect(db.loadRun(runId)).toBeNull();
    expect(db.loadRunSeats(runId).length).toBe(0);
    expect(Object.keys(db.loadExploredHexes(runId)).length).toBe(0);
    expect(db.findActiveSeatForClient("gdpr")).toBeNull();
  });

  it("mints HMAC session tokens that verify only for the right client (R29)", () => {
    const salt = db.newTokenSalt();
    const token = db.mintSessionToken("clientA", salt);
    expect(db.verifySessionToken(token, "clientA", salt)).toBe(true);
    expect(db.verifySessionToken(token, "clientB", salt)).toBe(false);
    expect(db.verifySessionToken(token, "clientA", db.newTokenSalt())).toBe(false);
  });
});
