import { describe, it, expect } from "bun:test";
import type { ServerMessage } from "shared";

process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const machine = await import("../room-machine.js");
const loot = await import("../loot.js");
const fx = await import("./machine-fixtures.js");
const { mkWeapon, recordingIO, buildTestRoom, ORIGIN } = fx;

describe("lootDropRecorder (§4.2)", () => {
  it("rolls the pool, writes ledger + bag rows, grows room.partyBag, and broadcasts lootFound", () => {
    // "ruins" -> elite profile (dropChance 1.0, count 1); a one-item pool drops that item deterministically.
    db.saveItems(8200, { "loot-drop": mkWeapon("loot-drop", 8200) });
    const { room, runId } = buildTestRoom({ dim: 8200, prefix: "pbag" });
    const { io, broadcasts } = recordingIO();

    loot.lootDropRecorder(room, io, { type: "encounter-won", runId, hex: ORIGIN, icon: "ruins", firstEver: true, clearedCount: 1 });

    expect(room.partyBag.length).toBe(1);
    expect(room.partyBag[0]!.item.id).toBe("loot-drop");
    expect(room.partyBag[0]!.sourceIcon).toBe("ruins");
    expect(db.loadRunLoot(runId).length).toBe(1); // codex-banking ledger row
    expect(db.loadPartyBag(runId).length).toBe(1); // durable bag row
    expect(db.loadPartyBag(runId)[0]!.id).toBe(room.partyBag[0]!.bagId);
    const found = broadcasts.filter((b) => b.type === "lootFound");
    expect(found.length).toBe(1);
    expect((found[0] as Extract<ServerMessage, { type: "lootFound" }>).drops.length).toBe(1);
  });

  it("empty pool -> console.error, no rows, no broadcast (FALLBACK flag #10)", () => {
    const { room, runId } = buildTestRoom({ dim: 8201, prefix: "pbag" }); // no items saved for 8201
    const { io, broadcasts } = recordingIO();
    const errs: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a); };
    try {
      loot.lootDropRecorder(room, io, { type: "encounter-won", runId, hex: ORIGIN, icon: "boss", firstEver: false, clearedCount: 1 });
    } finally { console.error = orig; }

    expect(room.partyBag.length).toBe(0);
    expect(db.loadPartyBag(runId).length).toBe(0);
    expect(broadcasts.some((b) => b.type === "lootFound")).toBe(false);
    expect(errs.length).toBe(1);
  });

  it("excluded ids never drop (abilitytest)", () => {
    // Raw insert (bypass saveItems' global-uniqueness check): "abilitytest" is owned by seeded dim 0
    // in the shared DB, but the (id, dimension_id) PK lets dim 8202 hold its own excluded row.
    db.db.prepare("INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES (?, ?, ?)")
      .run("abilitytest", 8202, JSON.stringify(mkWeapon("abilitytest", 8202)));
    const { room, runId } = buildTestRoom({ dim: 8202, prefix: "pbag" });
    const { io, broadcasts } = recordingIO();
    // apex (dropChance 1.0, count 2) would drop twice, but the only pool item is excluded -> [].
    loot.lootDropRecorder(room, io, { type: "encounter-won", runId, hex: ORIGIN, icon: "boss", firstEver: false, clearedCount: 1 });
    expect(room.partyBag.length).toBe(0);
    expect(db.loadPartyBag(runId).length).toBe(0);
    expect(broadcasts.some((b) => b.type === "lootFound")).toBe(false);
  });
});

describe("bag rehydration (crash recovery, flag #8/#13)", () => {
  it("reconstructRoomForRun rebuilds room.partyBag from run_party_bag snapshots", () => {
    db.saveItems(8209, { "survivor-a": mkWeapon("survivor-a", 8209) });
    const { room, runId } = buildTestRoom({ dim: 8209, prefix: "pbag" });
    const { io } = recordingIO();
    loot.lootDropRecorder(room, io, { type: "encounter-won", runId, hex: ORIGIN, icon: "ruins", firstEver: false, clearedCount: 1 });
    // A player deposit (unequip) sits next to the drop, with no drop provenance.
    db.commitBagDeposit(runId, mkWeapon("deposited", 8209), 0, { equipped: [], attachments: {} });
    // One drop leaves the bag again (equipped by seat 0).
    const equippedAway = room.partyBag[0]!;
    db.commitBagEquip(runId, equippedAway.bagId, 0, { equipped: [equippedAway.item], attachments: {} });

    const rebuilt = machine.reconstructRoomForRun(runId, () => {})!;
    expect(rebuilt.partyBag.map((e) => e.item.id)).toEqual(["deposited"]);
    expect(rebuilt.partyBag[0]!.sourceIcon).toBeNull(); // deposit provenance preserved
    expect(rebuilt.seats[0]!.inventory.equipped.some((i) => i.id === "survivor-a")).toBe(true);
  });
});
