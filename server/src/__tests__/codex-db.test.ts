import { describe, it, expect } from "bun:test";
import type { ItemDefinition, ItemRarity } from "shared";

// db.ts opens its Database at module load from GAME_DB_PATH; set env BEFORE importing (db.test.ts
// precedent). The :memory: connection is shared across test files, so this file uses disjoint
// dimension ids (8100+), globally-unique item ids ("cdxdb-*"), and unique client ids.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const accounts = await import("../accounts.js");

function mkWeapon(id: string, dimensionId: number, rarity: ItemRarity = "common"): ItemDefinition {
  return {
    type: "weapon", id, name: id, description: "", rarity, sprite: `${id}.webp`,
    dimensionId, slotCost: { hand: 1 }, animSet: "sword", abilities: [],
  };
}

function emptyInv(): { bag: (ItemDefinition | null)[]; equipped: ItemDefinition[]; attachments: Record<string, never> } {
  return { bag: new Array(16).fill(null), equipped: [], attachments: {} };
}

const ORIGIN = { q: 0, r: 0 };

describe("run_loot ledger (v9)", () => {
  it("insertRunLoot / loadUnassignedLoot / loadRunLoot roundtrip incl. snapshot JSON", () => {
    const runId = db.startNewRun(8100, "cdxdb-c1", 2);
    const sword = mkWeapon("cdxdb-sword", 8100, "uncommon");
    const lootId = db.insertRunLoot(runId, sword, { q: 2, r: -1 }, "treasure", "drop");
    expect(lootId).toBeGreaterThan(0);

    const unassigned = db.loadUnassignedLoot(runId);
    expect(unassigned.length).toBe(1);
    const row = unassigned[0]!;
    expect(row.item_id).toBe("cdxdb-sword");
    expect(row.dimension_id).toBe(8100);
    expect(row.source_q).toBe(2);
    expect(row.source_r).toBe(-1);
    expect(row.source_icon).toBe("treasure");
    expect(row.assigned_seat_index).toBeNull();
    const snap = JSON.parse(row.item_json) as ItemDefinition;
    expect(snap.rarity).toBe("uncommon");
    expect(snap.dimensionId).toBe(8100);

    expect(db.loadRunLoot(runId).length).toBe(1);
  });

  it("commitLootAssignment assigns + persists the bag atomically; second call is first-writer-wins", () => {
    const runId = db.startNewRun(8101, "cdxdb-c2", 2);
    const item = mkWeapon("cdxdb-axe", 8101);
    const lootId = db.insertRunLoot(runId, item, ORIGIN, "boss", "drop");

    const inv = emptyInv();
    inv.bag[0] = item;
    expect(db.commitLootAssignment(runId, lootId, 1, "acct-A", inv)).toBe(true);

    // Assigned: no longer in the unassigned pool; the bag row persisted.
    expect(db.loadUnassignedLoot(runId).length).toBe(0);
    const rehydrated = db.loadSeatInventory(runId, 1);
    expect(rehydrated.bag[0]?.id).toBe("cdxdb-axe");

    // A racing second claim (different seat/inv) must lose — row already assigned.
    const inv2 = emptyInv();
    inv2.bag[3] = item;
    expect(db.commitLootAssignment(runId, lootId, 0, "acct-B", inv2)).toBe(false);
    // The first claimant's rows are intact; the loser wrote nothing.
    const row = db.loadRunLoot(runId)[0]!;
    expect(row.assigned_seat_index).toBe(1);
    expect(row.assigned_account_id).toBe("acct-A");
    expect(db.loadSeatInventory(runId, 0).bag.every((b) => b === null)).toBe(true);
  });
});

