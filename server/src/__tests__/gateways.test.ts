import { describe, it, expect } from "bun:test";
import { hexKey } from "shared";

// db.ts opens its Database at module load from GAME_DB_PATH; set env BEFORE importing (db.test.ts
// precedent). :memory: keeps the file hermetic; the connection persists for the whole file, so tests
// use disjoint dimension-id ranges to avoid cross-contamination of the shared pool/graph.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const db = await import("../db.js");
const gateways = await import("../gateways.js");

/** Create a dimension row + (optionally) an enemy template and an item, matching READY_SQL inputs. */
function mkDim(
  id: number,
  opts: { status?: string; bg?: boolean; enemy?: boolean; item?: boolean; tier?: number | null; name?: string } = {},
): void {
  const status = opts.status ?? "approved";
  const bg = opts.bg ?? true;
  db.saveDimension(id, opts.name ?? `Dim ${id}`, [], bg ? `bg-${id}.png` : undefined, undefined, status);
  if (opts.enemy ?? true) db.db.prepare("INSERT OR REPLACE INTO enemy_templates (id, dimension_id, template_json) VALUES (?, ?, '{}')").run(`e-${id}`, id);
  if (opts.item ?? true) db.db.prepare("INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES (?, ?, '{}')").run(`i-${id}`, id);
  if (opts.tier !== undefined && opts.tier !== null) db.db.prepare("UPDATE dimensions SET tier = ? WHERE id = ?").run(opts.tier, id);
}

function chart(accountId: string, dimensionId: number): void {
  db.db.prepare("INSERT OR IGNORE INTO account_dimensions (account_id, dimension_id, first_seen_at) VALUES (?, ?, ?)")
    .run(accountId, dimensionId, new Date().toISOString());
}

