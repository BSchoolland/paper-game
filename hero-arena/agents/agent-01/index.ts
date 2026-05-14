/**
 * agent-01's hero entry.
 *
 * Status: shipping the reference hero for the round robin. I built and tuned a beam-search variant
 * ("Beamblade" — whole-turn beam search, broad candidate generation, an eval that prizes hero
 * survival / kills / enemy-hero suppression, plus an optional 1-ply opponent-hero model) but in
 * repeated head-to-heads it kept coming out *worse* than this plain reference bot — its hero took
 * the enemy hero's focus-fire and died, where the reference bot's hero survives. Rather than field
 * a regression, agent-01 plays the reference bot until the variant is genuinely an improvement.
 * The experimental code is preserved in this folder's git history / scratch notes.
 */
import { referenceHero } from "../../src/reference-bot.js";
import type { HeroController } from "../../src/types.js";
import type { MultiFormatAgent } from "../../src/t2/types.js";

export const hero: HeroController = referenceHero;

export const agent: MultiFormatAgent = {
  name: "agent-01",
  solo: () => referenceHero,
  squad: { tank: referenceHero, fighter: referenceHero, ranged: referenceHero },
  boss: referenceHero,
  raid: { tank: referenceHero, fighter: referenceHero, ranged: referenceHero },
};
