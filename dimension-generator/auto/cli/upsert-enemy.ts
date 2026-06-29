// Usage: bun upsert-enemy.ts <dimId> <enemyId>
// Reads enemy template JSON from stdin, validates, saves to DB, prints saved id as JSON.
// Respects GAME_DB_PATH env var.

import { enemyTemplate } from "../schemas.js";
import { saveEnemyTemplate } from "../../../server/src/db.js";

const [dimIdArg, enemyId] = process.argv.slice(2);

if (!dimIdArg || !enemyId) {
  console.error("Usage: bun upsert-enemy.ts <dimId> <enemyId>");
  process.exit(1);
}

const dimId = parseInt(dimIdArg, 10);
if (isNaN(dimId)) {
  console.error(`dimId must be an integer, got: ${dimIdArg}`);
  process.exit(1);
}

const stdin = await new Response(Bun.stdin.stream()).text();
const raw = JSON.parse(stdin);
const result = enemyTemplate.safeParse(raw);

if (!result.success) {
  throw new Error(`Invalid enemy template:\n${JSON.stringify(result.error.issues, null, 2)}`);
}

saveEnemyTemplate(enemyId, dimId, result.data as any);

console.log(JSON.stringify({ saved: enemyId }));
