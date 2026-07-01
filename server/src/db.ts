import { Database } from "bun:sqlite";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HexCoord, HexStatus, UnitTemplate, ItemDefinition, InventoryState, AttachmentData } from "shared";
import type { StructureEntry, Dimension, MapManifest, RoomCode, WireLogRecord } from "shared";

const PUBLIC_DIR = resolve(import.meta.dir, "../../client/public");

function loadMapManifest(dimId: number): MapManifest | null {
  const p = resolve(PUBLIC_DIR, `sprites/maps/dimension-${dimId}/manifest.json`);
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

// --- Cleared-this-run: PER-RUN combat progress (durable visitedThisRun). ---
const insertClearedStmt = db.prepare(
  "INSERT OR IGNORE INTO run_cleared_hexes (run_id, q, r) VALUES (?, ?, ?)"
);
const clearedForRunStmt = db.prepare("SELECT q, r FROM run_cleared_hexes WHERE run_id = ?");
const delClearedForRunStmt = db.prepare("DELETE FROM run_cleared_hexes WHERE run_id = ?");

export function markRunCleared(runId: number, coord: HexCoord): void {
  insertClearedStmt.run(runId, coord.q, coord.r);
}

export function loadRunCleared(runId: number): Set<string> {
  const rows = clearedForRunStmt.all(runId) as { q: number; r: number }[];
  const cleared = new Set<string>();
  for (const row of rows) cleared.add(`${row.q},${row.r}`);
  return cleared;
}

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
    insertClearedStmt.run(runId, coord.q, coord.r);
    updatePartyPosStmt.run(coord.q, coord.r, Date.now(), runId);
  });
  tx();
  return firstEver;
}

// --- Runs ---
/** The run's lifecycle phase — the single durable source of truth (same value set as the wire RoomPhase). */
export type RunPhase = "lobby" | "overworld" | "combat" | "gameover";
export type RunOutcome = "victory" | "defeat" | "abandoned";

export interface RunRow {
  id: number;
  dimension_id: number;
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
  started_at: number | null; // dead column (subsumed by `phase`); kept because SQLite can't cheaply DROP.
}

const insertRunStmt = db.prepare(
  `INSERT INTO runs (dimension_id, capacity, host_client_id, active, party_q, party_r, created_at, updated_at)
   VALUES (?, ?, ?, 1, 0, 0, ?, ?)`
);
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
  const info = insertRunStmt.run(dimensionId, capacity, hostClientId, now, now);
  return Number(info.lastInsertRowid);
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
    if (changed) stampSeatsLeftStmt.run(now, runId);
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
    inv.bag.forEach((item, i) => {
      if (item) insSeatItemStmt.run(runId, seatIndex, "bag", i, item.id);
    });
    inv.equipped.forEach((item, i) => insSeatItemStmt.run(runId, seatIndex, "equipped", i, item.id));
    for (const [itemId, att] of Object.entries(inv.attachments)) {
      insSeatAttachStmt.run(runId, seatIndex, itemId, JSON.stringify(att));
    }
  });
  tx();
}

export function loadSeatInventory(runId: number, seatIndex: number, dimensionId: number): InventoryState {
  const merged = { ...loadItems(0), ...loadItems(1), ...loadItems(2), ...loadItems(3), ...loadItems(dimensionId) };
  const itemRows = seatItemsStmt.all(runId, seatIndex) as { location: string; slot_order: number; item_id: string }[];
  const bag: (ItemDefinition | null)[] = new Array(16).fill(null);
  const equippedPairs: { order: number; item: ItemDefinition }[] = [];
  for (const row of itemRows) {
    const item = merged[row.item_id];
    if (!item) {
      console.warn(`[db] seat inventory: unknown item_id "${row.item_id}" (run ${runId} seat ${seatIndex}) — skipped`);
      continue;
    }
    if (row.location === "bag") {
      if (row.slot_order >= 0 && row.slot_order < 16) bag[row.slot_order] = item;
    } else {
      equippedPairs.push({ order: row.slot_order, item });
    }
  }
  equippedPairs.sort((a, b) => a.order - b.order);
  const equipped = equippedPairs.map((p) => p.item);
  const attachments: Record<string, AttachmentData> = {};
  const attRows = seatAttachStmt.all(runId, seatIndex) as { item_id: string; attachment_json: string }[];
  for (const row of attRows) {
    const owned = equipped.some((e) => e.id === row.item_id) || bag.some((b) => b?.id === row.item_id);
    if (owned) attachments[row.item_id] = JSON.parse(row.attachment_json) as AttachmentData;
  }
  return { bag, equipped, attachments };
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

const insertDimensionStmt = db.prepare(
  "INSERT OR REPLACE INTO dimensions (id, name, structures_json, background_path, hex_decorations_path, status) VALUES (?, ?, ?, ?, ?, ?)"
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

const listDimensionsStmt = db.prepare(
  "SELECT id, name, status FROM dimensions ORDER BY id"
);

export function listDimensions(): { id: number; name: string; status: string }[] {
  return listDimensionsStmt.all() as { id: number; name: string; status: string }[];
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
