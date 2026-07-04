import { describe, it, expect } from "bun:test";

// db.ts opens its Database at module load from GAME_DB_PATH, so set the env BEFORE importing
// it (a static import would hoist above these assignments). :memory: keeps the test hermetic.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");

describe("durable DB: global discovery + per-run cleared (Phase 3 / v3)", () => {
  it("discovery is GLOBAL per dimension; discoverHex reports first-ever vs repeat", () => {
    // Uses dims 90/91 (untouched by seeds, the harness, or other tests) — the db.ts module opens ONE
    // shared :memory: connection across every test file, so first-ever/count assertions must use
    // dimensions nothing else discovers into.
    expect(db.discoverHex(90, { q: 5, r: 0 })).toBe(true); // first-ever
    expect(db.discoverHex(90, { q: 5, r: 0 })).toBe(false); // repeat -> no new row
    expect(db.loadDiscoveredHexes(90)["5,0"]).toBe("explored");
    expect(db.loadDiscoveredHexes(91)["5,0"]).toBeUndefined();

    db.seedDiscovery(91, 1); // 7-hex disc into dim 91 only
    expect(Object.keys(db.loadDiscoveredHexes(91)).length).toBe(7);
    expect(db.loadDiscoveredHexes(91)["5,0"]).toBeUndefined();
  });

  it("run_cleared is per-run; a discovery persists across runs in the same dimension", () => {
    const runA = db.startNewRun(7, "clientA", 4);
    const runB = db.startNewRun(7, "clientB", 2);
    expect(runA).toBeGreaterThan(0);

    // commitExplore in runA discovers (q,r) globally for dim 7 AND clears it for runA only.
    expect(db.commitExplore(7, runA, { q: 1, r: 0 }, "wilderness")).toBe(true); // first-ever
    db.markRunCleared(runA, 7, { q: 0, r: 0 });

    expect([...db.loadRunCleared(runA, 7)].sort()).toEqual(["0,0", "1,0"]);
    expect(db.loadRunCleared(runB, 7).size).toBe(0); // runB has no cleared hexes

    // The community discovery from runA is visible to the later runB in the same dimension.
    expect(db.loadDiscoveredHexes(7)["1,0"]).toBe("explored");
    expect(db.loadDiscoveredHexIcons(7)["1,0"]).toBe("wilderness");
    // ...but a re-discovery is no longer first-ever (community already revealed it).
    expect(db.commitExplore(7, runB, { q: 1, r: 0 }, "wilderness")).toBe(false);
  });

  it("binds seats, finds the live seat for a client, and stamps them on run end", () => {
    const runId = db.startNewRun(1, "owner", 2);
    db.upsertRunSeat(runId, 0, { clientId: "owner", displayName: "Ann", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });
    db.upsertRunSeat(runId, 1, { clientId: null, displayName: "Bot", controllerKind: "bot", tokenSalt: null, accountId: null });

    const seats = db.loadRunSeats(runId);
    expect(seats.map((s) => s.controller_kind)).toEqual(["human", "bot"]);

    expect(db.findActiveSeatForClient("owner")).toEqual({ runId, seatIndex: 0 });

    db.finalizeRun(runId, "victory");
    expect(db.findActiveSeatForClient("owner")).toBeNull(); // run inactive + seat left-stamped
  });

  it("run.phase is the lifecycle SSOT; finalizeRun is idempotent first-writer-wins", () => {
    const runId = db.startNewRun(1, "owner2", 2);
    expect(db.loadRun(runId)?.phase).toBe("lobby"); // INSERT default
    expect(db.loadRun(runId)?.active).toBe(1);

    db.setRunPhase(runId, "overworld");
    expect(db.loadRun(runId)?.phase).toBe("overworld");

    // First finalize transitions; a second (different outcome) is a no-op that cannot clobber.
    expect(db.finalizeRun(runId, "defeat")).toBe(true);
    expect(db.loadRun(runId)?.active).toBe(0);
    expect(db.loadRun(runId)?.outcome).toBe("defeat");
    expect(db.loadRun(runId)?.phase).toBe("gameover"); // finalize persists phase too

    expect(db.finalizeRun(runId, "abandoned")).toBe(false); // already final -> no-op
    expect(db.loadRun(runId)?.outcome).toBe("defeat"); // outcome NOT clobbered

    db.setRunPhase(runId, "overworld"); // a dead run has no phase -> no-op (AND active=1 guard)
    expect(db.loadRun(runId)?.phase).toBe("gameover");
  });

  it("enforces one live human seat per client across runs (R6/R32)", () => {
    const r1 = db.startNewRun(1, "dup", 2);
    db.upsertRunSeat(r1, 0, { clientId: "dup", displayName: "A", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });
    const r2 = db.startNewRun(1, "dup", 2);
    expect(() =>
      db.upsertRunSeat(r2, 0, { clientId: "dup", displayName: "A", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null }),
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
    db.saveSeatInventory(runId, 0, { equipped: [], attachments: {} });
    const inv = db.loadSeatInventory(runId, 0);
    expect(inv.equipped.length).toBe(0);
  });

  it("abandonPriorSeatForClient frees the client to take a new seat without a UNIQUE crash (R32)", () => {
    const r1 = db.startNewRun(1, "switcher", 2);
    db.upsertRunSeat(r1, 0, { clientId: "switcher", displayName: "S", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });
    expect(db.findActiveSeatForClient("switcher")).toEqual({ runId: r1, seatIndex: 0 });

    // Abandon the prior seat (solo run -> run inactivated), then a fresh create reuses the clientId.
    const result = db.abandonPriorSeatForClient("switcher");
    expect(result).toEqual({ runId: r1, seatIndex: 0, runInactivated: true });
    expect(db.findActiveSeatForClient("switcher")).toBeNull();
    expect(db.loadRun(r1)!.active).toBe(0);

    const r2 = db.startNewRun(1, "switcher", 2);
    expect(() =>
      db.upsertRunSeat(r2, 0, { clientId: "switcher", displayName: "S", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null }),
    ).not.toThrow();
    expect(db.findActiveSeatForClient("switcher")).toEqual({ runId: r2, seatIndex: 0 });
  });

  it("abandonPriorSeatForClient leaves a multi-human prior run active (only stamps the leaving seat)", () => {
    const r = db.startNewRun(1, "host2", 2);
    db.upsertRunSeat(r, 0, { clientId: "host2", displayName: "H", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });
    db.upsertRunSeat(r, 1, { clientId: "guest2", displayName: "G", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });

    const result = db.abandonPriorSeatForClient("guest2");
    expect(result).toEqual({ runId: r, seatIndex: 1, runInactivated: false });
    expect(db.loadRun(r)!.active).toBe(1); // host still live -> run stays active
    expect(db.findActiveSeatForClient("host2")).toEqual({ runId: r, seatIndex: 0 });
    expect(db.findActiveSeatForClient("guest2")).toBeNull();
  });

  it("commitExplore advances global discovery + icon + per-run cleared + party position atomically (write point 4 / R13.2)", () => {
    const runId = db.startNewRun(11, "explorer", 2);
    db.markRunCleared(runId, 11, { q: 0, r: 0 });
    db.commitExplore(11, runId, { q: 1, r: 0 }, "wilderness");

    expect([...db.loadRunCleared(runId, 11)].sort()).toEqual(["0,0", "1,0"]);
    expect(db.loadDiscoveredHexes(11)["1,0"]).toBe("explored");
    expect(db.loadDiscoveredHexIcons(11)["1,0"]).toBe("wilderness");
    const run = db.loadRun(runId)!;
    expect([run.party_q, run.party_r]).toEqual([1, 0]);
  });

  it("eraseClient hard-deletes per-run rows but leaves the GLOBAL community map intact (R33)", () => {
    const runId = db.startNewRun(12, "gdpr", 2);
    db.upsertRunSeat(runId, 0, { clientId: "gdpr", displayName: "X", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });
    db.saveSeatInventory(runId, 0, { equipped: [], attachments: {} });
    db.commitExplore(12, runId, { q: 1, r: 0 }, "wilderness"); // global discovery + this-run cleared

    const erased = db.eraseClient("gdpr");
    expect(erased).toBe(1);
    expect(db.loadRun(runId)).toBeNull();
    expect(db.loadRunSeats(runId).length).toBe(0);
    expect(db.loadRunCleared(runId, 12).size).toBe(0); // per-run cleared erased
    expect(db.findActiveSeatForClient("gdpr")).toBeNull();
    // The community discovery is shared, non-personal world state and survives the erasure.
    expect(db.loadDiscoveredHexes(12)["1,0"]).toBe("explored");
  });

  it("mints HMAC session tokens that verify only for the right client (R29)", () => {
    const salt = db.newTokenSalt();
    const token = db.mintSessionToken("clientA", salt);
    expect(db.verifySessionToken(token, "clientA", salt)).toBe(true);
    expect(db.verifySessionToken(token, "clientB", salt)).toBe(false);
    expect(db.verifySessionToken(token, "clientA", db.newTokenSalt())).toBe(false);
  });
});

// =====================================================================================
// Contracts & run outcomes (v7): pending-XP ledger, banking, contract snapshot
// (docs/meta-loop/02-contracts.md §8)
// =====================================================================================

let acctSeq = 0;

/** Minimal profile row so bankXpStmt has a target (accounts.ts owns real minting). */
function mkProfileAccount(): string {
  const id = `acct-${++acctSeq}`;
  const now = new Date().toISOString();
  db.db
    .prepare("INSERT INTO profiles (account_id, display_name, xp, created_at, updated_at) VALUES (?, ?, 0, ?, ?)")
    .run(id, `T${acctSeq}`, now, now);
  return id;
}

function profileXp(accountId: string): number {
  return (db.db.prepare("SELECT xp FROM profiles WHERE account_id = ?").get(accountId) as { xp: number }).xp;
}

describe("pending-XP ledger + finalizeRun banking (v7)", () => {
  it("accruePendingXp upserts per (run, account) and returns the running total", () => {
    const runId = db.startNewRun(1, "ledger-a", 2);
    const a = mkProfileAccount();
    const b = mkProfileAccount();

    expect(db.accruePendingXp(runId, a, 25)).toBe(25);
    expect(db.accruePendingXp(runId, a, 25)).toBe(50); // same account accumulates
    expect(db.accruePendingXp(runId, b, 25)).toBe(25); // distinct accounts are separate rows

    const rows = db.loadPendingXp(runId).sort((x, y) => x.account_id.localeCompare(y.account_id));
    expect(rows).toEqual([
      { account_id: a, amount: 50 },
      { account_id: b, amount: 25 },
    ]);
  });

  it("finalizeRun banks the ledger with the outcome multiplier — exactly once (all four outcomes)", () => {
    const cases = [
      { outcome: "victory" as const, banked: 25 },
      { outcome: "retreat" as const, banked: 12 }, // floor(25 * 0.5)
      { outcome: "defeat" as const, banked: 12 },
      { outcome: "abandoned" as const, banked: 12 },
    ];
    for (const { outcome, banked } of cases) {
      const runId = db.startNewRun(1, `bank-${outcome}`, 2);
      const account = mkProfileAccount();
      db.accruePendingXp(runId, account, 25);

      expect(db.finalizeRun(runId, outcome)).toBe(true);
      expect(profileXp(account)).toBe(banked);
      // Ledger rows survive banking (audit + settlement pushes read them back).
      expect(db.loadPendingXp(runId)).toEqual([{ account_id: account, amount: 25 }]);

      // The load-bearing idempotency proof: a second finalize is a no-op and does NOT re-bank.
      expect(db.finalizeRun(runId, "abandoned")).toBe(false);
      expect(profileXp(account)).toBe(banked);
    }
  });

  it("saveRunContract round-trips through runs.contract_json and freezes on a finalized run", () => {
    const runId = db.startNewRun(1, "contract-rt", 2);
    const state = { type: "chart-hexes", targetHex: null, targetDimensionId: null, progress: 3, required: 10, completed: false };
    db.saveRunContract(runId, state as never);
    expect(JSON.parse(db.loadRun(runId)!.contract_json!)).toEqual(state);

    db.finalizeRun(runId, "retreat");
    db.saveRunContract(runId, { ...state, progress: 9 } as never); // AND active = 1 -> no-op
    expect(JSON.parse(db.loadRun(runId)!.contract_json!)).toEqual(state);
  });

  it("eraseClient deletes the client's run_pending_xp rows with the run's other rows", () => {
    const runId = db.startNewRun(1, "gdpr-xp", 2);
    db.upsertRunSeat(runId, 0, { clientId: "gdpr-xp", displayName: "X", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: null });
    const account = mkProfileAccount();
    db.accruePendingXp(runId, account, 25);
    expect(db.loadPendingXp(runId).length).toBe(1);

    expect(db.eraseClient("gdpr-xp")).toBe(1);
    expect(db.loadPendingXp(runId)).toEqual([]);
  });
});
