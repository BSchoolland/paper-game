#!/usr/bin/env bun
// Validate a Record<id, EnemyTemplate> against the canonical schema and write to the DB.
// This is the CLI the Opus enemy agent calls in place of the in-process upsert tool.
import { saveEnemyTemplates } from "../../server/src/db.js";
import { enemyTemplate } from "./schemas.js";
import { withEnemySprites } from "./enemy-sprites.js";

const [dimIdArg, jsonPath] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !jsonPath) throw new Error("usage: ingest-enemies.ts <dimId> <jsonPath>");

const raw = JSON.parse(await Bun.file(jsonPath).text());
const entries = Object.entries(raw);
if (entries.length === 0) throw new Error("no enemies in file");

const validated: Record<string, unknown> = {};
for (const [id, tmpl] of entries) {
  const parsed = enemyTemplate.safeParse(tmpl);
  if (!parsed.success) throw new Error(`enemy "${id}" invalid:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
  if (parsed.data.abilities[0]?.kind !== "move") throw new Error(`enemy "${id}": first ability must be a move`);
  validated[id] = withEnemySprites(dimId, id, parsed.data);
}

saveEnemyTemplates(dimId, validated as never);
console.log(JSON.stringify({ ok: true, dimId, count: entries.length, ids: Object.keys(validated) }));
