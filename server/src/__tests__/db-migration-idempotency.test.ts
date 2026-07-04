import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const DB_TS = resolve(import.meta.dir, "../db.ts");

/**
 * The migration blocks must be re-runnable against a populated DB. Module cache makes an
 * in-process re-import meaningless, so run db.ts in TWO subprocesses against the same
 * file-backed DB: the first migrates a fresh DB v3->v10, the second must no-op cleanly at
 * user_version 10.
 */
describe("db migration idempotency (v10)", () => {
  it("importing db.ts twice against the same DB exits 0 both times and lands on user_version 10", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coop-migration-"));
    const dbPath = join(dir, "migrate.sqlite");
    try {
      for (let round = 0; round < 2; round++) {
        const proc = Bun.spawn({
          cmd: ["bun", "-e", `await import(${JSON.stringify(DB_TS)})`],
          cwd: resolve(import.meta.dir, "../.."),
          env: { ...process.env, GAME_DB_PATH: dbPath, GAME_SKIP_SEED: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          console.error(`[migration round ${round}] stderr:`, await new Response(proc.stderr).text());
        }
        expect(exitCode).toBe(0);
      }

      const check = new Database(dbPath);
      const { user_version } = check.query("PRAGMA user_version").get() as { user_version: number };
      expect(user_version).toBe(10);
      // Spot-check the v6 surface actually exists.
      const tables = (
        check.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => t.name);
      for (const required of ["accounts", "account_sessions", "profiles", "friends", "titles", "account_titles", "account_stats", "account_dimensions"]) {
        expect(tables).toContain(required);
      }
      const seatCols = (check.query("PRAGMA table_info(run_seats)").all() as { name: string }[]).map((c) => c.name);
      expect(seatCols).toContain("account_id");
      // Spot-check the v7 surface (docs/meta-loop/02-contracts.md §1.2).
      expect(tables).toContain("run_pending_xp");
      const runCols = (check.query("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
      expect(runCols).toContain("contract_json");
      // Spot-check the v8 surface (docs/meta-loop/04-portals.md §1.2).
      const dimCols = (check.query("PRAGMA table_info(dimensions)").all() as { name: string }[]).map((c) => c.name);
      expect(dimCols).toContain("tier");
      expect(runCols).toContain("start_dimension_id");
      expect(tables).toContain("dimension_gateways");
      const clearedCols = (check.query("PRAGMA table_info(run_cleared_hexes)").all() as { name: string }[]).map((c) => c.name);
      expect(clearedCols).toContain("dimension_id");
      // UNIQUE(to_dimension_id) is the tree invariant — assert the index the constraint created.
      const gatewayIndexes = check
        .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'dimension_gateways'")
        .all() as { name: string }[];
      expect(gatewayIndexes.length).toBeGreaterThan(0);
      // Spot-check the v9 surface (docs/meta-loop/03-loot-codex.md §1.2).
      for (const required of ["run_loot", "codex_entries", "codex_firsts"]) {
        expect(tables).toContain(required);
      }
      const lootCols = (check.query("PRAGMA table_info(run_loot)").all() as { name: string }[]).map((c) => c.name);
      for (const col of ["item_json", "assigned_seat_index", "assigned_account_id", "source_icon", "origin"]) {
        expect(lootCols).toContain(col);
      }
      const codexCols = (check.query("PRAGMA table_info(codex_entries)").all() as { name: string }[]).map((c) => c.name);
      for (const col of ["account_id", "item_id", "tier", "item_json", "acquired_at"]) {
        expect(codexCols).toContain(col);
      }
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it("v8 backfill: a v7-shaped run at dimension 2 gets start_dimension_id=2 and cleared rows re-keyed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coop-migration-backfill-"));
    const dbPath = join(dir, "backfill.sqlite");
    try {
      // Hand-build a v7-shaped DB (user_version 7) with every table db.ts prepares statements against
      // at module load — the v3-v7 migration blocks are skipped at this version, so they must exist.
      const seed = new Database(dbPath);
      seed.exec("CREATE TABLE dimensions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, structures_json TEXT NOT NULL DEFAULT '[]', background_path TEXT, hex_decorations_path TEXT, status TEXT NOT NULL DEFAULT 'approved')");
      seed.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, dimension_id INTEGER NOT NULL DEFAULT 1, capacity INTEGER NOT NULL DEFAULT 2, host_client_id TEXT, active INTEGER NOT NULL DEFAULT 1, party_q INTEGER NOT NULL DEFAULT 0, party_r INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, completed_at INTEGER, outcome TEXT, started_at INTEGER, phase TEXT NOT NULL DEFAULT 'lobby', contract_json TEXT)");
      seed.exec("CREATE TABLE run_cleared_hexes (run_id INTEGER NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, PRIMARY KEY (run_id, q, r))");
      seed.exec("CREATE TABLE discovered_hexes (dimension_id INTEGER NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, PRIMARY KEY (dimension_id, q, r))");
      seed.exec("CREATE TABLE discovered_hex_icons (dimension_id INTEGER NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, icon TEXT NOT NULL, PRIMARY KEY (dimension_id, q, r))");
      seed.exec("CREATE TABLE run_seats (run_id INTEGER NOT NULL, seat_index INTEGER NOT NULL, client_id TEXT, display_name TEXT NOT NULL DEFAULT '', controller_kind TEXT NOT NULL DEFAULT 'human', token_salt TEXT, account_id TEXT, joined_at INTEGER NOT NULL DEFAULT 0, left_at INTEGER, PRIMARY KEY (run_id, seat_index))");
      seed.exec("CREATE TABLE run_seat_items (run_id INTEGER NOT NULL, seat_index INTEGER NOT NULL, location TEXT NOT NULL, slot_order INTEGER NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (run_id, seat_index, location, slot_order))");
      seed.exec("CREATE TABLE run_seat_attachments (run_id INTEGER NOT NULL, seat_index INTEGER NOT NULL, item_id TEXT NOT NULL, attachment_json TEXT NOT NULL, PRIMARY KEY (run_id, seat_index, item_id))");
      seed.exec("CREATE TABLE profiles (account_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, equipped_title_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      seed.exec("CREATE TABLE run_pending_xp (run_id INTEGER NOT NULL, account_id TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (run_id, account_id))");
      seed.exec("INSERT INTO dimensions (id, name) VALUES (2, 'The Gloom Hollows')");
      seed.exec("INSERT INTO runs (id, dimension_id) VALUES (42, 2)");
      seed.exec("INSERT INTO run_cleared_hexes (run_id, q, r) VALUES (42, 0, 0), (42, 1, 0)");
      seed.exec("PRAGMA user_version = 7");
      seed.close();

      const proc = Bun.spawn({
        cmd: ["bun", "-e", `await import(${JSON.stringify(DB_TS)})`],
        cwd: resolve(import.meta.dir, "../.."),
        env: { ...process.env, GAME_DB_PATH: dbPath, GAME_SKIP_SEED: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) console.error("[backfill] stderr:", await new Response(proc.stderr).text());
      expect(exitCode).toBe(0);

      const check = new Database(dbPath);
      expect((check.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(10);
      const run = check.query("SELECT dimension_id, start_dimension_id FROM runs WHERE id = 42").get() as {
        dimension_id: number;
        start_dimension_id: number;
      };
      expect(run.start_dimension_id).toBe(2); // backfilled from dimension_id
      const cleared = check.query("SELECT dimension_id, q, r FROM run_cleared_hexes WHERE run_id = 42 ORDER BY q").all() as {
        dimension_id: number;
        q: number;
        r: number;
      }[];
      expect(cleared.map((c) => c.dimension_id)).toEqual([2, 2]); // re-keyed via the runs JOIN
      expect((check.query("SELECT tier FROM dimensions WHERE id = 2").get() as { tier: number }).tier).toBe(1);
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it("v8 item dedup folds a legacy duplicate into an already-existing d<dim>- successor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coop-migration-dedup-"));
    const dbPath = join(dir, "dedup.sqlite");
    try {
      // The real pre-v8 failure shape: 'short-sword' duplicated across dims 0 and 501, while the
      // collision-aware pipeline already saved 'd501-short-sword' in dim 501 — the rename target
      // exists, so the migration must fold, not collide (UNIQUE items.id, items.dimension_id).
      const seed = new Database(dbPath);
      seed.exec("CREATE TABLE dimensions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, structures_json TEXT NOT NULL DEFAULT '[]', background_path TEXT, hex_decorations_path TEXT, status TEXT NOT NULL DEFAULT 'approved')");
      seed.exec("CREATE TABLE items (id TEXT NOT NULL, dimension_id INTEGER NOT NULL, item_json TEXT NOT NULL, PRIMARY KEY (id, dimension_id))");
      seed.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, dimension_id INTEGER NOT NULL DEFAULT 1, capacity INTEGER NOT NULL DEFAULT 2, host_client_id TEXT, active INTEGER NOT NULL DEFAULT 1, party_q INTEGER NOT NULL DEFAULT 0, party_r INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, completed_at INTEGER, outcome TEXT, started_at INTEGER, phase TEXT NOT NULL DEFAULT 'lobby', contract_json TEXT)");
      seed.exec("CREATE TABLE run_cleared_hexes (run_id INTEGER NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, PRIMARY KEY (run_id, q, r))");
      seed.exec("CREATE TABLE discovered_hexes (dimension_id INTEGER NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, PRIMARY KEY (dimension_id, q, r))");
      seed.exec("CREATE TABLE discovered_hex_icons (dimension_id INTEGER NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, icon TEXT NOT NULL, PRIMARY KEY (dimension_id, q, r))");
      seed.exec("CREATE TABLE run_seats (run_id INTEGER NOT NULL, seat_index INTEGER NOT NULL, client_id TEXT, display_name TEXT NOT NULL DEFAULT '', controller_kind TEXT NOT NULL DEFAULT 'human', token_salt TEXT, account_id TEXT, joined_at INTEGER NOT NULL DEFAULT 0, left_at INTEGER, PRIMARY KEY (run_id, seat_index))");
      seed.exec("CREATE TABLE run_seat_items (run_id INTEGER NOT NULL, seat_index INTEGER NOT NULL, location TEXT NOT NULL, slot_order INTEGER NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (run_id, seat_index, location, slot_order))");
      seed.exec("CREATE TABLE run_seat_attachments (run_id INTEGER NOT NULL, seat_index INTEGER NOT NULL, item_id TEXT NOT NULL, attachment_json TEXT NOT NULL, PRIMARY KEY (run_id, seat_index, item_id))");
      seed.exec("CREATE TABLE profiles (account_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, equipped_title_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      seed.exec("CREATE TABLE run_pending_xp (run_id INTEGER NOT NULL, account_id TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (run_id, account_id))");
      seed.exec("INSERT INTO dimensions (id, name) VALUES (0, 'Origin'), (501, 'The Mire')");
      seed.exec(`INSERT INTO items (id, dimension_id, item_json) VALUES
        ('short-sword', 0, '{"id":"short-sword","name":"Short Sword"}'),
        ('short-sword', 501, '{"id":"short-sword","name":"Short Sword"}'),
        ('d501-short-sword', 501, '{"id":"d501-short-sword","name":"Short Sword"}'),
        ('sling', 501, '{"id":"sling","name":"Sling"}'),
        ('sling', 600, '{"id":"sling","name":"Sling"}')`);
      seed.exec("INSERT INTO runs (id, dimension_id) VALUES (7, 501)");
      seed.exec("INSERT INTO run_seat_items (run_id, seat_index, location, slot_order, item_id) VALUES (7, 0, 'equipped', 0, 'short-sword')");
      seed.exec("PRAGMA user_version = 7");
      seed.close();

      const proc = Bun.spawn({
        cmd: ["bun", "-e", `await import(${JSON.stringify(DB_TS)})`],
        cwd: resolve(import.meta.dir, "../.."),
        env: { ...process.env, GAME_DB_PATH: dbPath, GAME_SKIP_SEED: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) console.error("[dedup] stderr:", await new Response(proc.stderr).text());
      expect(exitCode).toBe(0);

      const check = new Database(dbPath);
      // Legacy 501 row folded into the existing successor; dim-0 owner untouched.
      const swords = check.query("SELECT id, dimension_id FROM items WHERE id LIKE '%short-sword%' ORDER BY dimension_id").all() as { id: string; dimension_id: number }[];
      expect(swords).toEqual([
        { id: "short-sword", dimension_id: 0 },
        { id: "d501-short-sword", dimension_id: 501 },
      ]);
      // Seat reference in the dim-501 run re-pointed to the successor.
      const ref = check.query("SELECT item_id FROM run_seat_items WHERE run_id = 7").get() as { item_id: string };
      expect(ref.item_id).toBe("d501-short-sword");
      // No-successor case still renames: sling in dim 600 becomes d600-sling with item_json.id rewritten.
      const slings = check.query("SELECT id, dimension_id, json_extract(item_json, '$.id') AS jid FROM items WHERE id LIKE '%sling%' ORDER BY dimension_id").all() as { id: string; dimension_id: number; jid: string }[];
      expect(slings).toEqual([
        { id: "sling", dimension_id: 501, jid: "sling" },
        { id: "d600-sling", dimension_id: 600, jid: "d600-sling" },
      ]);
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
