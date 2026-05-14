/**
 * Solo controller: random ability set, no teammates, no scripted allies. Survive as deep
 * into the ladder as possible.
 *
 * Strategy: classify the kit (melee-heavy / ranged-heavy / mixed-AoE) and pick weights
 * tuned for that archetype. Everything still runs through buildHeroTurn — the eval just
 * shifts emphasis (e.g., higher drift for melee, lower for ranged so it kites).
 */
import type { AbilityDefinition, AttackAbility } from "../../../shared/src/index.js";
import { ShapeKind } from "../../../shared/src/core/types.js";
import type { HeroController } from "../../src/types.js";
import { DEFAULT_WEIGHTS, buildHeroTurn, type EvalWeights } from "./shared.js";

type Archetype = "melee" | "ranged" | "aoe" | "mixed";

function isMelee(a: AttackAbility): boolean {
  const s = a.shape;
  if (s.kind === ShapeKind.Point) return false;
  if (s.kind === ShapeKind.Circle && s.range > 100) return false;
  return true;
}
function isRanged(a: AttackAbility): boolean {
  const s = a.shape;
  if (s.kind === ShapeKind.Point) return true;
  if (s.kind === ShapeKind.Circle && s.range > 100) return true;
  return false;
}
function isAoE(a: AttackAbility): boolean {
  const s = a.shape;
  if (s.kind === ShapeKind.Circle) return true;
  if (s.kind === ShapeKind.Sector && s.halfAngle >= Math.PI / 3) return true;
  return false;
}

function classify(abilities: AbilityDefinition[]): Archetype {
  const atks = abilities.filter(a => a.kind === "attack") as AttackAbility[];
  const m = atks.filter(isMelee).length;
  const r = atks.filter(isRanged).length;
  const aoe = atks.filter(isAoE).length;
  if (r >= 2 && r > m) return "ranged";
  if (aoe >= 2) return "aoe";
  if (m >= 2 && r === 0) return "melee";
  return "mixed";
}

function weightsFor(arch: Archetype): EvalWeights {
  switch (arch) {
    case "ranged": return {
      ...DEFAULT_WEIGHTS,
      heroDeadPenalty: 4.0,
      heroHp: 1.6,
      drift: -0.05,          // mild kite (negative drift = prefer distance)
      enemyHp: 1.1,
      enemyHero: 0.6,
      enemyCluster: 0.35,    // long-range AoE wants clustered foes
      ourAliveCount: 0.2,
    };
    case "melee": return {
      ...DEFAULT_WEIGHTS,
      heroDeadPenalty: 3.5,
      heroHp: 1.2,
      drift: 0.8,
      enemyHp: 1.3,
      enemyAliveCount: 0.6,
      enemyCluster: 0.4,     // sectors/rects multi-hit when foes bunch
    };
    case "aoe": return {
      ...DEFAULT_WEIGHTS,
      heroDeadPenalty: 3.5,
      heroHp: 1.3,
      drift: 0.5,
      enemyHp: 1.5,
      enemyAliveCount: 0.7,
      enemyCluster: 0.6,     // the AoE archetype's whole job
    };
    case "mixed": return {
      ...DEFAULT_WEIGHTS,
      heroDeadPenalty: 3.5,
      heroHp: 1.3,
      drift: 0.45,
      enemyHp: 1.2,
      enemyCluster: 0.35,
    };
  }
}

export function makeSoloController(abilities: AbilityDefinition[]): HeroController {
  const arch = classify(abilities);
  const weights = weightsFor(arch);
  return (ctx) => {
    // Solo: rollout eval at every candidate (more accurate); narrower beam to fit.
    const result = buildHeroTurn(
      ctx.state, ctx.heroId, ctx.deadlineMs,
      5, weights, null,
      /* beamWidth */ 4, /* finalists */ 6,
      /* useRolloutDuringSearch */ true,
    );
    return result.plan;
  };
}
