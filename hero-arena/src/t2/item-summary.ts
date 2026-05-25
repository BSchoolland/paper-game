#!/usr/bin/env bun
/**
 * Summarize an item-test report as a grid: items × scenarios.
 *   bun hero-arena/src/t2/item-summary.ts item-report-dim-0.json
 */
import type { GameEvent } from "../../../shared/src/index.js";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const reportPath = process.argv[2];
if (!reportPath) { console.error("usage: bun item-summary.ts <item-report.json>"); process.exit(2); }

const report = JSON.parse(await Bun.file(reportPath).text());
const items = report.items as Record<string, { type: string; rarity: string; slotCost: Record<string, number> }>;
const results = report.results as Array<{ itemId: string; scenario: string; enemyLabel: string; seed: number; result: { winner: string | null; turns: number; redHpPct: number } }>;
const logDir = join(dirname(reportPath), `item-logs-dim-${report.dimensionId}`);

// Get fighter ability usage for the party scenarios from the event logs
async function getFighterStats(itemId: string, enemyLabel: string): Promise<{ dmgDealt: number; itemAbilityUses: number; punchUses: number } | null> {
  try {
    const files = readdirSync(logDir).filter(f => f.includes(`party-${itemId}-${enemyLabel}-`));
    if (files.length === 0) return null;
    let dmgDealt = 0, itemAbilityUses = 0, punchUses = 0;
    const itemAbilityIds = new Set<string>();
    // First pass: detect which ability IDs come from the item (not punch/move)
    for (const file of files) {
      const events: GameEvent[] = JSON.parse(await Bun.file(join(logDir, file)).text());
      for (const e of events) {
        if (e.type === "attack" && e.attackerId === "R-fighter") {
          if (e.ability.id === "punch") punchUses++;
          else if (e.ability.id !== "move") itemAbilityIds.add(e.ability.id);
          for (const hit of e.hits) dmgDealt += hit.damage;
        }
      }
    }
    // Second pass: count item ability uses
    for (const file of files) {
      const events: GameEvent[] = JSON.parse(await Bun.file(join(logDir, file)).text());
      for (const e of events) {
        if (e.type === "attack" && e.attackerId === "R-fighter") {
          if (itemAbilityIds.has(e.ability.id)) itemAbilityUses++;
        }
        if (e.type === "barrier" && e.entityId === "R-fighter" && itemAbilityIds.has(e.ability.id)) {
          itemAbilityUses++;
        }
      }
    }
    return { dmgDealt, itemAbilityUses, punchUses };
  } catch { return null; }
}

// Group results: { [itemId]: { [scenario+enemy]: { wins, totalHp, totalTurns, n } } }
const grid: Record<string, Record<string, { wins: number; totalHp: number; totalTurns: number; n: number }>> = {};
const scenarioKeys = new Set<string>();

for (const r of results) {
  const itemId = r.itemId;
  const sk = `${r.scenario}/${r.enemyLabel}`;
  scenarioKeys.add(sk);
  if (!grid[itemId]) grid[itemId] = {};
  if (!grid[itemId][sk]) grid[itemId][sk] = { wins: 0, totalHp: 0, totalTurns: 0, n: 0 };
  const g = grid[itemId][sk]!;
  if (r.result.winner === "red") g.wins++;
  g.totalHp += r.result.redHpPct;
  g.totalTurns += r.result.turns;
  g.n++;
}

const scenarios = [...scenarioKeys].sort();
const itemIds = Object.keys(grid);

// Print win rate grid
console.log(`\n=== WIN RATE / AVG HP% ===\n`);
const header = ["item".padEnd(22), ...scenarios.map(s => s.replace("solo/", "S:").replace("party/", "P:").padStart(16))];
console.log(header.join(" | "));
console.log(header.map(h => "-".repeat(h.length)).join("-|-"));

for (const itemId of itemIds) {
  const meta = items[itemId];
  const label = meta ? `${itemId} (${meta.rarity[0]}${meta.type[0]})` : itemId;
  const row = [label.padEnd(22)];
  for (const sk of scenarios) {
    const g = grid[itemId]![sk];
    if (!g) { row.push("—".padStart(16)); continue; }
    const wr = `${g.wins}/${g.n}`;
    const hp = `${Math.round(g.totalHp / g.n)}%`;
    row.push(`${wr} ${hp}`.padStart(16));
  }
  console.log(row.join(" | "));
}

// Fighter party drill — show damage dealt and ability uptake
console.log(`\n=== FIGHTER (party) — dmg dealt & item ability usage ===`);
console.log(`Reveals whether Sovereign actually picks the item's abilities or falls back to punch.\n`);
const partyScenarios = scenarios.filter(s => s.startsWith("party/"));
console.log("item                   |" + partyScenarios.map(s => ` ${s.replace("party/", "").padEnd(22)}`).join(" |"));
const colWidth = "dmg=NNNN item=NN punch=NN".length;
console.log("                       |" + partyScenarios.map(() => ` ${"dmg=NNNN item=NN punch=NN".padEnd(colWidth)}`).join(" |"));
console.log("-".repeat(22) + "+" + partyScenarios.map(() => "-".repeat(colWidth + 2)).join("+"));

for (const itemId of itemIds) {
  const row = [itemId.padEnd(22)];
  for (const sk of partyScenarios) {
    const enemyLabel = sk.replace("party/", "");
    const stats = await getFighterStats(itemId, enemyLabel);
    if (!stats) { row.push(` ${"—".padEnd(colWidth)}`); continue; }
    const cell = `dmg=${String(stats.dmgDealt).padStart(4)} item=${String(stats.itemAbilityUses).padStart(2)} punch=${String(stats.punchUses).padStart(2)}`;
    row.push(` ${cell.padEnd(colWidth)}`);
  }
  console.log(row.join(" |"));
}
