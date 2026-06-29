#!/usr/bin/env bun
// Validate a Record<id, EnemyTemplate> against the canonical schema and write to the DB.
// This is the CLI the Opus enemy agent calls in place of the in-process upsert tool.
import { saveEnemyTemplates } from "../../server/src/db.js";
import { enemyTemplate } from "./schemas.js";

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
  // Auto-extracted enemy sprites are flat: dimension-N/<id>-<state>.png. Wire the template to them
  // (the game serves /api/sprites/<path> straight from server/sprites/ and only loads template.sprites).
  const base = `/api/sprites/enemies/dimension-${dimId}/${id}`;
  validated[id] = {
    ...parsed.data,
    sprites: { idle: `${base}-idle.png`, attack: `${base}-attack.png`, hit: `${base}-hit.png`, move: `${base}-move.png` },
  };
}

saveEnemyTemplates(dimId, validated as never);
console.log(JSON.stringify({ ok: true, dimId, count: entries.length, ids: Object.keys(validated) }));
