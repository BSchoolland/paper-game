/**
 * Boss controller: 300HP, 3red/3blue, hits hard. The trick is positioning — the boss
 * should hug its minions (so raid heroes wading in face the whole pack) and use its
 * 75-kb Hook to peel raid heroes into walls.
 *
 * We reuse the generic buildHeroTurn but with boss-flavored weights and a slight
 * preference for targeting raid heroes (the smart side) over their (nonexistent) allies.
 */
import type { HeroController } from "../../src/types.js";
import { DEFAULT_WEIGHTS, buildHeroTurn, type EvalWeights } from "./shared.js";

const BOSS_WEIGHTS: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  heroDeadPenalty: 5.0,  // boss death = total loss (no minion can replace it)
  heroHp: 1.5,
  enemyHp: 0.9,
  enemyHero: 2.5,        // raid heroes are the only real threat — make them count
  drift: 0.2,            // let the raid come to us (minions screen for free)
  cohesion: 0.0,
  ourAliveCount: 0.4,    // keep minions alive — they're our damage reduction
  enemyCluster: 0.5,     // boss cleave is a sector — pull clustered raiders in
};

export const bossController: HeroController = (ctx) => {
  // Boss has 3red/3blue (vs 2/2 for heroes) → bigger candidate set per step. Keep
  // beam narrow and skip adversarial eval so we stay under the 2s budget; wider
  // search regressed the win rate by 15 pts in testing.
  const result = buildHeroTurn(
    ctx.state, ctx.heroId, ctx.deadlineMs,
    6, BOSS_WEIGHTS, null,
    /* beamWidth */ 6, /* finalists */ 10,
    /* useRolloutDuringSearch */ false,
    /* useAdversarialFinal */ false,
  );
  return result.plan;
};
