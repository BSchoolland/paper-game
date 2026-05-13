#!/usr/bin/env bun
/**
 * Run a single Hero Arena match and watch it — the same loop the tournament uses, for one pairing.
 *
 *   bun hero-arena/src/harness.ts <agentA> [agentB] [seed] [maxTurns]
 *
 *   bun hero-arena/src/harness.ts agent-01             # agent-01 vs the dumb `baseline`
 *   bun hero-arena/src/harness.ts agent-01 agent-01    # mirror — agent-01 fights itself (self-play)
 *   bun hero-arena/src/harness.ts agent-01 agent-02 42 # head to head on seed 42
 *
 * Prints a turn-by-turn log (each hero action, allies' moves are summarised, plus any rule
 * violations / over-budget turns), reports the winner, and writes a replay to
 * `client/public/replay.json` — open  http://localhost:5173/?mode=replay  to scrub through it
 * (`.` step, Enter play-a-turn, `[` `]` speed).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { runMatch, TURN_BUDGET_MS } from "./match.js";
import { controllerByName } from "./registry.js";

const a = process.argv[2];
const b = process.argv[3] ?? "baseline";
const seed = Number(process.argv[4] ?? 42);
const maxTurns = Number(process.argv[5] ?? 120);
if (!a) {
  console.error("usage: bun hero-arena/src/harness.ts <agentA> [agentB=baseline] [seed=42] [maxTurns=120]");
  process.exit(2);
}

const result = await runMatch(
  { name: a, hero: controllerByName(a) },
  { name: b, hero: controllerByName(b) },
  seed, { maxTurns, verbose: true },
);

console.log(result.log.join("\n"));
console.log("");
console.log(`Result: ${result.outcome === "draw" ? "DRAW" : `${result.outcome === "red" ? a : b} wins`}  ` +
  `(${result.turns} turns; HP% ${a} ${(result.hpFrac.red * 100).toFixed(0)} / ${b} ${(result.hpFrac.blue * 100).toFixed(0)}; ` +
  `hero alive: ${a} ${result.heroAlive.red ? "✓" : "✗"} / ${b} ${result.heroAlive.blue ? "✓" : "✗"})`);
console.log(`Timing (budget ${TURN_BUDGET_MS}ms):  ${a} max ${result.timing.red.maxMs}ms, ${result.timing.red.overruns} overrun(s), ${result.timing.red.forfeits} forfeit(s)  |  ` +
  `${b} max ${result.timing.blue.maxMs}ms, ${result.timing.blue.overruns} overrun(s), ${result.timing.blue.forfeits} forfeit(s)`);

const replayPath = join(import.meta.dir, "..", "..", "client", "public", "replay.json");
mkdirSync(dirname(replayPath), { recursive: true });
writeFileSync(replayPath, JSON.stringify({ seed, dimensions: [0], frames: result.frames }));
console.log(`\nWrote ${result.frames.length}-frame replay → ${replayPath}\nWatch:  http://localhost:5173/?mode=replay`);