describe("codex tables (v9)", () => {
  it("bankCodexEntry dedups per (account,item); distinct accounts both insert", () => {
    const a = accounts.resolveGuestAccount("cdxdb-bank-a").id;
    const b = accounts.resolveGuestAccount("cdxdb-bank-b").id;
    const item = mkWeapon("cdxdb-relic", 8102, "rare");

    expect(db.bankCodexEntry(a, item, 2)).toBe(true);
    expect(db.bankCodexEntry(a, item, 2)).toBe(false); // dedup
    expect(db.bankCodexEntry(b, item, 2)).toBe(true); // distinct account

    const entryA = db.loadCodexEntry(a, "cdxdb-relic")!;
    expect(entryA.tier).toBe(2);
    expect(JSON.parse(entryA.item_json).rarity).toBe("rare");
    expect(db.loadCodex(a).length).toBeGreaterThanOrEqual(1);
  });

  it("recordCodexFirst is first-writer-wins; the discoverer never changes", () => {
    const a = accounts.resolveGuestAccount("cdxdb-first-a").id;
    const b = accounts.resolveGuestAccount("cdxdb-first-b").id;
    const item = mkWeapon("cdxdb-crown", 8103);

    expect(db.recordCodexFirst(item, a)).toBe(true);
    expect(db.recordCodexFirst(item, b)).toBe(false); // already recorded
    expect(db.loadCodexFirst("cdxdb-crown")!.account_id).toBe(a);
  });
});

describe("resolveItemForRun (flag #8 fixed-order resolution)", () => {
  it("live pool -> run_loot snapshot -> codex snapshot -> null", () => {
    // Live: items table hit wins.
    db.saveItems(8104, { "cdxdb-live": mkWeapon("cdxdb-live", 8104) });
    const runId = db.startNewRun(8104, "cdxdb-resolve", 2);
    expect(db.resolveItemForRun(runId, "cdxdb-live")?.id).toBe("cdxdb-live");

    // Dropped-then-deleted from the pool: resolves via the run_loot snapshot.
    const dropped = mkWeapon("cdxdb-dropped", 8104, "uncommon");
    db.insertRunLoot(runId, dropped, ORIGIN, "ruins", "drop");
    expect(db.getItemById("cdxdb-dropped")).toBeNull(); // never in the items table
    expect(db.resolveItemForRun(runId, "cdxdb-dropped")?.rarity).toBe("uncommon");

    // Manifested design from a foreign run: resolves via codex snapshot only.
    const acct = accounts.resolveGuestAccount("cdxdb-resolve-acct").id;
    db.bankCodexEntry(acct, mkWeapon("cdxdb-manifested", 8105, "rare"), 1);
    expect(db.resolveItemForRun(runId, "cdxdb-manifested")?.rarity).toBe("rare");

    // Genuinely unknown id.
    expect(db.resolveItemForRun(runId, "cdxdb-nope")).toBeNull();
  });

  it("loadSeatInventory rehydrates a bag holding a pool-deleted dropped item", () => {
    const runId = db.startNewRun(8106, "cdxdb-rehydrate", 2);
    const dropped = mkWeapon("cdxdb-bagitem", 8106);
    db.insertRunLoot(runId, dropped, ORIGIN, "treasure", "drop");
    const inv = emptyInv();
    inv.bag[2] = dropped;
    db.saveSeatInventory(runId, 0, inv);
    // getItemById would find nothing (never saved to items), but the run_loot snapshot resolves it.
    const rehydrated = db.loadSeatInventory(runId, 0);
    expect(rehydrated.bag[2]?.id).toBe("cdxdb-bagitem");
  });
});

describe("eraseClient scope (loot deleted, codex permanent)", () => {
  it("removes run_loot rows for the client's runs but never touches codex tables", () => {
    const clientId = "cdxdb-erase";
    const acct = accounts.resolveGuestAccount(clientId).id;
    const runId = db.startNewRun(8107, clientId, 2);
    db.upsertRunSeat(runId, 0, { clientId, displayName: "E", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: acct });
    const item = mkWeapon("cdxdb-erasable", 8107);
    db.insertRunLoot(runId, item, ORIGIN, "boss", "drop");
    db.bankCodexEntry(acct, item, 0);
    db.recordCodexFirst(item, acct);

    expect(db.loadRunLoot(runId).length).toBe(1);
    db.eraseClient(clientId);
    expect(db.loadRunLoot(runId).length).toBe(0); // run_loot gone with the run
    // Codex survives erasure (permanent design provenance, §1.1).
    expect(db.loadCodexEntry(acct, "cdxdb-erasable")).not.toBeNull();
    expect(db.loadCodexFirst("cdxdb-erasable")).not.toBeNull();
  });
});
