import { Database } from "bun:sqlite";
import type { HexCoord, HexStatus, UnitTemplate, ItemDefinition } from "shared";
import type { StructureEntry, Dimension } from "shared";

const db = new Database("hex-discovery.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS explored_hexes (
    q INTEGER NOT NULL,
    r INTEGER NOT NULL,
    PRIMARY KEY (q, r)
  )
`);
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

const insertStmt = db.prepare(
  "INSERT OR IGNORE INTO explored_hexes (q, r) VALUES (?, ?)"
);
const allStmt = db.prepare("SELECT q, r FROM explored_hexes");
const clearStmt = db.prepare("DELETE FROM explored_hexes");

export function saveExploredHex(coord: HexCoord): void {
  insertStmt.run(coord.q, coord.r);
}

export function saveExploredHexes(coords: HexCoord[]): void {
  const tx = db.transaction(() => {
    for (const c of coords) insertStmt.run(c.q, c.r);
  });
  tx();
}

export function loadExploredHexes(): Record<string, HexStatus> {
  const rows = allStmt.all() as { q: number; r: number }[];
  const hexes: Record<string, HexStatus> = {};
  for (const row of rows) {
    hexes[`${row.q},${row.r}`] = "explored";
  }
  return hexes;
}

export function clearExploredHexes(): void {
  clearStmt.run();
}

const insertRunStmt = db.prepare("INSERT INTO runs DEFAULT VALUES");
const lastRunStmt = db.prepare("SELECT MAX(id) as id FROM runs");

export function startNewRun(): number {
  insertRunStmt.run();
  return (lastRunStmt.get() as { id: number }).id;
}


export function seedDiscovery(radius: number): void {
  const coords: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      coords.push({ q, r });
    }
  }
  saveExploredHexes(coords);
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

  return {
    id: `dimension-${row.id}`,
    name: row.name,
    backgroundPath: row.background_path,
    hexDecorationsPath: row.hex_decorations_path,
    enemies: templates.map((t) => JSON.parse(t.template_json) as UnitTemplate),
    structures: JSON.parse(row.structures_json) as StructureEntry[],
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

export function getDimensionCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM dimensions").get() as { count: number };
  return row.count;
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
