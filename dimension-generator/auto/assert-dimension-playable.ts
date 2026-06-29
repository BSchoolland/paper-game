#!/usr/bin/env bun
// Asserts a generated dimension is actually PLAYABLE, not just balance-tested: every enemy template
// has a sprites field whose files exist on disk, every item sprite exists, and background/structures
// are registered. Exits non-zero with a loud report otherwise. The pipeline's "done" must mean
// "loadable in-game" — this is the check whose absence let dim 700 ship with no enemy images.
import { loadDimension, loadEnemyTemplateRegistry, loadItems } from "../../server/src/db.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "..", "..");
const dimId = Number(process.argv[2]);
if (!Number.isFinite(dimId)) throw new Error("usage: assert-dimension-playable.ts <dimId>");

const problems: string[] = [];

const dim = loadDimension(dimId);
if (!dim) throw new Error(`dimension ${dimId} not found in DB`);
if (!dim.backgroundPath) problems.push("no backgroundPath registered");
if (!dim.structures || dim.structures.length === 0) problems.push("no structures registered");

const enemies = loadEnemyTemplateRegistry(dimId);
const enemyIds = Object.keys(enemies);
if (enemyIds.length === 0) problems.push("no enemy templates");
for (const id of enemyIds) {
  const sprites = (enemies[id] as { sprites?: Record<string, string> }).sprites;
  if (!sprites) { problems.push(`enemy ${id}: no sprites field`); continue; }
  for (const [state, url] of Object.entries(sprites)) {
    const rel = String(url).replace(/^\/api\/sprites\//, "");
    if (!existsSync(join(ROOT, "server/sprites", rel))) problems.push(`enemy ${id}: missing ${state} sprite (${rel})`);
  }
}

const items = loadItems(dimId);
const itemIds = Object.keys(items);
if (itemIds.length === 0) problems.push("no item templates");
for (const id of itemIds) {
  const it = items[id] as { sprite: string; dimensionId: number };
  const prefix = it.dimensionId === 0 ? "" : `dimension-${it.dimensionId}/`;
  const stem = join(ROOT, "client/public/sprites/items", `${prefix}${it.sprite}`);
  if (!existsSync(`${stem}.png`) && !existsSync(`${stem}.webp`)) problems.push(`item ${id}: missing sprite (${it.sprite})`);
}

const report = {
  dimId,
  name: dim.name,
  playable: problems.length === 0,
  enemies: enemyIds.length,
  items: itemIds.length,
  structures: dim.structures?.length ?? 0,
  problems,
};
console.log(JSON.stringify(report, null, 2));
if (problems.length > 0) process.exit(1);