describe("gateway attunement + pool selection", () => {
  it("ensureGatewayAttuned links the lowest-id ready candidate, sets tier = fromTier+1, and is idempotent per hex", () => {
    mkDim(100, { tier: 0 }); // source (tiered)
    mkDim(120); // ready pool candidate
    mkDim(121); // ready pool candidate (higher id)

    const r1 = gateways.ensureGatewayAttuned(100, 0, { q: 3, r: 0 }, "acct-1");
    expect(r1).toEqual({ attuned: true, firstAttunement: true, gateway: { toDimensionId: 120, toName: "Dim 120", toTier: 1 } });
    expect(db.getDimensionMeta(120)!.tier).toBe(1); // tier assigned at link time

    // Same hex again -> SAME destination, not a first attunement, no second row.
    const r2 = gateways.ensureGatewayAttuned(100, 0, { q: 3, r: 0 }, "acct-1");
    expect(r2).toEqual({ attuned: true, firstAttunement: false, gateway: { toDimensionId: 120, toName: "Dim 120", toTier: 1 } });
    const count = (db.db.prepare("SELECT COUNT(*) AS n FROM dimension_gateways WHERE from_dimension_id = 100").get() as { n: number }).n;
    expect(count).toBe(1);

    // A different hex links the NEXT candidate.
    const r3 = gateways.ensureGatewayAttuned(100, 0, { q: 4, r: 0 }, "acct-1");
    expect(r3).toMatchObject({ attuned: true, gateway: { toDimensionId: 121, toTier: 1 } });
  });

  it("excludes non-ready dimensions from the pool (no bg / no enemy / no item / in_review / already tiered / already a destination)", () => {
    mkDim(200, { tier: 0 }); // source
    mkDim(210, { bg: false }); // no background -> not ready
    mkDim(211, { enemy: false }); // no enemy -> not ready
    mkDim(212, { item: false }); // no item -> not ready
    mkDim(213, { status: "in_review" }); // not approved -> not ready
    mkDim(214, { tier: 5 }); // already placed -> not a candidate
    mkDim(215); // the ONLY genuine candidate

    const r = gateways.ensureGatewayAttuned(200, 0, { q: 3, r: 0 }, null);
    expect(r).toMatchObject({ attuned: true, gateway: { toDimensionId: 215 } });

    // Pool now exhausted for this source's next hex -> loud pool-empty, no row written.
    const r2 = gateways.ensureGatewayAttuned(200, 0, { q: 4, r: 0 }, null);
    expect(r2).toEqual({ attuned: false, reason: "pool-empty" });
    expect((db.db.prepare("SELECT COUNT(*) AS n FROM dimension_gateways WHERE from_dimension_id = 200 AND q = 4").get() as { n: number }).n).toBe(0);
  });

  it("refuses attunement from an untiered (dev-override) source, loudly, with no row", () => {
    mkDim(300, { tier: null }); // untiered source
    mkDim(320); // a candidate exists — irrelevant, the source is untiered
    const r = gateways.ensureGatewayAttuned(300, null, { q: 3, r: 0 }, null);
    expect(r).toEqual({ attuned: false, reason: "untiered-source" });
    expect((db.db.prepare("SELECT COUNT(*) AS n FROM dimension_gateways WHERE from_dimension_id = 300").get() as { n: number }).n).toBe(0);
    // The candidate was NOT consumed/tiered.
    expect(db.getDimensionMeta(320)!.tier).toBeNull();
  });

  it("UNIQUE(to_dimension_id) keeps the multiverse a tree: a second gateway to the same destination throws", () => {
    mkDim(400, { tier: 0 });
    mkDim(420);
    const r = gateways.ensureGatewayAttuned(400, 0, { q: 3, r: 0 }, null);
    expect(r.attuned).toBe(true);
    // The shared pool means the exact destination id is order-dependent; assert against whatever linked.
    const dest = r.attuned ? r.gateway.toDimensionId : -1;
    expect(() =>
      db.db.prepare("INSERT INTO dimension_gateways (from_dimension_id, q, r, to_dimension_id, attuned_at) VALUES (?, ?, ?, ?, ?)")
        .run(400, 9, 9, dest, Date.now()),
    ).toThrow();
  });

  it("loadGatewaysForDimension returns a hexKey map with the joined destination name + tier", () => {
    mkDim(500, { tier: 1 });
    mkDim(520);
    const r = gateways.ensureGatewayAttuned(500, 1, { q: 5, r: -2 }, null);
    expect(r.attuned).toBe(true);
    const linked = r.attuned ? r.gateway : undefined;
    const map = gateways.loadGatewaysForDimension(500);
    // The map entry mirrors the linked gateway (destination id/name/joined tier), whatever the pool gave.
    expect(map[hexKey({ q: 5, r: -2 })]).toEqual(linked);
    expect(linked!.toTier).toBe(2); // fromTier(1) + 1
  });
});

describe("startableDimensions / isStartableDimension (flag #5)", () => {
  it("always offers tier-0 ready dims; offers a deep dim only to an account that charted it; unions accounts; sorts by (tier, id)", () => {
    mkDim(600, { tier: 0, name: "Surface A" });
    mkDim(601, { tier: 0, name: "Surface B" });
    mkDim(610, { tier: 1, name: "Deep One" });
    mkDim(611, { tier: 2, name: "Deep Two" });
    mkDim(612, { tier: 1, bg: false }); // tiered but unready -> never offered
    mkDim(613, { tier: null }); // untiered ready -> never a start option (it's a pool candidate)

    const acctA = "start-A";
    const acctB = "start-B";
    chart(acctA, 610); // A charted the tier-1 deep dim
    chart(acctB, 611); // B charted the tier-2 deep dim

    const forA = gateways.startableDimensions([acctA]).filter((d) => d.id >= 600 && d.id < 700);
    expect(forA.map((d) => d.id)).toEqual([600, 601, 610]); // tier-0 pair + A's charted deep
    expect(forA.map((d) => d.tier)).toEqual([0, 0, 1]); // sorted by (tier, id)

    const union = gateways.startableDimensions([acctA, acctB]).filter((d) => d.id >= 600 && d.id < 700);
    expect(union.map((d) => d.id)).toEqual([600, 601, 610, 611]); // both accounts' charts unioned

    const none = gateways.startableDimensions([]).filter((d) => d.id >= 600 && d.id < 700);
    expect(none.map((d) => d.id)).toEqual([600, 601]); // no accounts -> only the tier-0 surface

    expect(gateways.isStartableDimension(600, [])).toBe(true); // tier-0 always
    expect(gateways.isStartableDimension(610, [])).toBe(false); // uncharted deep
    expect(gateways.isStartableDimension(610, [acctA])).toBe(true); // charted by A
    expect(gateways.isStartableDimension(612, [acctA])).toBe(false); // unready deep, never
    expect(gateways.isStartableDimension(613, [acctA])).toBe(false); // untiered, never
  });
});

