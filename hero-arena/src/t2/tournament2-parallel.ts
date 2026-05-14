#!/usr/bin/env bun
/**
 * Parallel tournament runner. Enumerates all independent work units across the
 * four challenges, partitions them among N worker subprocesses, then aggregates
 * results into the same final standings tournament2.ts prints.
 *
 *   bun hero-arena/src/t2/tournament2-parallel.ts [--workers N] [seed1 seed2 ...]
 */
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { COMPETITOR_NAMES } from "./registry2.js";
import type { Unit, UnitResult } from "./tournament2-worker.js";

const args = process.argv.slice(2);
let workers = 16;
const seeds: number[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--workers") { workers = Number(args[++i]); continue; }
  const n = Number(args[i]);
  if (Number.isFinite(n)) seeds.push(n);
}
const SEEDS = seeds.length > 0 ? seeds : [1, 7, 42];

// ── Enumerate work ──────────────────────────────────────────────────────────

const units: Unit[] = [];
for (const agent of COMPETITOR_NAMES) {
  for (const seed of SEEDS) {
    units.push({ kind: "solo", agent, seed });
    units.push({ kind: "squad", agent, seed });
  }
}
for (let i = 0; i < COMPETITOR_NAMES.length; i++) {
  for (let j = i + 1; j < COMPETITOR_NAMES.length; j++) {
    const A = COMPETITOR_NAMES[i]!, B = COMPETITOR_NAMES[j]!;
    for (const seed of SEEDS) {
      units.push({ kind: "skirmish", redAgent: A, blueAgent: B, seed });
      units.push({ kind: "skirmish", redAgent: B, blueAgent: A, seed });
    }
  }
}
for (let i = 0; i < COMPETITOR_NAMES.length; i++) {
  for (let j = 0; j < COMPETITOR_NAMES.length; j++) {
    if (i === j) continue;
    for (const seed of SEEDS) {
      units.push({ kind: "boss", bossAgent: COMPETITOR_NAMES[i]!, raidAgent: COMPETITOR_NAMES[j]!, seed });
    }
  }
}

console.error(`[parallel] total units: ${units.length}, workers: ${workers}, seeds: [${SEEDS.join(",")}]`);

// Shuffle so heavy solo units distribute across workers
shuffle(units, 12345);

// Partition round-robin
const shards: Unit[][] = Array.from({ length: workers }, () => []);
units.forEach((u, i) => shards[i % workers]!.push(u));

const tmpRoot = mkdtempSync(join(tmpdir(), "t2par-"));
writeFileSync(join(tmpRoot, "total.txt"), String(units.length));
// Stable symlink so external monitors can find the active run directory.
const activeLink = join(tmpdir(), "t2par-active");
try { if (existsSync(activeLink)) unlinkSync(activeLink); } catch {}
try { symlinkSync(tmpRoot, activeLink); } catch {}
console.error(`[parallel] progress dir: ${tmpRoot} (symlinked at ${activeLink})`);
const startedAt = Date.now();
const children: ReturnType<typeof spawn>[] = [];
const killAll = () => { for (const c of children) try { c.kill("SIGKILL"); } catch {} };
process.on("SIGINT", () => { killAll(); process.exit(130); });
process.on("SIGTERM", () => { killAll(); process.exit(143); });

