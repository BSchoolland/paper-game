#!/usr/bin/env bun
// Validate weapon items and write to the DB, applying the d{dimId}- id prefixing the
// in-process item agent used (prevents cross-dimension id collisions). CLI for the Opus item agent.
import { saveItems } from "../../server/src/db.js";
import { weaponItemSchema } from "./schemas.js";

const [dimIdArg, jsonPath] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !jsonPath) throw new Error("usage: ingest-items.ts <dimId> <jsonPath>");

const raw = JSON.parse(await Bun.file(jsonPath).text());
const arr = Array.isArray(raw) ? raw : Object.values(raw);
if (arr.length === 0) throw new Error("no items in file");

const prefix = `d${dimId}-`;
const prefixId = (id: string) => (id.startsWith(prefix) ? id : `${prefix}${id}`);

const out: Record<string, unknown> = {};
for (const item of arr) {
  const parsed = weaponItemSchema.safeParse({ dimensionId: dimId, ...item });
  if (!parsed.success) throw new Error(`item "${(item as { id?: string })?.id}" invalid:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
  const w = parsed.data;
  const namespacedId = prefixId(w.id);
  out[namespacedId] = {
    ...w,
    id: namespacedId,
    sprite: w.id, // original id = extracted sprite filename
    type: "weapon",
    dimensionId: dimId,
    abilities: w.abilities.map((a) => ({ ...a, id: prefixId(a.id) })),
  };
}

saveItems(dimId, out as never);
console.log(JSON.stringify({ ok: true, dimId, count: Object.keys(out).length, ids: Object.keys(out) }));
