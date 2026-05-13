#!/usr/bin/env bun
/**
 * Round-robin Hero Arena tournament over all eight registered agents.
 *
 *   bun hero-arena/src/tournament.ts [seed1 seed2 ...]            # default seeds: 1 7 42
 *
 * Every pair of agents plays each seed twice with sides swapped (red moves first, so this
 * neutralises the first-move edge). Scoring: win 3, draw 1, loss 0; draws at the turn cap are
 * broken by team HP%. Prints the standings (with tie-breaks: head-to-head points, then total
 * HP%-margin, then heroes-kept) and the full win/draw/loss matrix.
 *
 * For a single match with a turn-by-turn log + a viewable replay, use `harness.ts` instead.
 */
import { runMatch, type MatchResult } from "./match.js";
import { AGENT_NAMES, controllerByName } from "./registry.js";

const seeds = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n));
const SEEDS = seeds.length > 0 ? seeds : [1, 7, 42];
const MAX_TURNS = Number(globalThis.process?.env?.HERO_MAX_TURNS ?? 120);

interface Tally { w: number; d: number; l: number; pts: number; hpMargin: number; heroesKept: number; games: number }
const blank = (): Tally => ({ w: 0, d: 0, l: 0, pts: 0, hpMargin: 0, heroesKept: 0, games: 0 });
const table: Record<string, Tally> = Object.fromEntries(AGENT_NAMES.map(n => [n, blank()]));
const head2head: Record<string, Record<string, number>> = Object.fromEntries(AGENT_NAMES.map(n => [n, Object.fromEntries(AGENT_NAMES.map(m => [m, 0]))]));
// matrix[A][B] = "W"/"D"/"L"/… from A's perspective, aggregated as a short string per cell
const cell: Record<string, Record<string, string>> = Object.fromEntries(AGENT_NAMES.map(n => [n, Object.fromEntries(AGENT_NAMES.map(m => [m, n === m ? "—" : ""]))]));

function credit(name: string, mine: number, theirs: number, hpMine: number, hpTheirs: number, heroAlive: boolean, outcomeForMe: "W" | "D" | "L", opp: string) {
  const t = table[name]!;
  t.games++; t.hpMargin += hpMine - hpTheirs; if (heroAlive) t.heroesKept++;
  if (outcomeForMe === "W") { t.w++; t.pts += 3; }
  else if (outcomeForMe === "D") { t.d++; t.pts += 1; }
  else t.l++;
  head2head[name]![opp]! += outcomeForMe === "W" ? 3 : outcomeForMe === "D" ? 1 : 0;
  cell[name]![opp]! += outcomeForMe;
}

let played = 0;
for (let i = 0; i < AGENT_NAMES.length; i++) {
  for (let j = i + 1; j < AGENT_NAMES.length; j++) {
    const A = AGENT_NAMES[i]!, B = AGENT_NAMES[j]!;
    for (const seed of SEEDS) {
      for (const [red, blue] of [[A, B], [B, A]] as const) {
        const r: MatchResult = await runMatch({ name: red, hero: controllerByName(red) }, { name: blue, hero: controllerByName(blue) }, seed, { maxTurns: MAX_TURNS });
        played++;
        const redWon = r.outcome === "red", blueWon = r.outcome === "blue";
        credit(red, r.hpFrac.red, r.hpFrac.blue, r.hpFrac.red, r.hpFrac.blue, r.heroAlive.red, redWon ? "W" : blueWon ? "L" : "D", blue);
        credit(blue, r.hpFrac.blue, r.hpFrac.red, r.hpFrac.blue, r.hpFrac.red, r.heroAlive.blue, blueWon ? "W" : redWon ? "L" : "D", red);
        if (r.timing.red.forfeits || r.timing.blue.forfeits || r.timing.red.overruns || r.timing.blue.overruns)
          console.error(`  note: ${red} vs ${blue} seed ${seed} — timing issues (${red}: ${r.timing.red.overruns} over / ${r.timing.red.forfeits} forfeit; ${blue}: ${r.timing.blue.overruns} over / ${r.timing.blue.forfeits} forfeit)`);
      }
    }
    process.stderr.write(`  ${A} vs ${B} done (${played} games so far)\n`);
  }
}

// --- standings -------------------------------------------------------------
const ranked = [...AGENT_NAMES].sort((x, y) => {
  const tx = table[x]!, ty = table[y]!;
  if (ty.pts !== tx.pts) return ty.pts - tx.pts;
  if (head2head[y]![x]! !== head2head[x]![y]!) return head2head[y]![x]! - head2head[x]![y]!;
  if (ty.hpMargin !== tx.hpMargin) return ty.hpMargin - tx.hpMargin;
  return ty.heroesKept - tx.heroesKept;
});

console.log(`\n=== Hero Arena standings — ${AGENT_NAMES.length} agents, seeds [${SEEDS.join(", ")}], ${played} games (each pairing × ${SEEDS.length} seeds × 2 sides) ===\n`);
console.log(`  #  agent       pts   W   D   L    HP%-margin   heroes-kept`);
ranked.forEach((n, i) => {
  const t = table[n]!;
  console.log(`  ${String(i + 1).padStart(2)}  ${n.padEnd(10)}  ${String(t.pts).padStart(3)}  ${String(t.w).padStart(2)}  ${String(t.d).padStart(2)}  ${String(t.l).padStart(2)}   ${(t.hpMargin >= 0 ? "+" : "") + (t.hpMargin * 100).toFixed(0).padStart(3)}        ${String(t.heroesKept).padStart(3)}/${t.games}`);
});

console.log(`\n  matrix (row's results vs column, W/D/L per game, sides swapped each seed):`);
console.log(`             ` + ranked.map(n => n.slice(0, 8).padStart(9)).join(""));
for (const r of ranked) console.log(`  ${r.padEnd(10)} ` + ranked.map(c => (cell[r]![c]! || "·").padStart(9)).join(""));
