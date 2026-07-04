import { Database } from "bun:sqlite";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HexCoord, HexStatus, HexIconType, UnitTemplate, ItemDefinition, InventoryState, AttachmentData } from "shared";
import type { StructureEntry, Dimension, MapManifest, RoomCode, WireLogRecord, RunOutcome, ContractState } from "shared";
import { bankedXp } from "shared";
import { ASSETS_DIR } from "../../shared/src/paths.js";

function loadMapManifest(dimId: number): MapManifest | null {
  const p = resolve(ASSETS_DIR, `sprites/maps/dimension-${dimId}/manifest.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as MapManifest;
  } catch {
    return null;
  }
}

// Default to the one canonical DB next to this file (server/hex-discovery.sqlite), resolved
// absolutely so it never depends on the caller's CWD. GAME_DB_PATH overrides for tests/tools.
const DB_PATH = process.env.GAME_DB_PATH ?? resolve(import.meta.dir, "../hex-discovery.sqlite");
// Exported so accounts.ts shares this one connection — two `new Database(":memory:")` would be
// two separate databases, which breaks tests. db.ts stays the single migration owner.
export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA busy_timeout = 30000");
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS dimensions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    structures_json TEXT NOT NULL DEFAULT '[]',
    background_path TEXT,
    hex_decorations_path TEXT
  )
`);
try {
  db.exec("ALTER TABLE dimensions ADD COLUMN hex_decorations_path TEXT");
} catch {
  // column already exists
}
// migration: lifecycle status for dimensions
try {
  db.exec("ALTER TABLE dimensions ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
} catch {
  // column already exists
}
db.exec(`
  CREATE TABLE IF NOT EXISTS enemy_templates (
    id TEXT NOT NULL,
    dimension_id INTEGER NOT NULL,
    template_json TEXT NOT NULL,
    PRIMARY KEY (id, dimension_id),
    FOREIGN KEY (dimension_id) REFERENCES dimensions(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT NOT NULL,
    dimension_id INTEGER NOT NULL,
    item_json TEXT NOT NULL,
    PRIMARY KEY (id, dimension_id),
    FOREIGN KEY (dimension_id) REFERENCES dimensions(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS wire_log_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    t           INTEGER NOT NULL,
    dir         TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    room        TEXT,
    run_id      INTEGER,
    seat_id     TEXT,
    type        TEXT NOT NULL,
    action_count INTEGER,
    note        TEXT,
    record_json TEXT NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_wire_log_records_room_t ON wire_log_records(room, t)");
db.exec("CREATE INDEX IF NOT EXISTS idx_wire_log_records_t ON wire_log_records(t)");

// --- Multiplayer co-op durable schema migration (PERSISTENCE.md; supersedes R13) ---
// DISCOVERY (community fog-of-war) is GLOBAL per dimension and permanent; CLEARED-THIS-RUN
// (the party's combat progress) is PER-RUN. v2 conflated them into run-scoped explored_hexes;
// v3 splits them: discovered_hexes / discovered_hex_icons keyed by dimension_id (global), and
// run_cleared_hexes keyed by run_id (the durable visitedThisRun). FKs are declarative only
// (foreign_keys pragma is off, matching the rest of this schema).
const SCHEMA_VERSION = 3;
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < SCHEMA_VERSION) {
    const migrate = db.transaction(() => {
      for (const sql of [
        "ALTER TABLE runs ADD COLUMN dimension_id   INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE runs ADD COLUMN capacity       INTEGER NOT NULL DEFAULT 2",
        "ALTER TABLE runs ADD COLUMN host_client_id TEXT",
        "ALTER TABLE runs ADD COLUMN active         INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE runs ADD COLUMN party_q        INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE runs ADD COLUMN party_r        INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE runs ADD COLUMN created_at     INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE runs ADD COLUMN updated_at     INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE runs ADD COLUMN completed_at   INTEGER",
        "ALTER TABLE runs ADD COLUMN outcome        TEXT",
      ]) {
        try {
          db.exec(sql);
        } catch (e) {
          if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
        }
      }
      // Drop the run-scoped (v2, WRONG) exploration tables and rebuild under the global/per-run split.
      db.exec("DROP TABLE IF EXISTS explored_hexes");
      db.exec("DROP TABLE IF EXISTS explored_hex_icons");
      db.exec(`CREATE TABLE discovered_hexes (
        dimension_id INTEGER NOT NULL,
        q            INTEGER NOT NULL,
        r            INTEGER NOT NULL,
        PRIMARY KEY (dimension_id, q, r)
      )`);
      db.exec(`CREATE TABLE discovered_hex_icons (
        dimension_id INTEGER NOT NULL,
        q            INTEGER NOT NULL,
        r            INTEGER NOT NULL,
        icon         TEXT NOT NULL,
        PRIMARY KEY (dimension_id, q, r)
      )`);
      db.exec(`CREATE TABLE run_cleared_hexes (
        run_id INTEGER NOT NULL,
        q      INTEGER NOT NULL,
        r      INTEGER NOT NULL,
        PRIMARY KEY (run_id, q, r),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS run_seats (
        run_id          INTEGER NOT NULL,
        seat_index      INTEGER NOT NULL,
        client_id       TEXT,
        display_name    TEXT NOT NULL DEFAULT '',
        controller_kind TEXT NOT NULL,
        token_salt      TEXT,
        joined_at       INTEGER NOT NULL,
        left_at         INTEGER,
        PRIMARY KEY (run_id, seat_index),
        FOREIGN KEY (run_id) REFERENCES runs(id),
        CHECK (controller_kind IN ('human','bot')),
        CHECK ((controller_kind='bot'   AND client_id IS NULL)
            OR (controller_kind='human' AND client_id IS NOT NULL))
      )`);
      // At most one live (left_at IS NULL) human seat per client across all runs (R32 / R6).
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_run_seats_client_live
        ON run_seats(client_id) WHERE client_id IS NOT NULL AND left_at IS NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_active ON runs(active) WHERE active = 1`);
      db.exec(`CREATE TABLE IF NOT EXISTS run_seat_items (
        run_id     INTEGER NOT NULL,
        seat_index INTEGER NOT NULL,
        location   TEXT NOT NULL,
        slot_order INTEGER NOT NULL,
        item_id    TEXT NOT NULL,
        PRIMARY KEY (run_id, seat_index, location, slot_order),
        FOREIGN KEY (run_id) REFERENCES runs(id),
        CHECK (location IN ('bag','equipped'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS run_seat_attachments (
        run_id          INTEGER NOT NULL,
        seat_index      INTEGER NOT NULL,
        item_id         TEXT NOT NULL,
        attachment_json TEXT NOT NULL,
        PRIMARY KEY (run_id, seat_index, item_id),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    migrate();
  }
}

// v4: a durable "started" marker. Boot crash-recovery uses it to distinguish a never-started lobby run
// (a crash left it active=1; treat as abandoned so reconnects route HOME) from an in-progress overworld
// run (resume it). NULL until startGame flips to overworld (or a fresh play-again/abandon run is minted).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 4) {
    try {
      db.exec("ALTER TABLE runs ADD COLUMN started_at INTEGER");
    } catch (e) {
      if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
    }
    db.exec("PRAGMA user_version = 4");
  }
}

// v5: durable `runs.phase` — the SINGLE run-lifecycle source of truth, reusing the wire RoomPhase value
// set. Subsumes the v4 started_at heuristic (which stays as a now-dead column; SQLite can't cheaply DROP).
// The backfill makes an upgraded in-flight DB correct: finalized -> 'gameover', started -> 'overworld',
// else 'lobby'.
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 5) {
    try {
      db.exec("ALTER TABLE runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'lobby'");
    } catch (e) {
      if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
    }
    db.exec(
      "UPDATE runs SET phase = CASE WHEN active = 0 THEN 'gameover' WHEN started_at IS NOT NULL THEN 'overworld' ELSE 'lobby' END",
    );
    db.exec("PRAGMA user_version = 5");
  }
}

// v6: accounts & community foundation (docs/meta-loop/01-accounts.md).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 6) {
    const migrate = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS accounts (
        id              TEXT PRIMARY KEY,
        username        TEXT,                 -- as typed; NULL until claimed; ci-unique via index
        password_hash   TEXT,                 -- Bun.password argon2id; NULL for guests
        email           TEXT,
        is_guest        INTEGER NOT NULL DEFAULT 1,
        guest_client_id TEXT UNIQUE,          -- localStorage clientId that minted this guest; NULL once claimed
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        CHECK (is_guest IN (0,1)),
        CHECK (is_guest = 1 OR (username IS NOT NULL AND password_hash IS NOT NULL))
      )`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username_ci
        ON accounts(lower(username)) WHERE username IS NOT NULL`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_sessions (
        id           TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL,           -- -> accounts(id), app-enforced
        token_hash   TEXT NOT NULL UNIQUE,    -- sha256 hex of the bearer token (raw token never stored)
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL            -- sliding, 365d
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions(account_id)`);
      db.exec(`CREATE TABLE IF NOT EXISTS profiles (
        account_id        TEXT PRIMARY KEY,   -- 1:1 with accounts
        display_name      TEXT NOT NULL,
        xp                INTEGER NOT NULL DEFAULT 0,
        equipped_title_id TEXT,               -- -> titles(id), app-enforced against account_titles; NULL = none
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS friends (
        account_id TEXT NOT NULL,             -- requester (direction is meaningful while pending)
        friend_id  TEXT NOT NULL,
        status     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (account_id, friend_id),
        CHECK (status IN ('pending','accepted')),
        CHECK (account_id <> friend_id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id)`);
      db.exec(`CREATE TABLE IF NOT EXISTS titles (
        id          TEXT PRIMARY KEY,         -- slug, e.g. 'pathfinder'
        name        TEXT NOT NULL,
        description TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_titles (
        account_id TEXT NOT NULL,
        title_id   TEXT NOT NULL,
        earned_at  TEXT NOT NULL,
        PRIMARY KEY (account_id, title_id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_stats (
        account_id TEXT NOT NULL,
        stat       TEXT NOT NULL,             -- 'encounters_won' | 'hexes_charted' | 'dimensions_discovered' | 'wipes' (open set)
        value      INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, stat)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_dimensions (
        account_id    TEXT NOT NULL,
        dimension_id  INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        PRIMARY KEY (account_id, dimension_id)
      )`);
      try {
        db.exec("ALTER TABLE run_seats ADD COLUMN account_id TEXT");
      } catch (e) {
        if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_run_seats_account ON run_seats(account_id)`);
      db.exec(`PRAGMA user_version = 6`);
    });
    migrate();
  }
}

// v7: contracts & run outcomes (docs/meta-loop/02-contracts.md).
// runs.contract_json: the run's ContractState snapshot (shared/src/overworld/contracts.ts),
// NULL for legacy/pre-contract runs. run_pending_xp: the per-run pending-XP ledger, banked
// into profiles.xp by finalizeRun with the outcome multiplier (rows kept as audit).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 7) {
    const migrate = db.transaction(() => {
      try {
        db.exec("ALTER TABLE runs ADD COLUMN contract_json TEXT");
      } catch (e) {
        if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
      }
      db.exec(`CREATE TABLE IF NOT EXISTS run_pending_xp (
        run_id     INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        amount     INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, account_id),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec(`PRAGMA user_version = 7`);
    });
    migrate();
  }
}

