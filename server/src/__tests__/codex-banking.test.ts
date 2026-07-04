import { describe, it, expect } from "bun:test";
import type { SeatId, ServerMessage, ItemDefinition } from "shared";
import type { RunEvent } from "../run-events.js";

process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");
const codex = await import("../codex.js");
const fx = await import("./machine-fixtures.js");
const { mkWeapon, recordingIO, ORIGIN } = fx;
type SentRecord = import("./machine-fixtures.js").SentRecord;

function mkDim(id: number, tier: number | null): void {
  db.saveDimension(id, `Dim ${id}`, []);
  if (tier !== null) db.db.prepare("UPDATE dimensions SET tier = ? WHERE id = ?").run(tier, id);
}

function buildRoom(opts: { dim: number; tier: number | null; humans?: number; sameAccount?: boolean }) {
  return fx.buildTestRoom({
    dim: opts.dim,
    tier: opts.tier,
    humans: opts.humans ?? 2,
    capacity: Math.max(opts.humans ?? 2, 2),
    sameAccount: opts.sameAccount ?? false,
    prefix: "cbank",
  });
}

function dropRow(runId: number, item: ItemDefinition): void {
  db.commitLootDrops(runId, [item], ORIGIN, "treasure");
}

function ev(runId: number, outcome: "victory" | "defeat" | "retreat" | "abandoned"): Extract<RunEvent, { type: "run-ended" }> {
  return { type: "run-ended", runId, outcome, contract: null };
}

function codexBankedFor(sends: SentRecord[], seatId: SeatId): Extract<ServerMessage, { type: "codexBanked" }> | undefined {
  return sends.find((s) => s.seatId === seatId && s.msg.type === "codexBanked")?.msg as Extract<ServerMessage, { type: "codexBanked" }> | undefined;
}

describe("codexBankingRecorder — victory", () => {
  it("banks every found design to every eligible account; first-recovery credit goes to the host", () => {
    mkDim(8300, 1);
    const { room, runId, accountIds } = buildRoom({ dim: 8300, tier: 1, humans: 2 });
    const [accA, accB] = accountIds as [string, string];
    dropRow(runId, mkWeapon("cbank-d1", 8300));
    dropRow(runId, mkWeapon("cbank-d2", 8300));

    const { io, sends } = recordingIO();
    codex.codexBankingRecorder(room, io, ev(runId, "victory"));

    // Both accounts gained BOTH designs (party-shared bag: everyone banks every find, flag #2).
    for (const acc of [accA, accB]) {
      expect(db.loadCodexEntry(acc, "cbank-d1")).not.toBeNull();
      expect(db.loadCodexEntry(acc, "cbank-d2")).not.toBeNull();
    }
    // First-recovery: drops have no per-seat claimant, so the host (seat A) is the discoverer.
    expect(db.loadCodexFirst("cbank-d1")!.account_id).toBe(accA);
    expect(db.loadCodexFirst("cbank-d2")!.account_id).toBe(accA);

    // Per-seat pushes carry the right entries + firstItemIds.
    const pushA = codexBankedFor(sends, room.seats[0]!.seatId)!;
    const pushB = codexBankedFor(sends, room.seats[1]!.seatId)!;
    expect(pushA.entries.map((e) => e.item.id).sort()).toEqual(["cbank-d1", "cbank-d2"]);
    expect(pushB.entries.map((e) => e.item.id).sort()).toEqual(["cbank-d1", "cbank-d2"]);
    expect([...pushA.firstItemIds].sort()).toEqual(["cbank-d1", "cbank-d2"]);
    expect(pushB.firstItemIds).toEqual([]);

    // Stats bumped; trailblazer earned (firsts_recovered >= 1).
    expect(accounts.getStats(accA)["designs_recovered"]).toBe(2);
    expect(accounts.getStats(accA)["firsts_recovered"]).toBe(2);
    const titlesA = sends.filter((s) => s.seatId === room.seats[0]!.seatId && s.msg.type === "titlesEarned")
      .flatMap((s) => (s.msg as Extract<ServerMessage, { type: "titlesEarned" }>).titleIds);
    expect(titlesA).toContain("trailblazer");
  });

  it("provenance payload resolves dimension name + mine flag", () => {
    mkDim(8301, 2);
    const { room, runId, accountIds } = buildRoom({ dim: 8301, tier: 2, humans: 1 });
    const [accA] = accountIds as [string];
    dropRow(runId, mkWeapon("cbank-prov", 8301));
    const { io } = recordingIO();
    codex.codexBankingRecorder(room, io, ev(runId, "victory"));

    const entries = db.loadCodex(accA).map((r) => codex.codexEntryPayload(r, accA));
    const prov = entries.find((e) => e.item.id === "cbank-prov")!;
    expect(prov.tier).toBe(2); // snapshot from getDimensionMeta, flag #4
    expect(prov.dimensionName).toBe("Dim 8301");
    expect(prov.first.mine).toBe(true);
  });
});

