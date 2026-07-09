// Usage: GAME_DB_PATH=... bun roster-critic.ts <dimId>
//
// Mechanical distinctiveness gate for a dimension's item roster. Wow is subjective; "this item
// is verb-identical to twelve existing items" is not. Each item reduces to a signature — the
// sorted set of mechanical verbs across its abilities and passives — and the roster is audited:
//
//   FAIL  plain damage-sticks (attack shapes with no other verb) exceed 40% of the roster
//   FAIL  two items in this roster share a signature
//   FAIL  an epic/legendary item carries no rule verb (rarity buys rules)
//   WARN  an item's signature already exists verbatim in another dimension
//
// Exits non-zero on any FAIL so the item balance loop must react.

import { loadItems, listDimensions } from "../../../server/src/db.js";
import type { AbilityDefinition, ItemDefinition } from "../../../shared/src/index.js";

const dimId = Number(process.argv[2]);
if (isNaN(dimId)) {
  console.error("usage: bun roster-critic.ts <dimId>");
  process.exit(2);
}

const PLAIN_KNOCKBACK_THRESHOLD = 30; // below this, knockback is texture, not a verb

function abilityVerbs(a: AbilityDefinition): string[] {
  const verbs: string[] = [];
  switch (a.kind) {
    case "attack": {
      verbs.push(`attack:${a.shape.kind}`);
      if (a.knockback >= PLAIN_KNOCKBACK_THRESHOLD) verbs.push("knockback");
      if (a.wallSlamDamage) verbs.push("wallslam");
      if (a.recoil) verbs.push("recoil");
      if (a.lungeThrough) verbs.push("lunge");
      if (a.onKill) verbs.push("onkill");
      for (const e of a.onHit ?? []) {
        verbs.push(e.type === "applyStatus" ? `status:${e.status}` : e.type);
      }
      for (const r of a.riders ?? []) verbs.push(`rider:${r.when}`);
      break;
    }
    case "move":
      verbs.push(a.mode === "blink" ? "blink" : "dash");
      break;
    case "barrier":
      verbs.push("barrier");
      break;
    case "zone":
      verbs.push(`zone:${a.zone.effect}`);
      break;
    case "summon":
      verbs.push("summon");
      break;
    case "convert":
      verbs.push("convert");
      break;
    case "restore":
      verbs.push("restore");
      break;
  }
  if (a.uses !== undefined) verbs.push("charged");
  return verbs;
}

function itemSignature(item: ItemDefinition): string {
  const verbs = new Set<string>();
  for (const a of item.abilities ?? []) for (const v of abilityVerbs(a)) verbs.add(v);
  for (const p of item.passives ?? []) {
    verbs.add(p.type === "aura" ? `passive:aura:${p.aura.effect}:${p.aura.affects}` : `passive:${p.type}`);
  }
  return [...verbs].sort().join("|");
}

/** No verb beyond bare attack shapes → a plain damage stick. */
function isPlain(item: ItemDefinition): boolean {
  if (item.type !== "weapon") return false;
  const sig = itemSignature(item);
  return sig.split("|").every(v => v.startsWith("attack:"));
}

const RULE_VERBS = /rider:|onkill|blink|swap|summon|convert|restore|charged|passive:|zone:|wallslam/;

// --- Load corpus ---
const roster = Object.values(loadItems(dimId));
if (roster.length === 0) {
  console.error(`roster-critic: dimension ${dimId} has no items`);
  process.exit(2);
}
const corpus = new Map<string, string[]>(); // signature -> item ids in OTHER dimensions
for (const d of listDimensions()) {
  if (d.id === dimId) continue;
  for (const item of Object.values(loadItems(d.id))) {
    const sig = itemSignature(item);
    const list = corpus.get(sig) ?? [];
    list.push(item.id);
    corpus.set(sig, list);
  }
}

// --- Audit ---
const fails: string[] = [];
const warns: string[] = [];

const plainItems = roster.filter(isPlain);
const plainFrac = plainItems.length / roster.length;
console.log(`Roster: ${roster.length} items, ${plainItems.length} plain damage-sticks (${Math.round(plainFrac * 100)}%)`);
if (plainFrac > 0.4) {
  fails.push(`plain damage-sticks are ${Math.round(plainFrac * 100)}% of the roster (max 40%): ${plainItems.map(i => i.id).join(", ")}`);
}

const seen = new Map<string, string>();
for (const item of roster) {
  const sig = itemSignature(item);
  const prior = seen.get(sig);
  if (prior) fails.push(`verb-identical within roster: ${item.id} duplicates ${prior} [${sig}]`);
  else seen.set(sig, item.id);

  const elsewhere = corpus.get(sig);
  if (elsewhere) warns.push(`${item.id} is verb-identical to ${elsewhere.length} existing item(s) elsewhere (e.g. ${elsewhere[0]}) [${sig}]`);

  if ((item.rarity === "epic" || item.rarity === "legendary") && !RULE_VERBS.test(sig)) {
    fails.push(`${item.rarity} item ${item.id} carries no rule verb — rarity buys rules [${sig}]`);
  }
}

console.log(`\nSignatures:`);
for (const item of roster) console.log(`  ${item.id.padEnd(34)} ${item.rarity.padEnd(10)} ${itemSignature(item)}`);

if (warns.length) {
  console.log(`\nWARN (${warns.length}):`);
  for (const w of warns) console.log(`  ${w}`);
}
if (fails.length) {
  console.log(`\nFAIL (${fails.length}):`);
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`\nOK: roster passes the distinctiveness gate (${warns.length} warnings)`);
