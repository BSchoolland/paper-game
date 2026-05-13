/**
 * agent-04 — "Vanguard".
 *
 * Exhaustive BFS turn enumeration + adversarial minimax with focus-fire evaluation.
 *
 * Test:
 *   bun hero-arena/src/harness.ts agent-04 baseline       # vs the dumb baseline
 *   bun hero-arena/src/harness.ts agent-04 agent-01 42    # vs Beamblade
 *   bun hero-arena/src/harness.ts agent-04 agent-02 7     # vs Sovereign
 *   bun hero-arena/src/harness.ts agent-04 agent-03 42    # vs Overlord
 */
import type { HeroController } from "../../src/types.js";
import { vanguardHero } from "./vanguard.js";

export const hero: HeroController = vanguardHero;