describe("codexBankingRecorder — outcome gate", () => {
  it("retreat banks; defeat and abandoned bank nothing (rows remain)", () => {
    mkDim(8302, 1);
    // retreat banks.
    {
      const { room, runId, accountIds } = buildRoom({ dim: 8302, tier: 1, humans: 1 });
      dropRow(runId, mkWeapon("cbank-retreat", 8302));
      const { io } = recordingIO();
      codex.codexBankingRecorder(room, io, ev(runId, "retreat"));
      expect(db.loadCodexEntry(accountIds[0]!, "cbank-retreat")).not.toBeNull();
    }
    // defeat banks nothing.
    {
      const { room, runId, accountIds } = buildRoom({ dim: 8302, tier: 1, humans: 1 });
      dropRow(runId, mkWeapon("cbank-defeat", 8302));
      const { io } = recordingIO();
      codex.codexBankingRecorder(room, io, ev(runId, "defeat"));
      expect(db.loadCodexEntry(accountIds[0]!, "cbank-defeat")).toBeNull();
      expect(db.loadRunLoot(runId).length).toBe(1); // rows remain (audit trail)
    }
    // abandoned banks nothing.
    {
      const { room, runId, accountIds } = buildRoom({ dim: 8302, tier: 1, humans: 1 });
      dropRow(runId, mkWeapon("cbank-abandon", 8302));
      const { io } = recordingIO();
      codex.codexBankingRecorder(room, io, ev(runId, "abandoned"));
      expect(db.loadCodexEntry(accountIds[0]!, "cbank-abandon")).toBeNull();
    }
  });
});

describe("codexBankingRecorder — dedup + idempotency", () => {
  it("a design already known to A is absent from A's push but present in B's; discoverer stays put", () => {
    mkDim(8303, 1);
    const { room, runId, accountIds } = buildRoom({ dim: 8303, tier: 1, humans: 2 });
    const [accA, accB] = accountIds as [string, string];
    // Pre-bank the design into A (and set A as the pre-existing first).
    const known = mkWeapon("cbank-known", 8303);
    db.bankCodexEntry(accA, known, 1);
    db.recordCodexFirst(known, accA);
    dropRow(runId, known); // unclaimed -> host A, but A already knows it

    const { io, sends } = recordingIO();
    codex.codexBankingRecorder(room, io, ev(runId, "victory"));

    const pushA = codexBankedFor(sends, room.seats[0]!.seatId)!;
    const pushB = codexBankedFor(sends, room.seats[1]!.seatId)!;
    expect(pushA.entries.map((e) => e.item.id)).not.toContain("cbank-known"); // A already had it
    expect(pushB.entries.map((e) => e.item.id)).toContain("cbank-known"); // new to B
    expect(db.loadCodexFirst("cbank-known")!.account_id).toBe(accA); // unchanged
  });

  it("double-settle cannot double-bank (INSERT OR IGNORE)", () => {
    mkDim(8304, 1);
    const { room, runId, accountIds } = buildRoom({ dim: 8304, tier: 1, humans: 1 });
    const [accA] = accountIds as [string];
    dropRow(runId, mkWeapon("cbank-once", 8304));
    const { io } = recordingIO();
    codex.codexBankingRecorder(room, io, ev(runId, "victory"));
    codex.codexBankingRecorder(room, io, ev(runId, "victory")); // simulate a double emit
    expect(accounts.getStats(accA)["designs_recovered"]).toBe(1); // not 2
    expect(accounts.getStats(accA)["firsts_recovered"]).toBe(1);
  });

  it("same account on two seats: one codex row, one push per seat", () => {
    mkDim(8305, 1);
    const { room, runId, accountIds } = buildRoom({ dim: 8305, tier: 1, humans: 2, sameAccount: true });
    const [accX] = accountIds as [string, string];
    dropRow(runId, mkWeapon("cbank-shared", 8305));
    const { io, sends } = recordingIO();
    codex.codexBankingRecorder(room, io, ev(runId, "victory"));

    expect(db.loadCodex(accX).filter((r) => r.item_id === "cbank-shared").length).toBe(1);
    expect(accounts.getStats(accX)["designs_recovered"]).toBe(1); // dedup at PK
    const pushes = sends.filter((s) => s.msg.type === "codexBanked");
    expect(pushes.length).toBe(2); // one per seat
  });
});

describe("codexBankingRecorder — bag deposits never bank", () => {
  it("an unequipped (player-deposited) item banks nothing; a dropped design still banks", () => {
    mkDim(8308, 1);
    const { room, runId, accountIds } = buildRoom({ dim: 8308, tier: 1, humans: 1 });
    const [accA] = accountIds as [string];
    dropRow(runId, mkWeapon("cbank-found", 8308));
    // A preset item unequipped into the party bag: storage only, never a find.
    db.commitBagDeposit(runId, mkWeapon("cbank-preset", 8308), 0, { equipped: [], attachments: {} });

    const { io } = recordingIO();
    codex.codexBankingRecorder(room, io, ev(runId, "victory"));

    expect(db.loadCodexEntry(accA, "cbank-found")).not.toBeNull();
    expect(db.loadCodexEntry(accA, "cbank-preset")).toBeNull();
    expect(db.loadCodexFirst("cbank-preset")).toBeNull(); // no false first-recovery
  });
});

describe("codexBankingRecorder — untiered skip (flag #5)", () => {
  it("skips untiered-dimension designs with a count + console.error; tiered designs still bank", () => {
    mkDim(8306, 1); // tiered
    mkDim(8307, null); // untiered (dev-override source)
    const { room, runId, accountIds } = buildRoom({ dim: 8306, tier: 1, humans: 1 });
    const [accA] = accountIds as [string];
    dropRow(runId, mkWeapon("cbank-tiered", 8306));
    dropRow(runId, mkWeapon("cbank-untiered", 8307));

    const { io, sends } = recordingIO();
    const errs: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a); };
    try {
      codex.codexBankingRecorder(room, io, ev(runId, "victory"));
    } finally { console.error = orig; }

    expect(db.loadCodexEntry(accA, "cbank-tiered")).not.toBeNull();
    expect(db.loadCodexEntry(accA, "cbank-untiered")).toBeNull(); // never banked
    const push = codexBankedFor(sends, room.seats[0]!.seatId)!;
    expect(push.skippedUntiered).toBe(1);
    expect(errs.length).toBe(1);
  });
});
