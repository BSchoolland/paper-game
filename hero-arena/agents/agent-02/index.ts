/**
 * agent-02 — "Sovereign". A beam-search hero engine with a king-safety-aware, self-play-tuned
 * evaluation. See `sovereign.ts` for the design notes; `tune.ts` for the weight tuner.
 *
 * Test:
 *   bun hero-arena/src/harness.ts agent-02 baseline       # vs the dumb baseline
 *   bun hero-arena/src/harness.ts agent-02 agent-01 42    # head to head on seed 42
 *   bun hero-arena/agents/agent-02/tune.ts                # self-play weight tuning
 */
import type { HeroController } from "../../src/types.js";
import type { MultiFormatAgent } from "../../src/t2/types.js";
import { sovereignHero } from "./sovereign.js";

export const hero: HeroController = sovereignHero;

export const agent: MultiFormatAgent = {
  name: "agent-02",
  solo: () => sovereignHero,
  squad: { tank: sovereignHero, fighter: sovereignHero, ranged: sovereignHero },
  boss: sovereignHero,
  raid: { tank: sovereignHero, fighter: sovereignHero, ranged: sovereignHero },
};
