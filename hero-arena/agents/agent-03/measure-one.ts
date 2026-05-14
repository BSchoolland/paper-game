/**
 * Run a single mirror match between agent-03 and a named opponent on a fixed seed and side.
 * Prints one CSV line: `opp,seed,mySide,outcome,myHpFrac,theirHpFrac,turns`.
 * Used by `measure-parallel.sh` to run many matches concurrently across cores.
 *
 *   bun hero-arena/agents/agent-03/measure-one.ts agent-01 42 red
 */
import { runMatch } from "../../src/match.js";
import { AGENTS } from "../../src/registry.js";

const [opp, seedStr, mySide] = process.argv.slice(2);
const seed = Number(seedStr);
if (!opp || !AGENTS[opp] || !Number.isFinite(seed) || (mySide !== "red" && mySide !== "blue")) {
  console.error("usage: measure-one.ts <opponent> <seed> <red|blue>");
  process.exit(2);
}

const me = { name: "agent-03", hero: AGENTS["agent-03"]! };
const them = { name: opp, hero: AGENTS[opp]! };
const [red, blue] = mySide === "red" ? [me, them] : [them, me];

const r = await runMatch(red, blue, seed, { maxTurns: 50 });
const myFrac = r.hpFrac[mySide as "red" | "blue"];
const theirFrac = r.hpFrac[mySide === "red" ? "blue" : "red"];
const outcome = r.outcome === mySide ? "W" : r.outcome === "draw" ? "D" : "L";
console.log(`${opp},${seed},${mySide},${outcome},${myFrac.toFixed(3)},${theirFrac.toFixed(3)},${r.turns}`);
