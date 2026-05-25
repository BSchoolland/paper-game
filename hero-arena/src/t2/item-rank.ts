#!/usr/bin/env bun
/**
 * Rank items from an item-test report and flag balance outliers.
 *   bun hero-arena/src/t2/item-rank.ts item-report-dim-0.json
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { GameEvent } from "../../../shared/src/index.js";

const reportPath = process.argv[2];
if (!reportPath) { console.error("usage: bun item-rank.ts <item-report.json>"); process.exit(2); }

const report = JSON.parse(await Bun.file(reportPath).text());
const items = report.items as Record<string, { type: string; rarity: string; slotCost: Record<string, number> }>;
const results = report.results as Array<{ itemId: string; scenario: string; enemyLabel: string; seed: number; result: { winner: string | null; turns: number; redHpPct: number } }>;
const logDir = join(dirname(reportPath), `item-logs-dim-${report.dimensionId}`);

const RARITY_ORDER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

// --- Aggregate per item ---
interface ItemAgg {
  itemId: string;
  type: string;
  rarity: string;
  // overall metrics across all scenarios
  winRate: number;     // fraction of games won
  avgHp: number;       // avg hero HP% at end of game
  totalGames: number;
  // per-scenario summaries
  scenarios: Record<string, { wins: number; n: number; avgHp: number }>;
  // signals from event logs
  punchFallbacks: number;  // # of party games where fighter used punch
}

async function buildAgg(): Promise<ItemAgg[]> {
  const byItem: Record<string, ItemAgg> = {};

  for (const r of results) {
    const itemId = r.itemId;
    if (!byItem[itemId]) {
      const meta = items[itemId] ?? { type: "?", rarity: "?", slotCost: {} };
      byItem[itemId] = { itemId, type: meta.type, rarity: meta.rarity, winRate: 0, avgHp: 0, totalGames: 0, scenarios: {}, punchFallbacks: 0 };
    }
    const a = byItem[itemId]!;
    a.totalGames++;
    if (r.result.winner === "red") a.winRate++;
    a.avgHp += r.result.redHpPct;

    const sk = `${r.scenario}/${r.enemyLabel}`;
    if (!a.scenarios[sk]) a.scenarios[sk] = { wins: 0, n: 0, avgHp: 0 };
    const s = a.scenarios[sk]!;
    s.n++;
    if (r.result.winner === "red") s.wins++;
    s.avgHp += r.result.redHpPct;
  }

  for (const a of Object.values(byItem)) {
    a.winRate = a.winRate / a.totalGames;
    a.avgHp = a.avgHp / a.totalGames;
    for (const s of Object.values(a.scenarios)) s.avgHp = s.avgHp / s.n;
  }

  // Count punch fallbacks from party-scenario event logs
  const files = readdirSync(logDir).filter(f => f.startsWith("0") && f.includes("party-"));
  for (const file of files) {
    const m = file.match(/party-(.+?)-(\w+(?:-\w+)*)-s\d+\.json$/);
    if (!m) continue;
    const itemId = m[1]!;
    if (!byItem[itemId]) continue;
    const events: GameEvent[] = JSON.parse(await Bun.file(join(logDir, file)).text());
    for (const e of events) {
      if (e.type === "attack" && e.attackerId === "R-fighter" && e.ability.id === "punch") {
        byItem[itemId]!.punchFallbacks++;
      }
    }
  }

  return Object.values(byItem);
}

const aggs = await buildAgg();

// --- Composite score: weight win rate heavily, then HP remaining ---
// Score = winRate * 100 + avgHp (so a 100% win rate at 0 HP scores 100; a 100% win at 50% HP scores 150)
function score(a: ItemAgg): number { return a.winRate * 100 + a.avgHp; }

const ranked = [...aggs].sort((a, b) => score(b) - score(a));

// --- Print overall ranking ---
console.log(`\n=== OVERALL RANKING (score = winRate*100 + avgHp%) ===`);
console.log(`item                   | type   | rarity    | winRate | avgHp | score | punch-fallback`);
console.log(`-----------------------|--------|-----------|---------|-------|-------|---------------`);
for (const a of ranked) {
  console.log(
    `${a.itemId.padEnd(22)} | ${a.type.padEnd(6)} | ${a.rarity.padEnd(9)} | ${(a.winRate * 100).toFixed(0).padStart(5)}%  | ${a.avgHp.toFixed(0).padStart(4)}% | ${score(a).toFixed(0).padStart(5)} | ${String(a.punchFallbacks).padStart(3)}`
  );
}

// --- Within-rarity ranking ---
console.log(`\n=== RANKING WITHIN RARITY ===`);
const byRarity: Record<string, ItemAgg[]> = {};
for (const a of aggs) {
  if (a.itemId === "baseline") continue;
  if (!byRarity[a.rarity]) byRarity[a.rarity] = [];
  byRarity[a.rarity]!.push(a);
}
const rarities = Object.keys(byRarity).sort((a, b) => (RARITY_ORDER[a] ?? 0) - (RARITY_ORDER[b] ?? 0));
for (const rarity of rarities) {
  const items = byRarity[rarity]!.sort((a, b) => score(b) - score(a));
  console.log(`\n  ${rarity}:`);
  for (const a of items) {
    console.log(`    ${a.itemId.padEnd(22)} (${a.type.padEnd(6)})  score=${score(a).toFixed(0).padStart(5)}  wr=${(a.winRate * 100).toFixed(0).padStart(3)}%  hp=${a.avgHp.toFixed(0).padStart(3)}%`);
  }
}

// --- Flags ---
console.log(`\n=== FLAGS ===`);
const baseline = aggs.find(a => a.itemId === "baseline");
const baselineScore = baseline ? score(baseline) : 0;
const flags: string[] = [];

// Items that perform worse than baseline (no item swap)
for (const a of aggs) {
  if (a.itemId === "baseline") continue;
  if (score(a) < baselineScore - 5) {
    flags.push(`  WORSE THAN BASELINE: ${a.itemId} (${a.rarity} ${a.type}) score=${score(a).toFixed(0)} vs baseline=${baselineScore.toFixed(0)}`);
  }
}

// Items where rarer items are outperformed by less-rare items of same type
for (const type of ["weapon", "shield"]) {
  const sameType = aggs.filter(a => a.itemId !== "baseline" && a.type === type)
    .sort((a, b) => (RARITY_ORDER[a.rarity] ?? 0) - (RARITY_ORDER[b.rarity] ?? 0));
  for (let i = 0; i < sameType.length; i++) {
    for (let j = i + 1; j < sameType.length; j++) {
      const lower = sameType[i]!;
      const higher = sameType[j]!;
      if ((RARITY_ORDER[higher.rarity] ?? 0) > (RARITY_ORDER[lower.rarity] ?? 0) && score(higher) < score(lower) - 10) {
        flags.push(`  RARITY INVERSION: ${higher.itemId} (${higher.rarity}) score=${score(higher).toFixed(0)} < ${lower.itemId} (${lower.rarity}) score=${score(lower).toFixed(0)}`);
      }
    }
  }
}

// Items where Sovereign frequently falls back to punch
for (const a of aggs) {
  if (a.itemId === "baseline") continue;
  if (a.punchFallbacks >= 3) {
    flags.push(`  PUNCH FALLBACK: ${a.itemId} (${a.rarity} ${a.type}) — fighter used punch ${a.punchFallbacks} times instead of item abilities`);
  }
}

// Per-scenario outliers: items losing scenarios where most win, or vice versa
const scenarioStats: Record<string, { wins: number; n: number }> = {};
for (const a of aggs) {
  if (a.itemId === "baseline") continue;
  for (const [sk, s] of Object.entries(a.scenarios)) {
    if (!scenarioStats[sk]) scenarioStats[sk] = { wins: 0, n: 0 };
    scenarioStats[sk]!.wins += s.wins;
    scenarioStats[sk]!.n += s.n;
  }
}
for (const a of aggs) {
  if (a.itemId === "baseline") continue;
  for (const [sk, s] of Object.entries(a.scenarios)) {
    const overall = scenarioStats[sk]!;
    const overallWr = overall.wins / overall.n;
    const myWr = s.wins / s.n;
    if (overallWr > 0.7 && myWr === 0) {
      flags.push(`  SCENARIO OUTLIER: ${a.itemId} loses ${sk} (${myWr * 100}%) while ${(overallWr * 100).toFixed(0)}% of items win it`);
    }
  }
}

if (flags.length === 0) console.log("  (none)");
else for (const f of flags) console.log(f);
