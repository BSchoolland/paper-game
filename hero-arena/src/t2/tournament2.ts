#!/usr/bin/env bun
/**
 * Tournament 2 — Multi-Format Hero Arena.
 *
 * Four challenges test agent versatility:
 *   #1  Solo   — 1 hero (random abilities) vs escalating enemy ladder
 *   #2  Squad  — 3 heroes (tank/fighter/ranged) vs escalating enemy ladder
 *   #3  Skirmish — 3v3 round-robin between agents
 *   #4  Boss Raid — boss+minions vs 3-hero raid team, both sides
 *
 *   bun hero-arena/src/t2/tournament2.ts [seed1 seed2 ...]    # default seeds: 1 7 42
 */
import { AGENTS2, COMPETITOR_NAMES } from "./registry2.js";
import { runSoloChallenge } from "./challenge-solo.js";
import { runSquadChallenge } from "./challenge-squad.js";
import { runSkirmishChallenge, type SkirmishTally } from "./challenge-skirmish.js";
import { runBossChallenge, type BossTally } from "./challenge-boss.js";

const seeds = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n));
const SEEDS = seeds.length > 0 ? seeds : [1, 7, 42];

const agents = COMPETITOR_NAMES.map(n => AGENTS2[n]!);

interface Scores {
  soloLevel: number;
  squadLevel: number;
  skirmish: SkirmishTally;
  boss: BossTally;
  total: number;
}

const scores: Record<string, Scores> = {};

// ── Challenge 1: Solo ────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════╗");
console.log("║     Challenge 1: Solo (1vN)              ║");
console.log("╚══════════════════════════════════════════╝\n");

for (const agent of agents) {
  process.stderr.write(`Solo: running ${agent.name}...\n`);
  const result = await runSoloChallenge(agent, SEEDS);
  if (!scores[agent.name]) scores[agent.name] = blank();
  scores[agent.name]!.soloLevel = result.highestLevelCleared;
  console.log(`  ${agent.name}: tier ${result.highestLevelCleared}/20`);
}

// ── Challenge 2: Squad ───────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════╗");
console.log("║     Challenge 2: Squad (3vN)             ║");
console.log("╚══════════════════════════════════════════╝\n");

for (const agent of agents) {
  process.stderr.write(`Squad: running ${agent.name}...\n`);
  const result = await runSquadChallenge(agent, SEEDS);
  scores[agent.name]!.squadLevel = result.highestLevelCleared;
  console.log(`  ${agent.name}: tier ${result.highestLevelCleared}/20`);
}

// ── Challenge 3: Skirmish ────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════╗");
console.log("║     Challenge 3: Skirmish (3v3)          ║");
console.log("╚══════════════════════════════════════════╝\n");

const skirmishResults = await runSkirmishChallenge(agents, SEEDS);
for (const agent of agents) {
  const t = skirmishResults[agent.name]!;
  scores[agent.name]!.skirmish = t;
  console.log(`  ${agent.name}: ${t.pts}pts (${t.w}W ${t.d}D ${t.l}L) HP%: ${(t.hpMargin >= 0 ? "+" : "")}${(t.hpMargin * 100).toFixed(0)}`);
}

// ── Challenge 4: Boss Raid ───────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════╗");
console.log("║     Challenge 4: Boss Raid               ║");
console.log("╚══════════════════════════════════════════╝\n");

const bossResults = await runBossChallenge(agents, SEEDS);
for (const agent of agents) {
  const t = bossResults[agent.name]!;
  scores[agent.name]!.boss = t;
  console.log(`  ${agent.name}: ${t.pts}pts (${t.w}W ${t.d}D ${t.l}L) HP%: ${(t.hpMargin >= 0 ? "+" : "")}${(t.hpMargin * 100).toFixed(0)}`);
}

// ── Combined Standings ───────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════╗");
console.log("║     Combined Standings                   ║");
console.log("╚══════════════════════════════════════════╝\n");

for (const name of COMPETITOR_NAMES) {
  const s = scores[name]!;
  s.total = s.soloLevel * 3 + s.squadLevel * 3 + s.skirmish.pts + s.boss.pts;
}

const ranked = [...COMPETITOR_NAMES].sort((x, y) => {
  const sx = scores[x]!, sy = scores[y]!;
  if (sy.total !== sx.total) return sy.total - sx.total;
  const escX = sx.soloLevel + sx.squadLevel, escY = sy.soloLevel + sy.squadLevel;
  if (escY !== escX) return escY - escX;
  if (sy.skirmish.pts !== sx.skirmish.pts) return sy.skirmish.pts - sx.skirmish.pts;
  return sy.boss.pts - sx.boss.pts;
});

console.log(`  seeds: [${SEEDS.join(", ")}]\n`);
console.log(`  #  agent       total   solo  squad  skirmish  boss`);
ranked.forEach((name, i) => {
  const s = scores[name]!;
  console.log(
    `  ${String(i + 1).padStart(2)}  ${name.padEnd(10)}  ${String(s.total).padStart(4)}` +
    `   ${String(s.soloLevel).padStart(3)}/20` +
    `  ${String(s.squadLevel).padStart(3)}/20` +
    `     ${String(s.skirmish.pts).padStart(3)}` +
    `     ${String(s.boss.pts).padStart(3)}`
  );
});

console.log(`\n  score formula: solo×3 + squad×3 + skirmish_pts + boss_pts`);

function blank(): Scores {
  return {
    soloLevel: 0,
    squadLevel: 0,
    skirmish: { pts: 0, w: 0, d: 0, l: 0, hpMargin: 0 },
    boss: { pts: 0, w: 0, d: 0, l: 0, hpMargin: 0 },
    total: 0,
  };
}
