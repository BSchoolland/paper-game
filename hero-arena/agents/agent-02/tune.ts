/**
 * Self-play weight tuner for Sovereign (agent-02).
 *
 * Coevolutionary coordinate descent: candidates are scored mostly by **playing the reigning
 * champion Sovereign** (the best weights found so far) head-to-head, plus an occasional game
 * against the stock reference bot as an absolute sanity anchor. The champion is frozen for the
 * duration of each pass (so scores within a pass are comparable) and ratchets up to the pass's
 * best at the pass boundary — so each "generation" has to actually out-play the previous one.
 * This surfaces robust, genuinely-strong strategies rather than weights that merely crush a weak
 * opponent.
 *
 *   bun hero-arena/agents/agent-02/tune.ts                       # 2 passes, seeds 1 7 42 99
 *   bun hero-arena/agents/agent-02/tune.ts 3 1 7 42 99 123 7   # 3 passes, custom seeds
 *
 * Slow (~couple of minutes per candidate). Pipe it: `... | tee /tmp/sovereign-tune.log`. Safe to
 * Ctrl-C anytime — grep the log for the last `--- after pass` line for the current best, then
 * RE-VALIDATE it on fresh seeds (and ideally vs a strong opponent) before pasting it into
 * `DEFAULT_WEIGHTS` in `sovereign.ts` — the eval batch is small and self-play scores are noisy.
 */
import { appendFileSync } from "node:fs";
import { runMatch } from "../../src/match.js";
import { referenceHero } from "../../src/reference-bot.js";
import { makeSovereign, DEFAULT_WEIGHTS, type Weights } from "./sovereign.js";

// Progress is mirrored to this file with an unbuffered append after every line — `bun`'s stdout is
// block-buffered when redirected to a file, so `console.log` alone can leave the log empty for ages.
const LOG_FILE = globalThis.process?.env?.TUNE_LOG ?? "/tmp/sovereign-tune.log";
function log(s: string): void { console.log(s); try { appendFileSync(LOG_FILE, s + "\n"); } catch { /* best effort */ } }

const argv = globalThis.process?.argv?.slice(2) ?? [];
const PASSES = Number(argv[0] ?? 2);
const SEEDS = (argv.length > 1 ? argv.slice(1).map(Number) : [1, 7, 42, 99]);
const REF_SEEDS = SEEDS.slice(0, 1);          // "only very occasional" games vs the default bot
// Tuning matches run with a short per-turn budget (set HERO_TURN_BUDGET_MS when launching) and a
// reduced turn cap — mirror games between two strong bots otherwise crawl to 120 turns. The
// resulting weights transfer fine to the full 5s budget; tuning at full budget is just intractable.
const TUNE_MAX_TURNS = Number(globalThis.process?.env?.TUNE_MAX_TURNS ?? 70);
// multipliers tried for each weight, per pass (shrinking step)
const STEPS = [[0.5, 0.75, 1.5, 2], [0.8, 1.25], [0.9, 1.1]];

type Bot = { name: string; hero: typeof referenceHero };

/** Net match points for `me` (3 win / 1 draw / 0 loss) plus the final HP-fraction margin (~[-1,1])
 *  as a tie-breaker. Averaged over the given seeds, both sides. */
async function series(me: Bot, opp: Bot, seeds: number[]): Promise<{ total: number; games: number }> {
  let total = 0, games = 0;
  for (const seed of seeds) {
    for (const [a, b] of [[me, opp], [opp, me]] as const) {
      const r = await runMatch(a, b, seed, { maxTurns: TUNE_MAX_TURNS });
      const meTeam = a === me ? "red" : "blue";
      const oppTeam = a === me ? "blue" : "red";
      let pts = r.outcome === "draw" ? 1 : r.outcome === meTeam ? 3 : 0;
      pts += r.hpFrac[meTeam] - r.hpFrac[oppTeam];
      total += pts; games++;
    }
  }
  return { total, games };
}

/** Average score for `w`: mostly vs the frozen `champion`, lightly anchored vs the reference bot. */
async function evaluate(w: Weights, champion: Bot): Promise<number> {
  const me: Bot = { name: "cand", hero: makeSovereign(w) };
  const vsChamp = await series(me, champion, SEEDS);
  const vsRef = await series(me, { name: "reference", hero: referenceHero }, REF_SEEDS);
  return (vsChamp.total + vsRef.total) / (vsChamp.games + vsRef.games);
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }

async function main() {
  let best: Weights = { ...DEFAULT_WEIGHTS };
  const keys = Object.keys(best) as (keyof Weights)[];

  for (let pass = 0; pass < PASSES; pass++) {
    // freeze the champion for this whole pass = the best weights from the previous pass.
    const champion: Bot = { name: `champ-p${pass}`, hero: makeSovereign({ ...best }) };
    let bestScore = await evaluate(best, champion);   // ~mirror in pass 0; the bar to beat this pass
    log(`=== pass ${pass}: champion = ${JSON.stringify(best)}  (self-score ${bestScore.toFixed(4)}) ===`);
    const mults = STEPS[Math.min(pass, STEPS.length - 1)]!;

    for (const k of keys) {
      let improved = false;
      for (const m of mults) {
        const trial: Weights = { ...best, [k]: round3(best[k] * m) };
        if (trial[k] === best[k]) continue;
        const score = await evaluate(trial, champion);
        const tag = score > bestScore + 1e-6 ? " *" : "";
        log(`pass ${pass} ${k} ×${m} → ${trial[k]}  score ${score.toFixed(4)}${tag}`);
        if (score > bestScore + 1e-6) { bestScore = score; best = trial; improved = true; }
      }
      if (improved) log(`  ↳ ${k} := ${best[k]}  (best ${bestScore.toFixed(4)})`);
    }
    log(`--- after pass ${pass}: ${bestScore.toFixed(4)}  ${JSON.stringify(best)}`);
  }

  log("\nbest weights found:");
  log("export const DEFAULT_WEIGHTS: Weights = " + JSON.stringify(best, null, 2) + ";");
}

main();
