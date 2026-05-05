import { Database } from "bun:sqlite";
import type { HexCoord, HexStatus } from "shared";

const db = new Database("hex-discovery.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS explored_hexes (
    q INTEGER NOT NULL,
    r INTEGER NOT NULL,
    PRIMARY KEY (q, r)
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
