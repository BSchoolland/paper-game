#!/usr/bin/env bun
// Create the dimension shell row (status=in_review) so enemy/item FK writes resolve.
// Preserves any existing structures/paths so re-running before register-structures is safe.
import { saveDimension, loadDimension } from "../../server/src/db.js";

const [dimIdArg, specPath] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !specPath) throw new Error("usage: init-dimension.ts <dimId> <specPath>");

const spec = JSON.parse(await Bun.file(specPath).text());
if (!spec.name) throw new Error(`spec at ${specPath} has no name`);

const existing = loadDimension(dimId);
saveDimension(
  dimId,
  spec.name,
  existing?.structures ?? [],
  existing?.backgroundPath ?? undefined,
  existing?.hexDecorationsPath ?? undefined,
  "in_review",
);
console.log(JSON.stringify({ ok: true, dimId, name: spec.name, status: "in_review", preservedStructures: existing?.structures?.length ?? 0 }));
