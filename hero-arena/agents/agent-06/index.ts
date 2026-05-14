/**
 * agent-06 — configurable Overlord. Same brain as agent-03; the *intelligence level* is a single
 * parameter, picked from `PRESETS` in `overlord.ts`. Switch the preset on the line below to
 * change how hard this hero thinks (and how long it takes to act):
 *
 * Verified vs `baseline` (3 seeds: 1, 7, 42):
 *
 *   - PRESETS.novice     — ~250 ms/turn, beam 3, 1 reply level.  **Broken: lost 0–3 vs baseline.**
 *                          The bot just *passes* most turns and gets killed in melee. Root cause:
 *                          the eval is tuned assuming a deep enough search to find the
 *                          safe-trade-then-retreat play; at beam 3 it can't, so the rollout rates
 *                          "stand still" higher than any committed action. Needs per-preset eval
 *                          retuning (lower threat weight, higher immediate-damage reward at low
 *                          search depths) before this tier is usable.
 *   - PRESETS.skilled    — ~600 ms/turn, beam 6, 1 reply level.  Marginal: won 2/3 vs baseline,
 *                          lost the third. Borderline — usable for a *forgiving* low-tier enemy
 *                          but not a reliable miniboss.
 *   - PRESETS.expert     — ~1.5 s/turn, beam 9, 2 reply levels.  **Solid: won 3/3 vs baseline,
 *                          35–48% HP margins, hero alive every match.** This is the practical
 *                          "smart but not tournament-tier" tier you want for a real miniboss.
 *   - PRESETS.tournament — ~3.5 s/turn, beam 12, 3 reply levels.  Identical to agent-03 (the
 *                          tournament runner-up). For end-game bosses or "elite hero rival" NPCs.
 *
 * Test:
 *   bun hero-arena/src/harness.ts agent-06 baseline       # vs the dumb baseline
 *   bun hero-arena/src/harness.ts agent-06 agent-04 42    # vs Vanguard
 *   bun hero-arena/src/harness.ts agent-06 agent-03 7     # mirror tournament-tier Overlord
 */
import type { HeroController } from "../../src/types.js";
import type { MultiFormatAgent } from "../../src/t2/types.js";
import { makeOverlord, PRESETS } from "./overlord.js";

export const hero: HeroController = makeOverlord(PRESETS.tournament);

export const agent: MultiFormatAgent = {
  name: "agent-06",
  solo: () => hero,
  squad: { tank: hero, fighter: hero, ranged: hero },
  boss: hero,
  raid: { tank: hero, fighter: hero, ranged: hero },
};
