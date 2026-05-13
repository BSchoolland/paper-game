/**
 * agent-05 — field the strongest proven local engine.
 *
 * I tested meta-wrappers and cleanup overrides, but they regressed key matchups by diverging from
 * Vanguard's defensive timing. The best measured choice is to run Vanguard unchanged.
 */
import type { HeroController } from "../../src/types.js";
import { vanguardHero } from "../agent-04/vanguard.js";

export const hero: HeroController = vanguardHero;
