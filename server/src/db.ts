import { Database } from "bun:sqlite";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HexCoord, HexStatus, UnitTemplate, ItemDefinition, InventoryState, AttachmentData } from "shared";
import type { StructureEntry, Dimension, MapManifest } from "shared";

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

const DB_PATH = process.env.GAME_DB_PATH ?? "hex-discovery.sqlite";
const db = new Database(DB_PATH, { create: true });
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

// --- Multiplayer co-op durable schema migration (PERSISTENCE.md; supersedes R13) ---
// Bumps user_version once: recreates explored_hexes run-scoped (+cleared), extends runs,
// and adds run_seats / run_seat_items / run_seat_attachments / explored_hex_icons.
// The legacy global explored_hexes is dropped once (documented one-time wipe). FKs are
// declarative only (foreign_keys pragma is off, matching the rest of this schema).
const SCHEMA_VERSION = 2;
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < SCHEMA_VERSION) {
    const migrate = db.transaction(() => {
      db.exec("DROP TABLE IF EXISTS explored_hexes");
      db.exec(`CREATE TABLE explored_hexes (
        run_id  INTEGER NOT NULL,
        q       INTEGER NOT NULL,
        r       INTEGER NOT NULL,
        cleared INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, q, r),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS explored_hex_icons (
        run_id INTEGER NOT NULL,
        q      INTEGER NOT NULL,
        r      INTEGER NOT NULL,
        icon   TEXT NOT NULL,
        PRIMARY KEY (run_id, q, r),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
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
        try { db.exec(sql); } catch { /* column already exists */ }
      }
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

// --- Exploration (run-scoped). `cleared` = combat-resolved (durable visitedThisRun). ---
const insertHexStmt = db.prepare(
  `INSERT INTO explored_hexes (run_id, q, r, cleared) VALUES (?, ?, ?, ?)
   ON CONFLICT(run_id, q, r) DO UPDATE SET cleared = MAX(cleared, excluded.cleared)`
);
const hexesForRunStmt = db.prepare("SELECT q, r, cleared FROM explored_hexes WHERE run_id = ?");
const clearHexesStmt = db.prepare("DELETE FROM explored_hexes WHERE run_id = ?");
const insertIconStmt = db.prepare(
  "INSERT OR REPLACE INTO explored_hex_icons (run_id, q, r, icon) VALUES (?, ?, ?, ?)"
);
const iconsForRunStmt = db.prepare("SELECT q, r, icon FROM explored_hex_icons WHERE run_id = ?");

export function saveExploredHex(runId: number, coord: HexCoord, cleared = false): void {
  insertHexStmt.run(runId, coord.q, coord.r, cleared ? 1 : 0);
}

/** Every explored hex for the run, as the client-facing "explored" status map. */
export function loadExploredHexes(runId: number): Record<string, HexStatus> {
  const rows = hexesForRunStmt.all(runId) as { q: number; r: number; cleared: number }[];
  const hexes: Record<string, HexStatus> = {};
  for (const row of rows) hexes[`${row.q},${row.r}`] = "explored";
  return hexes;
}

/** The subset of explored hexes that have been combat-cleared (durable `visitedThisRun`). */
export function loadClearedHexes(runId: number): Set<string> {
  const rows = hexesForRunStmt.all(runId) as { q: number; r: number; cleared: number }[];
  const cleared = new Set<string>();
  for (const row of rows) if (row.cleared) cleared.add(`${row.q},${row.r}`);
  return cleared;
}

export function clearExploredHexes(runId: number): void {
  clearHexesStmt.run(runId);
}

export function saveExploredHexIcon(runId: number, coord: HexCoord, icon: string): void {
  insertIconStmt.run(runId, coord.q, coord.r, icon);
}

export function loadExploredHexIcons(runId: number): Record<string, string> {
  const rows = iconsForRunStmt.all(runId) as { q: number; r: number; icon: string }[];
  const icons: Record<string, string> = {};
  for (const row of rows) icons[`${row.q},${row.r}`] = row.icon;
  return icons;
}

export function seedDiscovery(runId: number, radius: number): void {
  const tx = db.transaction(() => {
    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) insertHexStmt.run(runId, q, r, 0);
    }
  });
  tx();
}

// --- Runs ---
export interface RunRow {
  id: number;
  dimension_id: number;
  capacity: number;
  host_client_id: string | null;
  active: number;
  party_q: number;
  party_r: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  outcome: string | null;
}

const insertRunStmt = db.prepare(
  `INSERT INTO runs (dimension_id, capacity, host_client_id, active, party_q, party_r, created_at, updated_at)
   VALUES (?, ?, ?, 1, 0, 0, ?, ?)`
);
const runByIdStmt = db.prepare("SELECT * FROM runs WHERE id = ?");
const updatePartyPosStmt = db.prepare("UPDATE runs SET party_q = ?, party_r = ?, updated_at = ? WHERE id = ?");
const setHostStmt = db.prepare("UPDATE runs SET host_client_id = ?, updated_at = ? WHERE id = ?");
const markRunInactiveStmt = db.prepare("UPDATE runs SET active = 0, completed_at = ?, outcome = ? WHERE id = ?");
const stampSeatsLeftStmt = db.prepare("UPDATE run_seats SET left_at = ? WHERE run_id = ? AND left_at IS NULL");
const staleRunsStmt = db.prepare("SELECT id FROM runs WHERE active = 1 AND updated_at < ?");

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

/** Mark a run finished and stamp every still-present seat as left (R32/R13.5), atomically. */
export function markRunInactive(runId: number, outcome: "victory" | "defeat" | "abandoned"): void {
  const now = Date.now();
  const tx = db.transaction(() => {
    markRunInactiveStmt.run(now, outcome, runId);
    stampSeatsLeftStmt.run(now, runId);
  });
  tx();
}

/** Housekeeping (R33): abandon runs untouched for longer than `olderThanMs`. */
export function deactivateStaleRuns(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  const rows = staleRunsStmt.all(cutoff) as { id: number }[];
  const tx = db.transaction(() => {
    const now = Date.now();
    for (const row of rows) {
      markRunInactiveStmt.run(now, "abandoned", row.id);
      stampSeatsLeftStmt.run(now, row.id);
    }
  });
  tx();
  return rows.length;
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
  joined_at: number;
  left_at: number | null;
}

const upsertSeatStmt = db.prepare(
  `INSERT INTO run_seats (run_id, seat_index, client_id, display_name, controller_kind, token_salt, joined_at, left_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
   ON CONFLICT(run_id, seat_index) DO UPDATE SET
     client_id = excluded.client_id, display_name = excluded.display_name,
     controller_kind = excluded.controller_kind, token_salt = excluded.token_salt, left_at = NULL`
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
  seat: { clientId: string | null; displayName: string; controllerKind: ControllerKind; tokenSalt: string | null },
): void {
  upsertSeatStmt.run(runId, seatIndex, seat.clientId, seat.displayName, seat.controllerKind, seat.tokenSalt, Date.now());
}

export function leaveRunSeat(runId: number, seatIndex: number): void {
  leaveSeatStmt.run(Date.now(), runId, seatIndex);
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
  "INSERT OR REPLACE INTO dimensions (id, name, structures_json, background_path, hex_decorations_path) VALUES (?, ?, ?, ?, ?)"
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
): void {
  insertDimensionStmt.run(id, name, JSON.stringify(structures), backgroundPath ?? null, hexDecorationsPath ?? null);
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
    enemies: templates.map((t) => JSON.parse(t.template_json) as UnitTemplate),
    structures: JSON.parse(row.structures_json) as StructureEntry[],
    maps: manifest?.maps,
    masks: manifest?.masks,
  };
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