// v8: portals & tiered multiverse (docs/meta-loop/04-portals.md).
// dimensions.tier: descent depth; NULL = not yet placed (attunement-pool candidate when ready).
// dimension_gateways: community-permanent portal graph — (from_dimension, hex) -> to_dimension,
// destination fixed forever on first attunement; UNIQUE(to_dimension_id) keeps it a tree.
// runs.start_dimension_id: the lobby-picked start (resetToOrigin/rematch target; feature 3
// derives the run's starting tier from it). runs.dimension_id becomes "current dimension".
// run_cleared_hexes rebuilt with dimension_id in the PK (per-run cleared state is now
// per-dimension; backfill joins runs.dimension_id — pre-v8 runs never changed dimension).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 8) {
    const migrate = db.transaction(() => {
      for (const sql of [
        "ALTER TABLE dimensions ADD COLUMN tier INTEGER",
        "ALTER TABLE runs ADD COLUMN start_dimension_id INTEGER",
      ]) {
        try {
          db.exec(sql);
        } catch (e) {
          if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
        }
      }
      // Tier backfill for pre-portal dimensions — mapping flagged in 04-portals §0.2 (ADJUST ME).
      db.exec("UPDATE dimensions SET tier = 0 WHERE id IN (0, 1) AND tier IS NULL");
      db.exec("UPDATE dimensions SET tier = 1 WHERE id IN (2, 501) AND tier IS NULL");
      db.exec("UPDATE dimensions SET tier = 2 WHERE id = 3 AND tier IS NULL");
      db.exec("UPDATE runs SET start_dimension_id = dimension_id WHERE start_dimension_id IS NULL");
      db.exec(`CREATE TABLE IF NOT EXISTS dimension_gateways (
        from_dimension_id     INTEGER NOT NULL,
        q                     INTEGER NOT NULL,
        r                     INTEGER NOT NULL,
        to_dimension_id       INTEGER NOT NULL UNIQUE,
        attuned_at            INTEGER NOT NULL,
        attuned_by_account_id TEXT,
        PRIMARY KEY (from_dimension_id, q, r),
        FOREIGN KEY (from_dimension_id) REFERENCES dimensions(id),
        FOREIGN KEY (to_dimension_id)   REFERENCES dimensions(id)
      )`);
      // Legacy item-id dedup (03-loot-codex §9): pre-collision-check data may carry a duplicated id
      // ("short-sword" in dims 0 AND 501). getItemById's global WHERE id = ? resolution — and
      // feature 3's codex_firsts(item_id) PK — require uniqueness. Keep the lowest-dimension owner;
      // rename other rows to the d<dim>-<id> convention saveItems' error prescribes, rewriting
      // item_json.id and re-pointing seat rows for runs at that dimension.
      const dupeIds = db.query("SELECT id FROM items GROUP BY id HAVING COUNT(*) > 1").all() as { id: string }[];
      for (const { id } of dupeIds) {
        const owners = db.query("SELECT dimension_id FROM items WHERE id = ? ORDER BY dimension_id").all(id) as { dimension_id: number }[];
        for (const { dimension_id } of owners.slice(1)) {
          const newId = `d${dimension_id}-${id}`;
          // The pipeline may have already re-saved this design under the d<dim>- convention
          // (collision-aware saveItems), leaving the legacy row as a superseded duplicate in the
          // same dimension. Renaming would collide with the (id, dimension_id) PK — fold the
          // legacy row into its successor instead.
          const superseded = db.query("SELECT 1 FROM items WHERE id = ? AND dimension_id = ?").get(newId, dimension_id);
          if (superseded) {
            db.prepare("DELETE FROM items WHERE id = ? AND dimension_id = ?").run(id, dimension_id);
          } else {
            db.prepare("UPDATE items SET id = ?, item_json = json_set(item_json, '$.id', ?) WHERE id = ? AND dimension_id = ?")
              .run(newId, newId, id, dimension_id);
          }
          db.prepare("UPDATE run_seat_items SET item_id = ? WHERE item_id = ? AND run_id IN (SELECT id FROM runs WHERE dimension_id = ?)")
            .run(newId, id, dimension_id);
          db.prepare("UPDATE run_seat_attachments SET item_id = ? WHERE item_id = ? AND run_id IN (SELECT id FROM runs WHERE dimension_id = ?)")
            .run(newId, id, dimension_id);
        }
      }
      const clearedCols = (db.query("PRAGMA table_info(run_cleared_hexes)").all() as { name: string }[])
        .map((c) => c.name);
      if (!clearedCols.includes("dimension_id")) {
        db.exec(`CREATE TABLE run_cleared_hexes_v8 (
          run_id       INTEGER NOT NULL,
          dimension_id INTEGER NOT NULL,
          q            INTEGER NOT NULL,
          r            INTEGER NOT NULL,
          PRIMARY KEY (run_id, dimension_id, q, r),
          FOREIGN KEY (run_id) REFERENCES runs(id)
        )`);
        db.exec(`INSERT INTO run_cleared_hexes_v8 (run_id, dimension_id, q, r)
          SELECT rc.run_id, r.dimension_id, rc.q, rc.r
          FROM run_cleared_hexes rc JOIN runs r ON r.id = rc.run_id`);
        db.exec("DROP TABLE run_cleared_hexes");
        db.exec("ALTER TABLE run_cleared_hexes_v8 RENAME TO run_cleared_hexes");
      }
      db.exec(`PRAGMA user_version = 8`);
    });
    migrate();
  }
}

