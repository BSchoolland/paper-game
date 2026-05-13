/**
 * agent-01's hero entry. Replace `hero` below with your own `HeroController` (see hero-arena/README.md).
 * Keep this file's export name `hero`. You may add more files in this folder and import them here.
 *
 * Test your bot:
 *   bun hero-arena/src/harness.ts agent-01 baseline       # vs the dumb baseline
 *   bun hero-arena/src/harness.ts agent-01 agent-01       # mirror — fight yourself (self-play)
 *   bun hero-arena/src/harness.ts agent-01 agent-01 42    # head to head on seed 42
 * Then watch it:  http://localhost:5173/?mode=replay
 */
import { referenceHero } from "../../src/reference-bot.js";
import type { HeroController } from "../../src/types.js";

export const hero: HeroController = referenceHero;
