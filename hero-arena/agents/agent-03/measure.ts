/**
 * Measurement harness for agent-03 tuning. Runs head-to-head T1 mirror matches against each
 * other agent over a set of seeds (both sides swapped — red moves first, so sides matter), prints
 * a compact W/D/L + HP-margin table. Override HERO_TURN_BUDGET_MS to trade fidelity for speed.
 *
 *   HERO_TURN_BUDGET_MS=500 bun hero-arena/agents/agent-03/measure.ts
 *   HERO_TURN_BUDGET_MS=500 bun hero-arena/agents/agent-03/measure.ts agent-02 agent-07
 *   bun hero-arena/agents/agent-03/measure.ts                            # full 5s budget
 */
import { runMatch } from "../../src/match.js";
import { AGENTS, AGENT_NAMES } from "../../src/registry.js";

const ME = "agent-03";
const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(",").map(Number) : [1, 7, 42];

async function main() {
  const argv = process.argv.slice(2);
  const opponents = argv.length > 0 ? argv : AGENT_NAMES.filter(n => n !== ME);
  const turnBudget = Number(process.env.HERO_TURN_BUDGET_MS ?? 5000);
  console.log(`agent-03 vs [${opponents.join(", ")}] — ${SEEDS.length} seeds × 2 sides @ ${turnBudget}ms/turn`);

  const rows: Array<{ opp: string; w: number; d: number; l: number; margin: number; pts: number }> = [];
  for (const opp of opponents) {
    const me = { name: ME, hero: AGENTS[ME]! };
    const them = { name: opp, hero: AGENTS[opp]! };
    let w = 0, d = 0, l = 0, margin = 0;
    const details: string[] = [];
    for (const seed of SEEDS) {
      for (const [red, blue, mySide] of [[me, them, "red"], [them, me, "blue"]] as const) {
        const r = await runMatch(red, blue, seed, { maxTurns: 50 });
        const myFrac = r.hpFrac[mySide];
        const theirFrac = r.hpFrac[mySide === "red" ? "blue" : "red"];
        margin += myFrac - theirFrac;
        const result = r.outcome === mySide ? "W" : r.outcome === "draw" ? "D" : "L";
        if (result === "W") w++; else if (result === "D") d++; else l++;
        details.push(`${mySide[0]}${seed}:${result}${Math.round((myFrac - theirFrac) * 100)}`);
      }
    }
    const pts = w * 3 + d;
    rows.push({ opp, w, d, l, margin, pts });
    console.log(`  vs ${opp.padEnd(10)}  W${w} D${d} L${l}  margin ${(margin / (SEEDS.length * 2) * 100).toFixed(1)}%  pts ${pts}/${SEEDS.length * 2 * 3}  [${details.join(" ")}]`);
  }
  const totalPts = rows.reduce((s, r) => s + r.pts, 0);
  const totalW = rows.reduce((s, r) => s + r.w, 0);
  const totalL = rows.reduce((s, r) => s + r.l, 0);
  const totalD = rows.reduce((s, r) => s + r.d, 0);
  console.log(`\nTOTAL: W${totalW} D${totalD} L${totalL}  pts ${totalPts}/${rows.length * SEEDS.length * 2 * 3}`);
  const losing = rows.filter(r => r.l > r.w);
  if (losing.length > 0) console.log(`Losing matchups: ${losing.map(r => r.opp).join(", ")}`);
  else console.log(`✓ winning all matchups`);
}

main();
