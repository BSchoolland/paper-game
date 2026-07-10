// Usage: bun upsert-item.ts <dimId> <itemId> [type]
// Reads item JSON from stdin, validates against the schema for `type` (weapon | shield |
// accessory | consumable; default weapon), saves to DB, prints saved id as JSON.
// itemId MUST be prefixed with d<dimId>- (e.g. d3-dune-cleaver) to satisfy saveItems'
// cross-dimension collision guard. saveItems throws if a different dimension already owns that id.
// Respects GAME_DB_PATH env var.

import { ITEM_SCHEMAS, type ItemType } from "../schemas.js";
import { saveItems } from "../../../server/src/db.js";

const [dimIdArg, itemId, typeArg] = process.argv.slice(2);

if (!dimIdArg || !itemId) {
  console.error("Usage: bun upsert-item.ts <dimId> <itemId> [weapon|shield|accessory|consumable]");
  process.exit(1);
}

const dimId = parseInt(dimIdArg, 10);
if (isNaN(dimId)) {
  throw new Error(`dimId must be an integer, got: ${dimIdArg}`);
}

const itemType = (typeArg ?? "weapon") as ItemType;
if (!(itemType in ITEM_SCHEMAS)) {
  throw new Error(`Unknown item type "${typeArg}" — expected one of: ${Object.keys(ITEM_SCHEMAS).join(", ")}`);
}

const expectedPrefix = `d${dimId}-`;
if (!itemId.startsWith(expectedPrefix)) {
  throw new Error(
    `itemId must be prefixed with "${expectedPrefix}" to prevent cross-dimension collisions. ` +
    `Got: "${itemId}". Use "${expectedPrefix}<name>" (e.g. "${expectedPrefix}my-sword").`
  );
}

const stdin = await new Response(Bun.stdin.stream()).text();
const raw = JSON.parse(stdin);
const result = ITEM_SCHEMAS[itemType].safeParse(raw);

if (!result.success) {
  throw new Error(`Invalid ${itemType} item:\n${JSON.stringify(result.error.issues, null, 2)}`);
}

// sprite = un-prefixed name (mirrors how item-agent sets sprite: weapon.id before namespacing)
const sprite = itemId.slice(expectedPrefix.length);
const itemDef = { ...result.data, id: itemId, sprite, type: itemType };

saveItems(dimId, { [itemId]: itemDef as any });

console.log(JSON.stringify({ saved: itemId, type: itemType }));