const promises = shards.map((shard, idx) => new Promise<UnitResult[]>((resolve, reject) => {
  if (shard.length === 0) return resolve([]);
  const file = join(tmpRoot, `shard-${idx}.json`);
  const progressFile = join(tmpRoot, `progress-${idx}`);
  writeFileSync(file, JSON.stringify(shard));
  writeFileSync(progressFile, "0");
  const proc = spawn("bun", ["hero-arena/src/t2/tournament2-worker.ts", file, progressFile], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(proc);
  let out = "", err = "";
  proc.stdout.on("data", d => out += d.toString());
  proc.stderr.on("data", d => { err += d.toString(); });
  proc.on("close", code => {
    if (code !== 0) return reject(new Error(`worker ${idx} exited ${code}: ${err.slice(-500)}`));
    try { resolve(JSON.parse(out) as UnitResult[]); }
    catch (e) { reject(new Error(`worker ${idx} bad json: ${(e as Error).message}; tail: ${out.slice(-200)}`)); }
  });
}));

const allResults = (await Promise.all(promises)).flat();
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.error(`\n[parallel] done in ${elapsed}s`);
rmSync(tmpRoot, { recursive: true, force: true });

// ── Aggregate ───────────────────────────────────────────────────────────────

interface Tally { pts: number; w: number; d: number; l: number; hpMargin: number; }
interface Scores {
  soloLevel: number;   // best across seeds
  squadLevel: number;
  skirmish: Tally;
  boss: Tally;
  total: number;
}
const scores: Record<string, Scores> = {};
for (const name of COMPETITOR_NAMES) {
  scores[name] = {
    soloLevel: 0, squadLevel: 0,
    skirmish: { pts: 0, w: 0, d: 0, l: 0, hpMargin: 0 },
    boss: { pts: 0, w: 0, d: 0, l: 0, hpMargin: 0 },
    total: 0,
  };
}

function credit(t: Tally, hpMine: number, hpTheirs: number, outcome: "W" | "D" | "L") {
  t.hpMargin += hpMine - hpTheirs;
  if (outcome === "W") { t.w++; t.pts += 3; }
  else if (outcome === "D") { t.d++; t.pts += 1; }
  else t.l++;
}

for (const r of allResults) {
  if (r.kind === "solo") {
    if (r.bestLevel > scores[r.agent]!.soloLevel) scores[r.agent]!.soloLevel = r.bestLevel;
  } else if (r.kind === "squad") {
    if (r.bestLevel > scores[r.agent]!.squadLevel) scores[r.agent]!.squadLevel = r.bestLevel;
  } else if (r.kind === "skirmish") {
    const redWon = r.outcome === "red", blueWon = r.outcome === "blue";
    credit(scores[r.redAgent]!.skirmish, r.hpRed, r.hpBlue, redWon ? "W" : blueWon ? "L" : "D");
    credit(scores[r.blueAgent]!.skirmish, r.hpBlue, r.hpRed, blueWon ? "W" : redWon ? "L" : "D");
  } else if (r.kind === "boss") {
    const bossWon = r.outcome === "red", raidWon = r.outcome === "blue";
    credit(scores[r.bossAgent]!.boss, r.hpRed, r.hpBlue, bossWon ? "W" : raidWon ? "L" : "D");
    credit(scores[r.raidAgent]!.boss, r.hpBlue, r.hpRed, raidWon ? "W" : bossWon ? "L" : "D");
  }
}

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

console.log(`\n  seeds: [${SEEDS.join(", ")}]    workers: ${workers}    elapsed: ${elapsed}s\n`);
console.log(`  #  agent       total   solo  squad  skirmish      boss`);
ranked.forEach((name, i) => {
  const s = scores[name]!;
  console.log(
    `  ${String(i + 1).padStart(2)}  ${name.padEnd(10)}  ${String(s.total).padStart(4)}` +
    `   ${String(s.soloLevel).padStart(3)}/20` +
    `  ${String(s.squadLevel).padStart(3)}/20` +
    `   ${String(s.skirmish.pts).padStart(3)} (${s.skirmish.w}W ${s.skirmish.d}D ${s.skirmish.l}L)` +
    `   ${String(s.boss.pts).padStart(3)} (${s.boss.w}W ${s.boss.d}D ${s.boss.l}L)`
  );
});
console.log(`\n  score formula: solo×3 + squad×3 + skirmish_pts + boss_pts`);

function shuffle<T>(arr: T[], seed: number) {
  let s = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