// v9: loot & codex (docs/meta-loop/03-loot-codex.md).
// run_loot: the run's drop ledger + shared party pool (assigned_seat_index NULL = still in the
// pool). item_json snapshots the ItemDefinition at drop time so loot outlives pool rewrites.
// codex_entries: per-account banked designs (full snapshot + tier resolved at bank time).
// codex_firsts: global first-recovery provenance — one row per design, ever, across all accounts.
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 9) {
    const migrate = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS run_loot (
        id                  INTEGER PRIMARY KEY,
        run_id              INTEGER NOT NULL,
        item_id             TEXT NOT NULL,
        dimension_id        INTEGER NOT NULL,   -- the item's native dimension (item.dimensionId)
        item_json           TEXT NOT NULL,      -- ItemDefinition snapshot at drop time
        source_q            INTEGER NOT NULL,
        source_r            INTEGER NOT NULL,
        source_icon         TEXT,               -- hex icon at drop time (richness provenance)
        dropped_at          INTEGER NOT NULL,   -- ms epoch (run-table convention)
        assigned_seat_index INTEGER,            -- NULL = unclaimed (in the party pool)
        assigned_account_id TEXT,
        assigned_at         INTEGER,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_run_loot_run ON run_loot (run_id)");
      db.exec(`CREATE TABLE IF NOT EXISTS codex_entries (
        account_id   TEXT NOT NULL,
        item_id      TEXT NOT NULL,
        dimension_id INTEGER NOT NULL,
        tier         INTEGER NOT NULL,          -- snapshot at bank time (flag #4)
        item_json    TEXT NOT NULL,
        acquired_at  TEXT NOT NULL,             -- ISO-8601 (account-table convention, 01 §1.1)
        PRIMARY KEY (account_id, item_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_codex_entries_item ON codex_entries (item_id)");
      db.exec(`CREATE TABLE IF NOT EXISTS codex_firsts (
        item_id      TEXT PRIMARY KEY,
        dimension_id INTEGER NOT NULL,
        account_id   TEXT NOT NULL,             -- the discoverer (flag #6)
        recovered_at TEXT NOT NULL,             -- ISO-8601
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )`);
      db.exec(`PRAGMA user_version = 9`);
    });
    migrate();
  }
}

// v10 (vestigial): the short-lived party-box design let players stash items into run_loot;
// `origin` separated deposits from drops. v11's shared party bag moved deposits to their own
// table, so run_loot is a pure drop ledger again and `origin` is always 'drop' going forward.
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 10) {
    const migrate = db.transaction(() => {
      db.exec("ALTER TABLE run_loot ADD COLUMN origin TEXT NOT NULL DEFAULT 'drop'");
      db.exec("PRAGMA user_version = 10");
    });
    migrate();
  }
}

// v11: the shared party bag. All unequipped items live in one run-scoped pool; seats keep only
// their equipped loadout in run_seat_items. item_json snapshots the definition at insert time
// (run_loot precedent) so bag contents survive item-pool rewrites. Active runs' per-seat bag
// rows backfill into the shared bag (resolved via the items table; ids are globally unique).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 11) {
    const migrate = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS run_party_bag (
        id          INTEGER PRIMARY KEY,        -- the stable equip handle (PartyBagEntry.bagId)
        run_id      INTEGER NOT NULL,
        item_id     TEXT NOT NULL,
        item_json   TEXT NOT NULL,              -- ItemDefinition snapshot at insert time
        source_icon TEXT,                       -- drop provenance; NULL for player deposits/staging
        added_at    INTEGER NOT NULL,           -- ms epoch (run-table convention)
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_run_party_bag_run ON run_party_bag (run_id)");
      db.exec(`INSERT INTO run_party_bag (run_id, item_id, item_json, source_icon, added_at)
        SELECT rsi.run_id, rsi.item_id,
               COALESCE(
                 (SELECT i.item_json FROM items i WHERE i.id = rsi.item_id LIMIT 1),
                 (SELECT rl.item_json FROM run_loot rl
                   WHERE rl.run_id = rsi.run_id AND rl.item_id = rsi.item_id LIMIT 1)),
               NULL, 0
        FROM run_seat_items rsi
        JOIN runs r ON r.id = rsi.run_id AND r.active = 1
        WHERE rsi.location = 'bag'
          AND (EXISTS (SELECT 1 FROM items i WHERE i.id = rsi.item_id)
            OR EXISTS (SELECT 1 FROM run_loot rl
                 WHERE rl.run_id = rsi.run_id AND rl.item_id = rsi.item_id))`);
      db.exec("DELETE FROM run_seat_items WHERE location = 'bag'");
      db.exec("PRAGMA user_version = 11");
    });
    migrate();
  }
}


// --- Wire event log persistence ---

const insertWireLogRecordStmt = db.prepare(
  "INSERT INTO wire_log_records (t, dir, seq, room, run_id, seat_id, type, action_count, note, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const recentWireLogRecordsStmt = db.prepare(
  "SELECT record_json FROM wire_log_records ORDER BY t DESC, id DESC LIMIT ?",
);
const recentWireLogRecordsByRoomStmt = db.prepare(
  "SELECT record_json FROM wire_log_records WHERE room = ? ORDER BY t DESC, id DESC LIMIT ?",
);
const clearWireLogRecordsStmt = db.prepare("DELETE FROM wire_log_records");

export function saveWireLogRecord(record: WireLogRecord): void {
  insertWireLogRecordStmt.run(
    record.t,
    record.dir,
    record.seq,
    record.room ?? null,
    record.runId ?? null,
    record.seatId ?? null,
    record.type,
    record.actionCount ?? null,
    record.note ?? null,
    JSON.stringify(record),
  );
}

export function loadWireLogRecords(filter?: { room?: RoomCode; limit?: number }): WireLogRecord[] {
  const limit = filter?.limit ?? 2000;
  const rows = (filter?.room
    ? recentWireLogRecordsByRoomStmt.all(filter.room, limit)
    : recentWireLogRecordsStmt.all(limit)) as { record_json: string }[];
  return rows.reverse().map((row) => JSON.parse(row.record_json) as WireLogRecord);
}

export function clearWireLogRecords(): void {
  clearWireLogRecordsStmt.run();
}

// --- Discovery: GLOBAL community fog-of-war, keyed by dimension, permanent + append-only. ---
const insertDiscoveredStmt = db.prepare(
  "INSERT OR IGNORE INTO discovered_hexes (dimension_id, q, r) VALUES (?, ?, ?)"
);
const discoveredForDimStmt = db.prepare("SELECT q, r FROM discovered_hexes WHERE dimension_id = ?");
const insertDiscoveredIconStmt = db.prepare(
  "INSERT OR REPLACE INTO discovered_hex_icons (dimension_id, q, r, icon) VALUES (?, ?, ?, ?)"
);
const discoveredIconsForDimStmt = db.prepare("SELECT q, r, icon FROM discovered_hex_icons WHERE dimension_id = ?");

/** Reveal a hex in the community map. Returns true iff this was the FIRST-EVER discovery. */
export function discoverHex(dimensionId: number, coord: HexCoord): boolean {
  return insertDiscoveredStmt.run(dimensionId, coord.q, coord.r).changes > 0;
}

/** The whole community-discovered set for a dimension, as the client-facing "explored" status map. */
export function loadDiscoveredHexes(dimensionId: number): Record<string, HexStatus> {
  const rows = discoveredForDimStmt.all(dimensionId) as { q: number; r: number }[];
  const hexes: Record<string, HexStatus> = {};
  for (const row of rows) hexes[`${row.q},${row.r}`] = "explored";
  return hexes;
}

export function saveDiscoveredHexIcon(dimensionId: number, coord: HexCoord, icon: string): void {
  insertDiscoveredIconStmt.run(dimensionId, coord.q, coord.r, icon);
}

export function loadDiscoveredHexIcons(dimensionId: number): Record<string, string> {
  const rows = discoveredIconsForDimStmt.all(dimensionId) as { q: number; r: number; icon: string }[];
  const icons: Record<string, string> = {};
  for (const row of rows) icons[`${row.q},${row.r}`] = row.icon;
  return icons;
}

/** Seed the starting disc into the community map (idempotent; runs per dimension, not per run). */
export function seedDiscovery(dimensionId: number, radius: number): void {
  const tx = db.transaction(() => {
    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) insertDiscoveredStmt.run(dimensionId, q, r);
    }
  });
  tx();
}

// --- Cleared-this-run: PER-RUN combat progress (durable visitedThisRun), now per-dimension (v8). ---
const insertClearedStmt = db.prepare(
  "INSERT OR IGNORE INTO run_cleared_hexes (run_id, dimension_id, q, r) VALUES (?, ?, ?, ?)"
);
const clearedForRunStmt = db.prepare(
  "SELECT q, r FROM run_cleared_hexes WHERE run_id = ? AND dimension_id = ?"
);
// Count of combat-cleared hexes for the whole run: every dimension's origin is (0,0) and is
// auto-cleared at entry (run start / travel), never combat-cleared — so excluding (0,0) rows
// yields exactly the encounter-win count (feeds Room.runClearedCount on crash recovery).
const combatClearedCountStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM run_cleared_hexes WHERE run_id = ? AND NOT (q = 0 AND r = 0)"
);
const delClearedForRunStmt = db.prepare("DELETE FROM run_cleared_hexes WHERE run_id = ?");

export function markRunCleared(runId: number, dimensionId: number, coord: HexCoord): void {
  insertClearedStmt.run(runId, dimensionId, coord.q, coord.r);
}

export function loadRunCleared(runId: number, dimensionId: number): Set<string> {
  const rows = clearedForRunStmt.all(runId, dimensionId) as { q: number; r: number }[];
  const cleared = new Set<string>();
  for (const row of rows) cleared.add(`${row.q},${row.r}`);
  return cleared;
}

export function countRunCombatCleared(runId: number): number {
  return (combatClearedCountStmt.get(runId) as { n: number }).n;
}

/** Whole-run reset semantics: erase every dimension's cleared rows for the run. */
export function clearRunCleared(runId: number): void {
  delClearedForRunStmt.run(runId);
}

/**
 * Write point 4 (R13.2): atomically discover the hex globally (+ its icon), mark it cleared for THIS
 * run, and advance the party position — all in ONE transaction so a crash can never persist cleared
 * without the matching party_q/r. Returns true iff this was the first-ever discovery in the dimension.
 */
export function commitExplore(dimensionId: number, runId: number, coord: HexCoord, icon: string | null): boolean {
  let firstEver = false;
  const tx = db.transaction(() => {
    firstEver = insertDiscoveredStmt.run(dimensionId, coord.q, coord.r).changes > 0;
    if (icon) insertDiscoveredIconStmt.run(dimensionId, coord.q, coord.r, icon);
    insertClearedStmt.run(runId, dimensionId, coord.q, coord.r);
    updatePartyPosStmt.run(coord.q, coord.r, Date.now(), runId);
  });
  tx();
  return firstEver;
}

// --- Runs ---
/** The run's lifecycle phase — the single durable source of truth (same value set as the wire RoomPhase). */
export type RunPhase = "lobby" | "overworld" | "combat" | "gameover";
// The durable run outcome set now lives in shared (gained "retreat"); re-export for db.ts consumers.
export type { RunOutcome };

export interface RunRow {
  id: number;
  dimension_id: number;
  start_dimension_id: number; // v8 backfill guarantees non-null (the lobby-picked start dimension)
  capacity: number;
  host_client_id: string | null;
  active: number;
  phase: RunPhase;
  party_q: number;
  party_r: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  outcome: string | null;
  contract_json: string | null; // the run's ContractState snapshot (v7); NULL for legacy/pre-contract runs.
  started_at: number | null; // dead column (subsumed by `phase`); kept because SQLite can't cheaply DROP.
}

const insertRunStmt = db.prepare(
  `INSERT INTO runs (dimension_id, start_dimension_id, capacity, host_client_id, active,
                     party_q, party_r, created_at, updated_at)
   VALUES (?, ?, ?, ?, 1, 0, 0, ?, ?)`
); // startNewRun passes dimensionId for BOTH — a fresh run starts where it starts.
const runByIdStmt = db.prepare("SELECT * FROM runs WHERE id = ?");
const updatePartyPosStmt = db.prepare("UPDATE runs SET party_q = ?, party_r = ?, updated_at = ? WHERE id = ?");
const setHostStmt = db.prepare("UPDATE runs SET host_client_id = ?, updated_at = ? WHERE id = ?");
const setRunPhaseStmt = db.prepare("UPDATE runs SET phase = ?, updated_at = ? WHERE id = ? AND active = 1");
// `AND active = 1` makes finalizeRun first-writer-wins: a later abandon of an already-final (e.g.
// 'defeat') run is a no-op instead of clobbering its outcome/completed_at/phase.
const markRunInactiveStmt = db.prepare("UPDATE runs SET active = 0, completed_at = ?, outcome = ?, phase = 'gameover' WHERE id = ? AND active = 1");
const stampSeatsLeftStmt = db.prepare("UPDATE run_seats SET left_at = ? WHERE run_id = ? AND left_at IS NULL");
const staleRunsStmt = db.prepare("SELECT id FROM runs WHERE active = 1 AND updated_at < ?");
const activeRunIdsStmt = db.prepare("SELECT id FROM runs WHERE active = 1");

// --- Contract snapshot (SSOT for crash recovery). `AND active = 1` mirrors setRunPhase: a
// finalized run's contract is frozen. ---
const setRunContractStmt = db.prepare(
  "UPDATE runs SET contract_json = ?, updated_at = ? WHERE id = ? AND active = 1",
);
export function saveRunContract(runId: number, contract: ContractState): void {
  setRunContractStmt.run(JSON.stringify(contract), Date.now(), runId);
}

const clearRunContractStmt = db.prepare(
  "UPDATE runs SET contract_json = NULL, updated_at = ? WHERE id = ? AND active = 1",
);
/** Drop the run's contract selection (a lobby dimension change that voids the current type, §4.5). */
export function clearRunContract(runId: number): void {
  clearRunContractStmt.run(Date.now(), runId);
}

// --- Pending-XP ledger (per run, per account). Banked into profiles.xp by finalizeRun. ---
const accruePendingXpStmt = db.prepare(
  `INSERT INTO run_pending_xp (run_id, account_id, amount, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(run_id, account_id) DO UPDATE SET
     amount = amount + excluded.amount, updated_at = excluded.updated_at`,
);
const pendingXpForRunStmt = db.prepare(
  "SELECT account_id, amount FROM run_pending_xp WHERE run_id = ?",
);
const singlePendingXpStmt = db.prepare(
  "SELECT amount FROM run_pending_xp WHERE run_id = ? AND account_id = ?",
);
const bankXpStmt = db.prepare(
  "UPDATE profiles SET xp = xp + ?, updated_at = ? WHERE account_id = ?",
);
export interface PendingXpRow {
  account_id: string;
  amount: number;
}

/** Accrue provisional XP for one account on one run. Returns the new pending total. */
export function accruePendingXp(runId: number, accountId: string, amount: number): number {
  accruePendingXpStmt.run(runId, accountId, amount, Date.now());
  const row = singlePendingXpStmt.get(runId, accountId) as { amount: number };
  return row.amount;
}

export function loadPendingXp(runId: number): PendingXpRow[] {
  return pendingXpForRunStmt.all(runId) as PendingXpRow[];
}

/**
 * Every still-active run id. Drives boot-time crash recovery (a run left active=1 by a crash).
 * CONTRACT: the DB `active` flag means "was-ever-finalized"; the in-memory RoomRegistry is the
 * authority for "is-live-now". This and deactivateStaleRuns are the only DB-as-set readers, and both
 * defer to the registry (boot recovery dedupes via getByRun; the sweep filters via the isLive predicate).
 */
export function loadActiveRunIds(): number[] {
  return (activeRunIdsStmt.all() as { id: number }[]).map((r) => r.id);
}

export function startNewRun(dimensionId: number, hostClientId: string | null, capacity = 2): number {
  const now = Date.now();
  const info = insertRunStmt.run(dimensionId, dimensionId, capacity, hostClientId, now, now);
  return Number(info.lastInsertRowid);
}

// Shrink a run's capacity to the humans present at start (empty seats dropped, never bot-filled).
const setRunCapacityStmt = db.prepare("UPDATE runs SET capacity = ?, updated_at = ? WHERE id = ?");
export function setRunCapacity(runId: number, capacity: number): void {
  setRunCapacityStmt.run(capacity, Date.now(), runId);
}

// Lobby-only re-pick (chooseDimension): current AND start move together, pre-start.
const setRunStartDimensionStmt = db.prepare(
  "UPDATE runs SET dimension_id = ?, start_dimension_id = ?, updated_at = ? WHERE id = ? AND active = 1"
);
export function setRunStartDimension(runId: number, dimensionId: number): void {
  setRunStartDimensionStmt.run(dimensionId, dimensionId, Date.now(), runId);
}

const setRunDimensionStmt = db.prepare(
  "UPDATE runs SET dimension_id = ?, party_q = 0, party_r = 0, updated_at = ? WHERE id = ? AND active = 1"
);

/**
 * Mid-run gateway travel (write point: 04-portals §4.3). ONE transaction: re-point the run's
 * current dimension + reset party pos to origin, seed the destination's community discovery disc +
 * origin icon, and mark the destination origin cleared for this run — a crash can never persist the
 * dimension swap without the origin state that makes it resumable. start_dimension_id is untouched.
 */
export function commitTravel(runId: number, toDimensionId: number, radius: number): void {
  const now = Date.now();
  const tx = db.transaction(() => {
    setRunDimensionStmt.run(toDimensionId, now, runId);
    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) insertDiscoveredStmt.run(toDimensionId, q, r);
    }
    insertDiscoveredIconStmt.run(toDimensionId, 0, 0, "town");
    insertClearedStmt.run(runId, toDimensionId, 0, 0);
  });
  tx();
}

export function loadRun(runId: number): RunRow | null {
  return (runByIdStmt.get(runId) as RunRow | null) ?? null;
}

export function updateRunPartyPos(runId: number, coord: HexCoord): void {
  updatePartyPosStmt.run(coord.q, coord.r, Date.now(), runId);
}

export function setRunHost(runId: number, hostClientId: string | null): void {
  setHostStmt.run(hostClientId, Date.now(), runId);
}

/** Persist the run's lifecycle phase — the single durable truth, written wherever room.phase changes.
 *  `AND active = 1` (in the stmt) makes a stray write after finalization a no-op: a dead run has no phase. */
export function setRunPhase(runId: number, phase: RunPhase): void {
  setRunPhaseStmt.run(phase, Date.now(), runId);
}

/**
 * THE single idempotent run-end: finish the run ('gameover' phase + active=0 + outcome) and stamp every
 * still-present seat as left — atomically. Returns true iff THIS call performed the transition
 * (first-writer-wins): a later abandon over an already-final run is a no-op that cannot clobber its
 * recorded outcome, and the seat-stamp runs only on the transition so a re-finalize never re-stamps.
 */
export function finalizeRun(runId: number, outcome: RunOutcome): boolean {
  const now = Date.now();
  let changed = false;
  const tx = db.transaction(() => {
    changed = markRunInactiveStmt.run(now, outcome, runId).changes > 0;
    if (changed) {
      stampSeatsLeftStmt.run(now, runId);
      // Bank the pending-XP ledger with the outcome multiplier (locked decisions 6/7). Rows are
      // kept (audit + settlement pushes); the `changed` guard makes this once-ever. profiles.updated_at
      // is ISO TEXT (v6 schema), so stamp it with an ISO string, not the ms `now`.
      const nowIso = new Date().toISOString();
      for (const row of pendingXpForRunStmt.all(runId) as PendingXpRow[]) {
        const banked = bankedXp(row.amount, outcome);
        if (banked > 0) bankXpStmt.run(banked, nowIso, row.account_id);
      }
    }
  });
  tx();
  return changed;
}

/**
 * Housekeeping (R33): abandon runs untouched for longer than `olderThanMs`. `isLive` (the in-memory
 * registry check) excludes runs whose Room is still live — a long-occupied overworld party that simply
 * hasn't moved must NOT be inactivated out from under its live Room (durable/in-memory divergence).
 */
export function deactivateStaleRuns(olderThanMs: number, isLive?: (runId: number) => boolean): number {
  const cutoff = Date.now() - olderThanMs;
  const rows = (staleRunsStmt.all(cutoff) as { id: number }[]).filter((r) => !isLive || !isLive(r.id));
  for (const row of rows) finalizeRun(row.id, "abandoned"); // route through the single run-end owner
  return rows.length;
}

const runsForClientStmt = db.prepare("SELECT DISTINCT run_id FROM run_seats WHERE client_id = ?");
const delSeatItemsForRunStmt = db.prepare("DELETE FROM run_seat_items WHERE run_id = ?");
const delSeatAttachForRunStmt = db.prepare("DELETE FROM run_seat_attachments WHERE run_id = ?");
const delSeatsForRunStmt = db.prepare("DELETE FROM run_seats WHERE run_id = ?");
const delClearedForRunEraseStmt = db.prepare("DELETE FROM run_cleared_hexes WHERE run_id = ?");
const delPendingXpForRunStmt = db.prepare("DELETE FROM run_pending_xp WHERE run_id = ?");
const delLootForRunStmt = db.prepare("DELETE FROM run_loot WHERE run_id = ?");
const delPartyBagForRunStmt = db.prepare("DELETE FROM run_party_bag WHERE run_id = ?");
const delRunStmt = db.prepare("DELETE FROM runs WHERE id = ?");

/**
 * Right-to-erasure (R33): hard-delete every per-run durable row for a client's runs (seats,
 * inventory, attachments, this-run cleared hexes, and the run rows themselves). `clientId` is a
 * stable pseudonymous device id and therefore personal data; this is the admin erasure entry point.
 * The GLOBAL community discovery map is NOT touched — it is shared, non-personal world state.
 * Returns the number of runs erased.
 */
export function eraseClient(clientId: string): number {
  const runIds = (runsForClientStmt.all(clientId) as { run_id: number }[]).map((r) => r.run_id);
  const tx = db.transaction(() => {
    for (const runId of runIds) {
      delSeatItemsForRunStmt.run(runId);
      delSeatAttachForRunStmt.run(runId);
      delSeatsForRunStmt.run(runId);
      delClearedForRunEraseStmt.run(runId);
      delPendingXpForRunStmt.run(runId);
      delLootForRunStmt.run(runId);
      delPartyBagForRunStmt.run(runId);
      delRunStmt.run(runId);
    }
  });
  tx();
  return runIds.length;
}

// --- Run seats (membership / identity binding; v1 lookup by raw client_id) ---
export type ControllerKind = "human" | "bot";
export interface RunSeatRow {
  run_id: number;
  seat_index: number;
  client_id: string | null;
  display_name: string;
  controller_kind: ControllerKind;
  token_salt: string | null;
  account_id: string | null;
  joined_at: number;
  left_at: number | null;
}

const upsertSeatStmt = db.prepare(
  `INSERT INTO run_seats (run_id, seat_index, client_id, display_name, controller_kind, token_salt, account_id, joined_at, left_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
   ON CONFLICT(run_id, seat_index) DO UPDATE SET
     client_id = excluded.client_id, display_name = excluded.display_name,
     controller_kind = excluded.controller_kind, token_salt = excluded.token_salt,
     account_id = excluded.account_id, left_at = NULL`
);
const leaveSeatStmt = db.prepare("UPDATE run_seats SET left_at = ? WHERE run_id = ? AND seat_index = ?");
const seatsForRunStmt = db.prepare("SELECT * FROM run_seats WHERE run_id = ? ORDER BY seat_index");
const activeSeatForClientStmt = db.prepare(
  `SELECT rs.run_id AS runId, rs.seat_index AS seatIndex
   FROM run_seats rs JOIN runs r ON r.id = rs.run_id
   WHERE rs.client_id = ? AND rs.left_at IS NULL AND r.active = 1
   ORDER BY r.updated_at DESC, r.id DESC LIMIT 1`
);

export function upsertRunSeat(
  runId: number,
  seatIndex: number,
  seat: {
    clientId: string | null;
    displayName: string;
    controllerKind: ControllerKind;
    tokenSalt: string | null;
    accountId: string | null;
  },
): void {
  // Mirror of the client_id table CHECK, which SQLite cannot gain via ALTER (app-enforced, §1.2).
  if (seat.controllerKind === "bot" && seat.accountId !== null) {
    throw new Error(`upsertRunSeat: bot seat ${runId}/${seatIndex} must not carry an accountId`);
  }
  upsertSeatStmt.run(
    runId,
    seatIndex,
    seat.clientId,
    seat.displayName,
    seat.controllerKind,
    seat.tokenSalt,
    seat.accountId,
    Date.now(),
  );
}

const setSeatAccountIfNullStmt = db.prepare(
  "UPDATE run_seats SET account_id = ? WHERE run_id = ? AND seat_index = ? AND account_id IS NULL",
);

/** Backfill attribution onto an unattributed seat row. The IS NULL guard is load-bearing (§4.6):
 *  a seat already attributed to a claimed account is NEVER re-pointed at a throwaway guest. */
export function setSeatAccountIfNull(runId: number, seatIndex: number, accountId: string): void {
  setSeatAccountIfNullStmt.run(accountId, runId, seatIndex);
}

export function leaveRunSeat(runId: number, seatIndex: number): void {
  leaveSeatStmt.run(Date.now(), runId, seatIndex);
}

const liveSeatsForRunStmt = db.prepare(
  "SELECT seat_index FROM run_seats WHERE run_id = ? AND controller_kind = 'human' AND client_id IS NOT NULL AND left_at IS NULL"
);

/**
 * R32 prior-run cleanup: before a client takes a new seat, left_at-stamp any prior live human seat
 * it holds, and if that leaves the prior run with zero live human seats, mark the run abandoned.
 * Single transaction so the unique-live index (idx_run_seats_client_live) never sees two live rows
 * for one clientId — this is what prevents the "abandon/win then play again" UNIQUE-constraint crash.
 * Returns the prior runId that was stamped (and whether it was inactivated), so the caller can tear
 * down any lingering in-memory Room for that run (cross-Room identity teardown, R32).
 */
export function abandonPriorSeatForClient(
  clientId: string,
): { runId: number; seatIndex: number; runInactivated: boolean } | null {
  const prior = findActiveSeatForClient(clientId);
  if (!prior) return null;
  // Stamp the prior seat left FIRST (frees the unique-live index immediately), then — if that left the
  // run with no live human — finalize it through the single run-end owner. The boolean return replaces
  // the old recount-driven flag (equivalent: findActiveSeatForClient already gated on an active run).
  leaveSeatStmt.run(Date.now(), prior.runId, prior.seatIndex);
  const remaining = liveSeatsForRunStmt.all(prior.runId) as { seat_index: number }[];
  const runInactivated = remaining.length === 0 ? finalizeRun(prior.runId, "abandoned") : false;
  return { runId: prior.runId, seatIndex: prior.seatIndex, runInactivated };
}

export function loadRunSeats(runId: number): RunSeatRow[] {
  return seatsForRunStmt.all(runId) as RunSeatRow[];
}

/** The single live human seat for a client across all active runs (deterministic, R32). */
export function findActiveSeatForClient(clientId: string): { runId: number; seatIndex: number } | null {
  return (activeSeatForClientStmt.get(clientId) as { runId: number; seatIndex: number } | null) ?? null;
}

// --- Per-seat inventory (IDs + ordering only; rehydrated from loadItems, R13.3) ---
const delSeatItemsStmt = db.prepare("DELETE FROM run_seat_items WHERE run_id = ? AND seat_index = ?");
const insSeatItemStmt = db.prepare(
  "INSERT INTO run_seat_items (run_id, seat_index, location, slot_order, item_id) VALUES (?, ?, ?, ?, ?)"
);
const delSeatAttachStmt = db.prepare("DELETE FROM run_seat_attachments WHERE run_id = ? AND seat_index = ?");
const insSeatAttachStmt = db.prepare(
  "INSERT INTO run_seat_attachments (run_id, seat_index, item_id, attachment_json) VALUES (?, ?, ?, ?)"
);
const seatItemsStmt = db.prepare("SELECT location, slot_order, item_id FROM run_seat_items WHERE run_id = ? AND seat_index = ?");
const seatAttachStmt = db.prepare("SELECT item_id, attachment_json FROM run_seat_attachments WHERE run_id = ? AND seat_index = ?");

export function saveSeatInventory(runId: number, seatIndex: number, inv: InventoryState): void {
  const tx = db.transaction(() => {
    delSeatItemsStmt.run(runId, seatIndex);
    delSeatAttachStmt.run(runId, seatIndex);
    inv.equipped.forEach((item, i) => insSeatItemStmt.run(runId, seatIndex, "equipped", i, item.id));
    for (const [itemId, att] of Object.entries(inv.attachments)) {
      insSeatAttachStmt.run(runId, seatIndex, itemId, JSON.stringify(att));
    }
  });
  tx();
}

export function loadSeatInventory(runId: number, seatIndex: number): InventoryState {
  const itemRows = seatItemsStmt.all(runId, seatIndex) as { location: string; slot_order: number; item_id: string }[];
  const equippedPairs: { order: number; item: ItemDefinition }[] = [];
  for (const row of itemRows) {
    if (row.location !== "equipped") continue;
    const item = resolveItemForRun(runId, row.item_id); // live pool -> this run's drops -> codex snapshot (flag #8)
    if (!item) {
      console.warn(`[db] seat inventory: unknown item_id "${row.item_id}" (run ${runId} seat ${seatIndex}) — skipped`);
      continue;
    }
    equippedPairs.push({ order: row.slot_order, item });
  }
  equippedPairs.sort((a, b) => a.order - b.order);
  const equipped = equippedPairs.map((p) => p.item);
  const attachments: Record<string, AttachmentData> = {};
  const attRows = seatAttachStmt.all(runId, seatIndex) as { item_id: string; attachment_json: string }[];
  for (const row of attRows) {
    if (equipped.some((e) => e.id === row.item_id)) {
      attachments[row.item_id] = JSON.parse(row.attachment_json) as AttachmentData;
    }
  }
  return { equipped, attachments };
}

// --- Loot ledger (run-scoped; docs/meta-loop/03-loot-codex.md §1.3) ---
// Pure drop record: codex banking reads it at run end; it is NOT storage (the party bag is).
export interface RunLootRow {
  id: number; run_id: number; item_id: string; dimension_id: number; item_json: string;
  source_q: number; source_r: number; source_icon: string | null; dropped_at: number;
}

const insertRunLootStmt = db.prepare(
  `INSERT INTO run_loot (run_id, item_id, dimension_id, item_json, source_q, source_r, source_icon, dropped_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const allLootForRunStmt = db.prepare("SELECT * FROM run_loot WHERE run_id = ? ORDER BY id");
const lootSnapshotForRunStmt = db.prepare(
  "SELECT item_json FROM run_loot WHERE run_id = ? AND item_id = ? LIMIT 1");

export function loadRunLoot(runId: number): RunLootRow[] {
  return allLootForRunStmt.all(runId) as RunLootRow[];
}

// --- Shared party bag (run-scoped storage for every unequipped item, v11) ---
export interface PartyBagRow {
  id: number; run_id: number; item_id: string; item_json: string;
  source_icon: string | null; added_at: number;
}

const insPartyBagStmt = db.prepare(
  "INSERT INTO run_party_bag (run_id, item_id, item_json, source_icon, added_at) VALUES (?, ?, ?, ?, ?)");
const delPartyBagStmt = db.prepare("DELETE FROM run_party_bag WHERE id = ? AND run_id = ?");
const partyBagForRunStmt = db.prepare("SELECT * FROM run_party_bag WHERE run_id = ? ORDER BY id");

export function loadPartyBag(runId: number): PartyBagRow[] {
  return partyBagForRunStmt.all(runId) as PartyBagRow[];
}

function insertPartyBagRow(runId: number, item: ItemDefinition, sourceIcon: HexIconType | null): number {
  const info = insPartyBagStmt.run(runId, item.id, JSON.stringify(item), sourceIcon, Date.now());
  return Number(info.lastInsertRowid);
}

/** Batch-insert bag items (run-start staging of preset extras + manifests). Returns the bagIds. */
export function insertPartyBagItems(runId: number, items: readonly ItemDefinition[]): number[] {
  const ids: number[] = [];
  const tx = db.transaction(() => {
    for (const item of items) ids.push(insertPartyBagRow(runId, item, null));
  });
  tx();
  return ids;
}

/**
 * Drop commit: record each drop in the run_loot ledger (codex banking truth) AND land it in the
 * party bag (storage) in ONE transaction. Returns the new bagIds, drop-ordered.
 */
export function commitLootDrops(runId: number, drops: readonly ItemDefinition[],
    source: HexCoord, icon: HexIconType | null): number[] {
  const bagIds: number[] = [];
  const tx = db.transaction(() => {
    for (const item of drops) {
      insertRunLootStmt.run(runId, item.id, item.dimensionId, JSON.stringify(item),
        source.q, source.r, icon, Date.now());
      bagIds.push(insertPartyBagRow(runId, item, icon));
    }
  });
  tx();
  return bagIds;
}

/**
 * Equip commit (write-point discipline of commitExplore): remove the bag row AND persist the
 * equipper's loadout in ONE transaction — a crash can never equip an item without draining the
 * bag row (or vice versa). Returns false when a racing seat already took the row.
 */
export function commitBagEquip(runId: number, bagId: number, seatIndex: number,
    inv: InventoryState): boolean {
  let taken = false;
  const tx = db.transaction(() => {
    taken = delPartyBagStmt.run(bagId, runId).changes > 0;
    if (taken) saveSeatInventory(runId, seatIndex, inv); // nested tx = savepoint (bun:sqlite)
  });
  tx();
  return taken;
}

/** Deposit commit (unequip): insert the bag row AND persist the shrunken loadout in ONE tx. */
export function commitBagDeposit(runId: number, item: ItemDefinition, seatIndex: number,
    inv: InventoryState): number {
  let bagId = 0;
  const tx = db.transaction(() => {
    bagId = insertPartyBagRow(runId, item, null);
    saveSeatInventory(runId, seatIndex, inv); // nested tx = savepoint (bun:sqlite)
  });
  tx();
  return bagId;
}

// --- Codex (account-scoped, permanent; NOT touched by eraseClient) ---
export interface CodexEntryRow {
  account_id: string; item_id: string; dimension_id: number; tier: number;
  item_json: string; acquired_at: string;
}
export interface CodexFirstRow {
  item_id: string; dimension_id: number; account_id: string; recovered_at: string;
}

const insertCodexEntryStmt = db.prepare(
  `INSERT OR IGNORE INTO codex_entries (account_id, item_id, dimension_id, tier, item_json, acquired_at)
   VALUES (?, ?, ?, ?, ?, ?)`);
const insertCodexFirstStmt = db.prepare(
  `INSERT OR IGNORE INTO codex_firsts (item_id, dimension_id, account_id, recovered_at)
   VALUES (?, ?, ?, ?)`);
const codexForAccountStmt = db.prepare(
  "SELECT * FROM codex_entries WHERE account_id = ? ORDER BY acquired_at DESC, item_id");
const codexEntryStmt = db.prepare(
  "SELECT * FROM codex_entries WHERE account_id = ? AND item_id = ?");
const codexFirstStmt = db.prepare("SELECT * FROM codex_firsts WHERE item_id = ?");
const codexSnapshotStmt = db.prepare(
  "SELECT item_json FROM codex_entries WHERE item_id = ? LIMIT 1"); // identical per design

/** True iff the row was newly inserted (dedup-aware — drives the codexBanked push contents). */
export function bankCodexEntry(accountId: string, item: ItemDefinition, tier: number): boolean {
  return insertCodexEntryStmt.run(accountId, item.id, item.dimensionId, tier,
    JSON.stringify(item), new Date().toISOString()).changes > 0;
}
/** True iff this call recorded the global first (INSERT OR IGNORE first-writer-wins). */
export function recordCodexFirst(item: ItemDefinition, accountId: string): boolean {
  return insertCodexFirstStmt.run(item.id, item.dimensionId, accountId,
    new Date().toISOString()).changes > 0;
}
export function loadCodex(accountId: string): CodexEntryRow[] {
  return codexForAccountStmt.all(accountId) as CodexEntryRow[];
}
export function loadCodexEntry(accountId: string, itemId: string): CodexEntryRow | null {
  return (codexEntryStmt.get(accountId, itemId) as CodexEntryRow | null) ?? null;
}
export function loadCodexFirst(itemId: string): CodexFirstRow | null {
  return (codexFirstStmt.get(itemId) as CodexFirstRow | null) ?? null;
}

/**
 * Resolve an item id for a run's seat rows: live pool -> this run's drop snapshot -> the design
 * archive. Canonical sources in fixed order; null only for a genuinely unknown id.
 */
export function resolveItemForRun(runId: number, itemId: string): ItemDefinition | null {
  const live = getItemById(itemId);
  if (live) return live;
  const drop = lootSnapshotForRunStmt.get(runId, itemId) as { item_json: string } | null;
  if (drop) return JSON.parse(drop.item_json) as ItemDefinition;
  const design = codexSnapshotStmt.get(itemId) as { item_json: string } | null;
  if (design) return JSON.parse(design.item_json) as ItemDefinition;
  return null;
}

// --- Session-token (HMAC) helpers (R29). v1: single GAME_TOKEN_SECRET, no rotation. ---
function serverSecret(): string {
  const s = process.env.GAME_TOKEN_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GAME_TOKEN_SECRET must be set (>=32 chars) in production");
  }
  return "dev-insecure-secret-do-not-use-in-production-0123456789abcdef";
}

export function newTokenSalt(): string {
  return randomBytes(16).toString("hex");
}

export function mintSessionToken(clientId: string, salt: string): string {
  return createHmac("sha256", serverSecret()).update(`${clientId}:${salt}`).digest("hex");
}

export function verifySessionToken(token: string, clientId: string, salt: string): boolean {
  const expected = mintSessionToken(clientId, salt);
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Dimension & Enemy Template Queries ---

// Upsert (NOT INSERT OR REPLACE): a re-save must never wipe `tier` — an attuned dimension's tier
// is community-permanent multiverse state (04-portals), owned by the v8 backfill and attunement,
// while every other column is owned by the seeds/generator that call saveDimension.
const insertDimensionStmt = db.prepare(
  `INSERT INTO dimensions (id, name, structures_json, background_path, hex_decorations_path, status)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     name = excluded.name,
     structures_json = excluded.structures_json,
     background_path = excluded.background_path,
     hex_decorations_path = excluded.hex_decorations_path,
     status = excluded.status`
);
const getDimensionStmt = db.prepare("SELECT * FROM dimensions WHERE id = ?");

const insertEnemyTemplateStmt = db.prepare(
  "INSERT OR REPLACE INTO enemy_templates (id, dimension_id, template_json) VALUES (?, ?, ?)"
);
const getEnemyTemplatesByDimensionStmt = db.prepare(
  "SELECT * FROM enemy_templates WHERE dimension_id = ?"
);
const getEnemyTemplateStmt = db.prepare(
  "SELECT * FROM enemy_templates WHERE id = ? AND dimension_id = ?"
);

export function saveDimension(
  id: number,
  name: string,
  structures: readonly StructureEntry[],
  backgroundPath?: string,
  hexDecorationsPath?: string,
  status: string = 'approved',
): void {
  insertDimensionStmt.run(id, name, JSON.stringify(structures), backgroundPath ?? null, hexDecorationsPath ?? null, status);
}

/** Assigns each structure an `index` matching its position (sprite-sheet order). */
export function withStructureIndices(
  entries: readonly Omit<StructureEntry, "index">[],
): StructureEntry[] {
  return entries.map((s, index) => ({ ...s, index }));
}

export function saveEnemyTemplate(
  id: string,
  dimensionId: number,
  template: UnitTemplate
): void {
  insertEnemyTemplateStmt.run(id, dimensionId, JSON.stringify(template));
}

export function saveEnemyTemplates(
  dimensionId: number,
  templates: Record<string, UnitTemplate>
): void {
  const tx = db.transaction(() => {
    for (const [id, template] of Object.entries(templates)) {
      insertEnemyTemplateStmt.run(id, dimensionId, JSON.stringify(template));
    }
  });
  tx();
}

export function loadDimension(dimensionId: number): Dimension | null {
  const row = getDimensionStmt.get(dimensionId) as {
    id: number;
    name: string;
    structures_json: string;
    background_path: string | null;
    hex_decorations_path: string | null;
    status: string;
  } | null;
  if (!row) return null;

  const templates = getEnemyTemplatesByDimensionStmt.all(dimensionId) as {
    id: string;
    dimension_id: number;
    template_json: string;
  }[];

  const manifest = loadMapManifest(dimensionId);

  return {
    id: `dimension-${row.id}`,
    name: row.name,
    backgroundPath: row.background_path,
    hexDecorationsPath: row.hex_decorations_path,
    status: row.status,
    enemies: templates.map((t) => JSON.parse(t.template_json) as UnitTemplate),
    structures: JSON.parse(row.structures_json) as StructureEntry[],
    maps: manifest?.maps,
    masks: manifest?.masks,
  };
}

const setDimensionStatusStmt = db.prepare(
  "UPDATE dimensions SET status = ? WHERE id = ?"
);

export function setDimensionStatus(id: number, status: string): void {
  setDimensionStatusStmt.run(status, id);
}

/**
 * Stamp the canonical (pre-portal) dimensions with their fixed tiers — 04-portals §0.2 mapping.
 * The v8 migration backfills these on existing DBs, but on a FRESH DB the migration runs against
 * an empty table and the seeds insert with tier NULL, so the seed step must apply the mapping.
 * Called from initSeeds after the seedDimensionN calls. `AND tier IS NULL` mirrors the migration:
 * the backfill is the ONLY place existing rows get tiers (04-portals §1.1) — everything else earns
 * a tier via attunement, and a tier adjusted in the migration or live DB is never re-stamped here.
 */
export function applyCanonicalDimensionTiers(): void {
  db.exec("UPDATE dimensions SET tier = 0 WHERE id IN (0, 1) AND tier IS NULL");
  db.exec("UPDATE dimensions SET tier = 1 WHERE id IN (2, 501) AND tier IS NULL");
  db.exec("UPDATE dimensions SET tier = 2 WHERE id = 3 AND tier IS NULL");
}

/** Lightweight dimension identity (v8): id + name + descent tier (NULL = not yet placed). */
export interface DimensionMeta {
  id: number;
  name: string;
  tier: number | null;
}
const dimensionMetaStmt = db.prepare("SELECT id, name, tier FROM dimensions WHERE id = ?");
export function getDimensionMeta(id: number): DimensionMeta | null {
  return (dimensionMetaStmt.get(id) as DimensionMeta | null) ?? null;
}

const listDimensionsStmt = db.prepare(
  "SELECT id, name, status, tier FROM dimensions ORDER BY id"
);

export function listDimensions(): { id: number; name: string; status: string; tier: number | null }[] {
  return listDimensionsStmt.all() as { id: number; name: string; status: string; tier: number | null }[];
}

export function loadEnemyTemplateRegistry(
  dimensionId: number
): Record<string, UnitTemplate> {
  const rows = getEnemyTemplatesByDimensionStmt.all(dimensionId) as {
    id: string;
    dimension_id: number;
    template_json: string;
  }[];
  const registry: Record<string, UnitTemplate> = {};
  for (const row of rows) {
    registry[row.id] = JSON.parse(row.template_json) as UnitTemplate;
  }
  return registry;
}

export function getEnemyTemplate(
  id: string,
  dimensionId: number
): UnitTemplate | null {
  const row = getEnemyTemplateStmt.get(id, dimensionId) as {
    template_json: string;
  } | null;
  return row ? (JSON.parse(row.template_json) as UnitTemplate) : null;
}

// --- Item Queries ---

const insertItemStmt = db.prepare(
  "INSERT OR REPLACE INTO items (id, dimension_id, item_json) VALUES (?, ?, ?)"
);
const getItemsByDimensionStmt = db.prepare(
  "SELECT * FROM items WHERE dimension_id = ?"
);
const itemByIdStmt = db.prepare("SELECT item_json FROM items WHERE id = ?");

/** Resolve one item by its globally-unique id (saveItems enforces cross-dimension uniqueness). */
export function getItemById(id: string): ItemDefinition | null {
  const row = itemByIdStmt.get(id) as { item_json: string } | null;
  return row ? (JSON.parse(row.item_json) as ItemDefinition) : null;
}

export function saveItems(
  dimensionId: number,
  items: Record<string, ItemDefinition>
): void {
  const checkOwnerStmt = db.prepare(
    "SELECT dimension_id FROM items WHERE id = ?"
  );
  for (const id of Object.keys(items)) {
    const existing = checkOwnerStmt.get(id) as { dimension_id: number } | undefined;
    if (existing && existing.dimension_id !== dimensionId) {
      throw new Error(
        `Item ID collision: "${id}" is already owned by dimension ${existing.dimension_id}, ` +
        `but dimension ${dimensionId} is trying to claim it. ` +
        `Prefix item IDs with a dimension-specific tag (e.g. "d${dimensionId}-${id}").`
      );
    }
  }
  const tx = db.transaction(() => {
    for (const [id, item] of Object.entries(items)) {
      insertItemStmt.run(id, dimensionId, JSON.stringify(item));
    }
  });
  tx();
}

export function loadItems(
  dimensionId: number
): Record<string, ItemDefinition> {
  const rows = getItemsByDimensionStmt.all(dimensionId) as {
    id: string;
    dimension_id: number;
    item_json: string;
  }[];
  const items: Record<string, ItemDefinition> = {};
  for (const row of rows) {
    items[row.id] = JSON.parse(row.item_json) as ItemDefinition;
  }
  return items;
}
