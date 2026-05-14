/**
 * agent-02 — "Sovereign". A beam-search hero engine with role-specific weight/search presets.
 * See `sovereign.ts` for the design notes; `tune.ts` for the weight tuner.
 *
 * Test:
 *   bun hero-arena/src/harness.ts agent-02 baseline       # vs the dumb baseline (T1)
 *   bun hero-arena/src/harness.ts agent-02 agent-01 42    # head to head, T1, seed 42
 *   bun hero-arena/agents/agent-02/tune.ts                # self-play weight tuning
 *
 *   bun -e "import { runSoloChallenge } from './hero-arena/src/t2/challenge-solo.js'; \
 *     import { agent } from './hero-arena/agents/agent-02/index.js'; \
 *     console.log((await runSoloChallenge(agent, [42])).highestLevelCleared)"
 */
import type { HeroController } from "../../src/types.js";
import type { AbilityDefinition, AttackAbility } from "../../../shared/src/index.js";
import { ShapeKind } from "../../../shared/src/core/types.js";
import type { MultiFormatAgent } from "../../src/t2/types.js";
import {
  makeSovereign, sovereignHero,
  FIGHTER_WEIGHTS, TANK_WEIGHTS, RANGED_WEIGHTS, BOSS_WEIGHTS,
  SOLO_MELEE_WEIGHTS, SOLO_RANGED_WEIGHTS,
  DEFAULT_PARAMS, FAST_PARAMS,
} from "./sovereign.js";

export const hero: HeroController = sovereignHero;

// Squad (PvE ladder) reuses the self-play-tuned FIGHTER weights for all three slots — those are
// proven, while hand-tuned role weights regressed PvE. Ranged is the one slot where the kit's
// stand-off range really changes positioning, so it gets specialized weights.
const tankCtl    = makeSovereign(FIGHTER_WEIGHTS, DEFAULT_PARAMS);
const fighterCtl = makeSovereign(FIGHTER_WEIGHTS, DEFAULT_PARAMS);
const rangedCtl  = makeSovereign(RANGED_WEIGHTS,  DEFAULT_PARAMS);

// Raid (PvP boss) wants more role flavor — the tank really should tank for the squishies, and
// the ranged really should kite. Skirmish reuses .squad but raid uses these.
const raidTankCtl   = makeSovereign(TANK_WEIGHTS,   DEFAULT_PARAMS);
const raidFighterCtl = makeSovereign(FIGHTER_WEIGHTS, DEFAULT_PARAMS);
const raidRangedCtl = makeSovereign(RANGED_WEIGHTS, DEFAULT_PARAMS);

// Boss-side: 1 hero, 2s budget — use DEFAULT_PARAMS (single hero, plenty of compute).
const bossCtl = makeSovereign(BOSS_WEIGHTS, DEFAULT_PARAMS);

function isRangedShape(s: AttackAbility["shape"]): boolean {
  if (s.kind === ShapeKind.Point) return true;
  if (s.kind === ShapeKind.Circle && s.range > 100) return true;
  return false;
}

function pickSoloPreset(abilities: AbilityDefinition[]) {
  const attacks = abilities.filter((a): a is AttackAbility => a.kind === "attack");
  if (attacks.length === 0) return { weights: SOLO_MELEE_WEIGHTS };
  const ranged = attacks.filter(a => isRangedShape(a.shape));
  const melee = attacks.length - ranged.length;
  // ranged-leaning: there's a real point/long-circle attack AND we don't have a clearly stronger
  // melee option (a sword sweep that one-shots tier-1 swarms is better than a 20dmg arrow).
  const bestRangedDmg = ranged.reduce((m, a) => Math.max(m, a.damage), 0);
  const bestMeleeDmg = attacks.filter(a => !isRangedShape(a.shape)).reduce((m, a) => Math.max(m, a.damage), 0);
  const rangedLeans = ranged.length > 0 && (melee === 0 || bestRangedDmg >= bestMeleeDmg - 6);
  return { weights: rangedLeans ? SOLO_RANGED_WEIGHTS : SOLO_MELEE_WEIGHTS };
}

export const agent: MultiFormatAgent = {
  name: "agent-02",
  solo(abilities) {
    const { weights } = pickSoloPreset(abilities);
    return makeSovereign(weights, DEFAULT_PARAMS); // 1 hero, full budget
  },
  squad: { tank: tankCtl, fighter: fighterCtl, ranged: rangedCtl },
  boss: bossCtl,
  raid: { tank: raidTankCtl, fighter: raidFighterCtl, ranged: raidRangedCtl },
};