describe("commitTravel + per-dimension cleared state (flag #8/#9)", () => {
  it("commitTravel re-points the run, resets pos, seeds destination discovery + origin, and leaves start_dimension_id", () => {
    const runId = db.startNewRun(700, "traveler", 2);
    db.markRunCleared(runId, 700, { q: 0, r: 0 });
    db.updateRunPartyPos(runId, { q: 4, r: -1 });

    db.commitTravel(runId, 701, 2);

    const run = db.loadRun(runId)!;
    expect(run.dimension_id).toBe(701); // current dimension swapped
    expect(run.start_dimension_id).toBe(700); // start UNCHANGED (flag #6)
    expect([run.party_q, run.party_r]).toEqual([0, 0]); // party reset to origin
    expect([...db.loadRunCleared(runId, 701)]).toEqual(["0,0"]); // destination origin cleared for this run
    expect(db.loadDiscoveredHexes(701)["0,0"]).toBe("explored"); // discovery disc seeded
    expect(db.loadDiscoveredHexIcons(701)["0,0"]).toBe("town");
    // The source dimension's cleared set is untouched (per-dimension keying).
    expect([...db.loadRunCleared(runId, 700)]).toEqual(["0,0"]);
  });

  it("commitTravel is a no-op on a finalized run (AND active = 1)", () => {
    const runId = db.startNewRun(710, "done", 2);
    db.finalizeRun(runId, "defeat");
    db.commitTravel(runId, 711, 1);
    expect(db.loadRun(runId)!.dimension_id).toBe(710); // never re-pointed
  });

  it("countRunCombatCleared excludes every dimension's (0,0) origin across a traveled run", () => {
    const runId = db.startNewRun(720, "counter", 2);
    db.markRunCleared(runId, 720, { q: 0, r: 0 }); // origin (auto)
    db.markRunCleared(runId, 720, { q: 1, r: 0 }); // combat win in dim A
    db.markRunCleared(runId, 720, { q: 2, r: 0 }); // combat win in dim A
    db.commitTravel(runId, 721, 1); // seeds dim B origin (0,0)
    db.markRunCleared(runId, 721, { q: 1, r: 0 }); // combat win in dim B
    expect(db.countRunCombatCleared(runId)).toBe(3); // both origins excluded, wins summed across dims
  });

  it("saveDimension re-save preserves tier (generator regeneration must not knock a placed dim out of the graph)", () => {
    mkDim(820, { tier: 3, name: "Placed" });
    db.saveDimension(820, "Regenerated", [], "new-bg.png", undefined, "in_review");
    const meta = db.getDimensionMeta(820)!;
    expect(meta.tier).toBe(3); // multiverse placement survives the wholesale row rewrite
    expect(meta.name).toBe("Regenerated"); // every generator-owned column still updates
  });

  it("getItemById resolves globally; loadSeatInventory rehydrates a bag item from any dimension (flag #9)", () => {
    // An item that lives in a dimension well outside the old 0-3 merge window.
    db.saveItems(730, { "d730-relic": { id: "d730-relic", name: "Relic", sprite: "relic", dimensionId: 730 } as never });
    expect(db.getItemById("d730-relic")!.name).toBe("Relic");
    expect(db.getItemById("nope")).toBeNull();

    const runId = db.startNewRun(0, "bagger", 2); // run in dim 0, carrying a dim-730 item
    db.saveSeatInventory(runId, 0, {
      bag: [db.getItemById("d730-relic")!, ...new Array(15).fill(null)],
      equipped: [],
      attachments: {},
    });
    const inv = db.loadSeatInventory(runId, 0);
    expect(inv.bag[0]?.id).toBe("d730-relic"); // rehydrated despite being a non-current-dimension item
  });
});
