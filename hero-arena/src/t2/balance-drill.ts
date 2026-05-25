#!/usr/bin/env bun
/**
 * Drill into a balance-test event log and extract per-entity combat stats.
 *
 *   bun hero-arena/src/t2/balance-drill.ts <event-log.json>
 *   bun hero-arena/src/t2/balance-drill.ts balance-logs-dim-0/0042-*.json
 *   bun hero-arena/src/t2/balance-drill.ts balance-logs-dim-0/  (all files)
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GameEvent } from "../../../shared/src/index.js";

interface EntityStats {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  barrierGranted: number;
  attacks: number;
  hits: number;
  moves: number;
}

function analyze(events: GameEvent[]): Record<string, EntityStats> {
  const stats: Record<string, EntityStats> = {};

  const get = (id: string): EntityStats => {
    if (!stats[id]) stats[id] = { damageDealt: 0, damageTaken: 0, kills: 0, deaths: 0, barrierGranted: 0, attacks: 0, hits: 0, moves: 0 };
    return stats[id]!;
  };

  for (const e of events) {
    switch (e.type) {
      case "attack": {
        const attacker = get(e.attackerId);
        attacker.attacks++;
        for (const hit of e.hits) {
          attacker.damageDealt += hit.damage;
          attacker.hits++;
          if (hit.killed) attacker.kills++;
          const target = get(hit.targetId);
          target.damageTaken += hit.damage;
          if (hit.killed) target.deaths++;
        }
        break;
      }
      case "barrier":
        get(e.entityId).barrierGranted += e.barrierHp;
        break;
      case "move":
        get(e.entityId).moves++;
        break;
      case "collision": {
        get(e.entityId).damageTaken += e.damage;
        if (e.killed) get(e.entityId).deaths++;
        break;
      }
    }
  }
  return stats;
}

function printStats(file: string, stats: Record<string, EntityStats>) {
  console.log(`\n=== ${file} ===`);
  console.log("entity                     | dmgDealt | dmgTaken | kills | deaths | barrier | attacks | hits | moves");
  console.log("---------------------------|----------|----------|-------|--------|---------|---------|------|------");

  const sorted = Object.entries(stats).sort((a, b) => {
    const teamA = a[0].startsWith("R") ? 0 : 1;
    const teamB = b[0].startsWith("R") ? 0 : 1;
    if (teamA !== teamB) return teamA - teamB;
    return b[1].damageDealt - a[1].damageDealt;
  });

  for (const [id, s] of sorted) {
    console.log(
      `${id.padEnd(26)} | ${String(s.damageDealt).padStart(8)} | ${String(s.damageTaken).padStart(8)} | ${String(s.kills).padStart(5)} | ${String(s.deaths).padStart(6)} | ${String(s.barrierGranted).padStart(7)} | ${String(s.attacks).padStart(7)} | ${String(s.hits).padStart(4)} | ${String(s.moves).padStart(5)}`
    );
  }

  // Team totals
  const teams: Record<string, EntityStats> = {};
  for (const [id, s] of Object.entries(stats)) {
    const team = id.startsWith("R") ? "RED" : "BLUE";
    if (!teams[team]) teams[team] = { damageDealt: 0, damageTaken: 0, kills: 0, deaths: 0, barrierGranted: 0, attacks: 0, hits: 0, moves: 0 };
    const t = teams[team]!;
    t.damageDealt += s.damageDealt; t.damageTaken += s.damageTaken; t.kills += s.kills;
    t.deaths += s.deaths; t.barrierGranted += s.barrierGranted; t.attacks += s.attacks;
    t.hits += s.hits; t.moves += s.moves;
  }
  console.log("---------------------------|----------|----------|-------|--------|---------|---------|------|------");
  for (const [team, s] of Object.entries(teams)) {
    console.log(
      `${(team + " TOTAL").padEnd(26)} | ${String(s.damageDealt).padStart(8)} | ${String(s.damageTaken).padStart(8)} | ${String(s.kills).padStart(5)} | ${String(s.deaths).padStart(6)} | ${String(s.barrierGranted).padStart(7)} | ${String(s.attacks).padStart(7)} | ${String(s.hits).padStart(4)} | ${String(s.moves).padStart(5)}`
    );
  }
}

// --- CLI ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: bun balance-drill.ts <event-log.json | directory>");
  process.exit(2);
}

const files: string[] = [];
for (const arg of args) {
  if (statSync(arg).isDirectory()) {
    for (const f of readdirSync(arg).filter(f => f.endsWith(".json")).sort()) files.push(join(arg, f));
  } else {
    files.push(arg);
  }
}

for (const file of files) {
  const events: GameEvent[] = JSON.parse(await Bun.file(file).text());
  printStats(file, analyze(events));
}
