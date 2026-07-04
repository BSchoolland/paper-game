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

function emptyInv(): { equipped: ItemDefinition[]; attachments: Record<string, never> } {
  return { equipped: [], attachments: {} };
}

const ORIGIN = { q: 0, r: 0 };

describe("run_loot ledger + party bag (v11)", () => {
  it("commitLootDrops writes the ledger row AND the bag row incl. snapshot JSON", () => {
    const runId = db.startNewRun(8100, "cdxdb-c1", 2);
    const sword = mkWeapon("cdxdb-sword", 8100, "uncommon");
    const [bagId] = db.commitLootDrops(runId, [sword], { q: 2, r: -1 }, "treasure");
    expect(bagId).toBeGreaterThan(0);

    const ledger = db.loadRunLoot(runId);
    expect(ledger.length).toBe(1);
    expect(ledger[0]!.item_id).toBe("cdxdb-sword");
    expect(ledger[0]!.dimension_id).toBe(8100);
    expect(ledger[0]!.source_q).toBe(2);
    expect(ledger[0]!.source_r).toBe(-1);
    expect(ledger[0]!.source_icon).toBe("treasure");

    const bag = db.loadPartyBag(runId);
    expect(bag.length).toBe(1);
    expect(bag[0]!.id).toBe(bagId!);
    expect(bag[0]!.source_icon).toBe("treasure");
    const snap = JSON.parse(bag[0]!.item_json) as ItemDefinition;
    expect(snap.rarity).toBe("uncommon");
    expect(snap.dimensionId).toBe(8100);
  });

  it("commitBagEquip drains the row + persists the loadout atomically; second call is first-writer-wins", () => {
    const runId = db.startNewRun(8101, "cdxdb-c2", 2);
    const item = mkWeapon("cdxdb-axe", 8101);
    const [bagId] = db.commitLootDrops(runId, [item], ORIGIN, "boss");

    const inv = emptyInv();
    inv.equipped.push(item);
    expect(db.commitBagEquip(runId, bagId!, 1, inv)).toBe(true);

    // Equipped: the bag row is gone; the loadout persisted.
    expect(db.loadPartyBag(runId).length).toBe(0);
    expect(db.loadSeatInventory(runId, 1).equipped[0]?.id).toBe("cdxdb-axe");

    // A racing second equip (different seat/inv) must lose — the row is already gone.
    const inv2 = emptyInv();
    inv2.equipped.push(item);
    expect(db.commitBagEquip(runId, bagId!, 0, inv2)).toBe(false);
    // The winner's rows are intact; the loser wrote nothing.
    expect(db.loadSeatInventory(runId, 0).equipped.length).toBe(0);
  });

  it("commitBagDeposit inserts the bag row + persists the shrunken loadout; ledger untouched", () => {
    const runId = db.startNewRun(8108, "cdxdb-c3", 2);
    const item = mkWeapon("cdxdb-mace", 8108);
    const bagId = db.commitBagDeposit(runId, item, 0, emptyInv());
    expect(bagId).toBeGreaterThan(0);

    const bag = db.loadPartyBag(runId);
    expect(bag.length).toBe(1);
    expect(bag[0]!.source_icon).toBeNull(); // deposits carry no drop provenance
    expect(db.loadRunLoot(runId).length).toBe(0); // storage only — never a ledger row
    expect(db.loadSeatInventory(runId, 0).equipped.length).toBe(0);
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
    db.commitLootDrops(runId, [dropped], ORIGIN, "ruins");
    expect(db.getItemById("cdxdb-dropped")).toBeNull(); // never in the items table
    expect(db.resolveItemForRun(runId, "cdxdb-dropped")?.rarity).toBe("uncommon");

    // Manifested design from a foreign run: resolves via codex snapshot only.
    const acct = accounts.resolveGuestAccount("cdxdb-resolve-acct").id;
    db.bankCodexEntry(acct, mkWeapon("cdxdb-manifested", 8105, "rare"), 1);
    expect(db.resolveItemForRun(runId, "cdxdb-manifested")?.rarity).toBe("rare");

    // Genuinely unknown id.
    expect(db.resolveItemForRun(runId, "cdxdb-nope")).toBeNull();
  });

  it("loadSeatInventory rehydrates an equipped pool-deleted dropped item", () => {
    const runId = db.startNewRun(8106, "cdxdb-rehydrate", 2);
    const dropped = mkWeapon("cdxdb-bagitem", 8106);
    db.commitLootDrops(runId, [dropped], ORIGIN, "treasure");
    const inv = emptyInv();
    inv.equipped.push(dropped);
    db.saveSeatInventory(runId, 0, inv);
    // getItemById would find nothing (never saved to items), but the run_loot snapshot resolves it.
    const rehydrated = db.loadSeatInventory(runId, 0);
    expect(rehydrated.equipped[0]?.id).toBe("cdxdb-bagitem");
  });
});

describe("eraseClient scope (loot + bag deleted, codex permanent)", () => {
  it("removes run_loot + run_party_bag rows for the client's runs but never touches codex tables", () => {
    const clientId = "cdxdb-erase";
    const acct = accounts.resolveGuestAccount(clientId).id;
    const runId = db.startNewRun(8107, clientId, 2);
    db.upsertRunSeat(runId, 0, { clientId, displayName: "E", controllerKind: "human", tokenSalt: db.newTokenSalt(), accountId: acct });
    const item = mkWeapon("cdxdb-erasable", 8107);
    db.commitLootDrops(runId, [item], ORIGIN, "boss");
    db.bankCodexEntry(acct, item, 0);
    db.recordCodexFirst(item, acct);

    expect(db.loadRunLoot(runId).length).toBe(1);
    expect(db.loadPartyBag(runId).length).toBe(1);
    db.eraseClient(clientId);
    expect(db.loadRunLoot(runId).length).toBe(0); // run_loot gone with the run
    expect(db.loadPartyBag(runId).length).toBe(0); // party bag gone with the run
    // Codex survives erasure (permanent design provenance, §1.1).
    expect(db.loadCodexEntry(acct, "cdxdb-erasable")).not.toBeNull();
    expect(db.loadCodexFirst("cdxdb-erasable")).not.toBeNull();
  });
});
