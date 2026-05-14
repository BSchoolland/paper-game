/**
 * Squad and raid controller factories. Each hero plays its own greedy turn, but the leaf
 * evaluation projects what the other squadmates would do after, so the tank's choice
 * already considers the fighter's and ranged's follow-up — this is where coordination
 * comes from.
 */
import type { HeroController } from "../../src/types.js";
import type { EntityId } from "../../../shared/src/index.js";
import type { EvalWeights, FocusHint } from "./shared.js";
import { DEFAULT_WEIGHTS, buildHeroTurn, isHero } from "./shared.js";
import { effectiveHp, teamOf } from "../../src/toolkit.js";

// Shared focus target across the three squad controllers within a single turn.
// First controller invoked computes a focus; later controllers reuse it. Keyed by
// (team, turnNumber) so it auto-invalidates across turns (a fresh pick each turn
// avoids "stuck-on-a-barriered-target" oscillation).
const focusCache = new Map<string, FocusHint>();

function pickFocus(state: import("../../../shared/src/index.js").GameState, myHeroId: EntityId): FocusHint {
  const team = teamOf(state, myHeroId);
  const enemies = [...state.entities.values()].filter(e => !e.dead && e.teamId !== team);
  if (enemies.length === 0) return { targetId: null, bonus: 0 };
  // Priority: enemy heroes (focus the squishy DPS first — ranged > fighter > tank),
  // tiebreak by lowest-effective-HP. For non-hero enemies (PvE), just lowest HP.
  function rolePriority(name: string): number {
    const n = name.toLowerCase();
    if (n === "ranged") return 3;  // squishy + high threat = ideal focus
    if (n === "fighter") return 2; // big damage, medium survivability
    if (n === "boss") return 1.7;  // boss has lots of HP but is the win condition
    if (n === "tank") return 1;    // tankiest, focus last
    return 0;
  }
  let best = enemies[0]!;
  let bestScore = -Infinity;
  for (const e of enemies) {
    const heroBonus = isHero(e) ? 1.0 : 0.0;
    const role = rolePriority(e.name);
    const lowHpBonus = 1 - Math.min(1, effectiveHp(e) / Math.max(1, e.maxHp));
    // Hero score: role priority + low-HP swing; PvE score: pure low-HP
    const s = heroBonus > 0 ? role * 1.0 + lowHpBonus * 1.5 : lowHpBonus * 2;
    if (s > bestScore) { bestScore = s; best = e; }
  }
  return { targetId: best.id, bonus: 1.0 };
}

function getOrPickFocus(state: import("../../../shared/src/index.js").GameState, myHeroId: EntityId): FocusHint {
  const team = teamOf(state, myHeroId);
  const key = `${team}@${state.turnNumber}`;
  let f = focusCache.get(key);
  if (!f) {
    f = pickFocus(state, myHeroId);
    focusCache.set(key, f);
    if (focusCache.size > 200) {
      const firstKey = focusCache.keys().next().value;
      if (firstKey !== undefined) focusCache.delete(firstKey);
    }
  }
  return f;
}

// ── Squad weights — per role ────────────────────────────────────────────────

const SQUAD_TANK: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  heroDeadPenalty: 3.5,
  heroHp: 1.3,        // tank lives → squad lives
  enemyHp: 1.1,
  drift: 0.8,         // tank leads the line
  cohesion: 0.35,
  enemyHero: 0.6,
};

const SQUAD_FIGHTER: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  heroDeadPenalty: 3.0,
  heroHp: 1.0,
  enemyHp: 1.4,       // fighter is the killer — heavy enemy-HP weight rewards finishing
  drift: 0.6,
  cohesion: 0.25,
  enemyHero: 1.0,
};

const SQUAD_RANGED: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  heroDeadPenalty: 3.5,
  heroHp: 1.4,        // squishy — survive at all costs
  enemyHp: 1.3,
  drift: -0.2,        // negative drift = prefer distance (kite)
  cohesion: 0.2,      // looser leash
  enemyHero: 0.9,
};

// ── Raid weights — boss is THE threat ───────────────────────────────────────

// Raid: the boss IS the win condition. Crank enemyHero so the 300HP boss dwarfs
// the minions in the concave-sqrt enemy-HP eval. Cohesion left at SQUAD_* defaults
// — empirically lower cohesion + spread regressed by 3 pts in boss-only testing.
const RAID_TANK: EvalWeights = {
  ...SQUAD_TANK,
  enemyHero: 4.0,
  drift: 1.0,
  cohesion: 0.4,
};
const RAID_FIGHTER: EvalWeights = {
  ...SQUAD_FIGHTER,
  enemyHero: 5.0,
  enemyHp: 1.4,
  drift: 0.7,
};
const RAID_RANGED: EvalWeights = {
  ...SQUAD_RANGED,
  enemyHero: 5.5,
  drift: -0.25,
  enemyHp: 1.3,
};

function makeController(weights: EvalWeights, maxSteps = 5): HeroController {
  return (ctx) => {
    const focus = getOrPickFocus(ctx.state, ctx.heroId);
    const result = buildHeroTurn(
      ctx.state, ctx.heroId, ctx.deadlineMs, maxSteps, weights, focus,
      /* beamWidth */ 10, /* finalists */ 16,
      /* useRolloutDuringSearch */ false,
      /* useAdversarialFinal */ true,  // squad/raid: plan against the worst-case enemy reply
    );
    return result.plan;
  };
}

export function makeSquadControllers(_label: string) {
  return {
    tank: makeController(SQUAD_TANK),
    fighter: makeController(SQUAD_FIGHTER),
    ranged: makeController(SQUAD_RANGED),
  };
}

export function makeRaidControllers(_label: string) {
  return {
    tank: makeController(RAID_TANK),
    fighter: makeController(RAID_FIGHTER),
    ranged: makeController(RAID_RANGED),
  };
}
