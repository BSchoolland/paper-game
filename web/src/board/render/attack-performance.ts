import type { AttackAbility, Entity, GridState, Vec2 } from "shared";
import { ShapeKind, add, normalize, length as vecLength, raycast, scale } from "shared";

/**
 * The motion plan for one attack "performance": anticipation (pull away / coil / crouch) →
 * hold (tension shiver) → strike (lunge or projectile flight) → contact → recover.
 *
 * The plan is the single source of truth for WHEN an attack lands: the entity animator plays
 * the motion from it and the defend prompt centers its press window on `contactMs`. Time-to-
 * impact is encoded in movement — a body or projectile physically closing distance — so the
 * player can track the beat instead of reacting to an invisible timer.
 */
export type PerformanceKind = "sector" | "rectangle" | "nova" | "lob" | "point";

export interface AttackPlan {
  kind: PerformanceKind;
  anticipationMs: number;
  holdMs: number;
  strikeMs: number;
  recoverMs: number;
  /** anticipation + hold + strike — the swing lands: flash fires, the shockwave launches. */
  swingMs: number;
  /** Shockwave travel from the swing to the contact point (0 when the swing IS the impact). */
  waveMs: number;
  /** swingMs + waveMs — the impact instant the defend window centers on. */
  contactMs: number;
  totalMs: number;
  /** Offset from rest at the deepest point of the wind-up (world units, opposite the aim). */
  backoff: Vec2;
  /** Offset from rest at the lunge apex (toward the aim). Zero for nova/lob/point. */
  lunge: Vec2;
  /** Projectile flight (lob arcs, point flies straight); null for body strikes. */
  projectile: { from: Vec2; to: Vec2; arc: boolean } | null;
  /** Starting radius of the converging telegraph ring (nova only). */
  ringRadius: number;
  /** Shockwave ground speed (world units per ms) and full drawing reach (sector/rectangle). */
  waveSpeed: number;
  waveReach: number;
}

/** Ground speeds that make flight time read naturally at combat scale. */
const LOB_SPEED = 0.26; // world units per ms
const POINT_SPEED = 0.6;
const WAVE_SPEED = 0.28;

function kindOf(ability: AttackAbility): PerformanceKind {
  switch (ability.shape.kind) {
    case ShapeKind.Sector:
      return "sector";
    case ShapeKind.Rectangle:
      return "rectangle";
    case ShapeKind.Circle:
      return ability.shape.range === 0 ? "nova" : "lob";
    case ShapeKind.Point:
      return "point";
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Plan an attack performance. `brief` is for the local party's own attacks — the player already
 * paid their timing cost in the attack timing bar, so a long wind-up would read as input lag.
 * `targetPos` (a defending target) times the sector/rectangle shockwave's contact beat to the
 * wave physically reaching that target; without it the wave times to the shape's full reach.
 */
export function planAttack(
  ability: AttackAbility,
  attackerPos: Vec2,
  aim: Vec2,
  entities: ReadonlyMap<string, Entity>,
  grid: GridState,
  attackerId: string,
  opts?: { brief?: boolean; targetPos?: Vec2 },
): AttackPlan {
  const kind = kindOf(ability);
  const brief = opts?.brief ?? false;
  const dir = vecLength(aim) > 0.001 ? normalize(aim) : { x: 1, y: 0 };

  // Damage is the weight class: heavier hits rear back longer.
  const anticipationMs = brief ? 140 : clamp(380 + ability.damage * 14, 380, 900);
  const holdMs = brief ? 60 : 150;
  const recoverMs = 180;

  let strikeMs: number;
  let backoff: Vec2 = { x: 0, y: 0 };
  let lunge: Vec2 = { x: 0, y: 0 };
  let projectile: AttackPlan["projectile"] = null;
  let ringRadius = 0;
  let waveReach = 0;

  switch (kind) {
    case "sector": {
      strikeMs = 150;
      backoff = scale(dir, -14);
      lunge = scale(dir, 16);
      waveReach = ability.shape.kind === ShapeKind.Sector ? ability.shape.radius : 60;
      break;
    }
    case "rectangle": {
      strikeMs = 115;
      backoff = scale(dir, -18);
      lunge = scale(dir, 12);
      waveReach = ability.shape.kind === ShapeKind.Rectangle ? ability.shape.length : 80;
      break;
    }
    case "nova": {
      strikeMs = 100;
      ringRadius = ability.shape.kind === ShapeKind.Circle ? ability.shape.radius : 60;
      break;
    }
    case "lob": {
      const range = ability.shape.kind === ShapeKind.Circle ? ability.shape.range : 0;
      const dist = Math.min(vecLength(aim), range);
      const to = add(attackerPos, scale(dir, dist));
      strikeMs = clamp(dist / LOB_SPEED, 400, 1100);
      backoff = scale(dir, -10);
      projectile = { from: { ...attackerPos }, to, arc: true };
      break;
    }
    case "point": {
      const range = ability.shape.kind === ShapeKind.Point ? ability.shape.range : 200;
      const result = raycast(attackerPos, dir, range, entities, grid, attackerId, ability.ignoreCoverRange);
      const dist = Math.max(20, vecLength({ x: result.endPoint.x - attackerPos.x, y: result.endPoint.y - attackerPos.y }));
      strikeMs = clamp(dist / POINT_SPEED, 180, 550);
      backoff = scale(dir, -8);
      projectile = { from: { ...attackerPos }, to: { x: result.endPoint.x, y: result.endPoint.y }, arc: false };
      break;
    }
  }

  const swingMs = anticipationMs + holdMs + strikeMs;
  // The swing launches a shockwave; the block beat is the wave physically arriving at the target.
  // The wave always DRAWS out to the shape's full reach — only the contact beat is target-timed.
  let waveMs = 0;
  let waveFullMs = 0;
  if (waveReach > 0) {
    // +40 world units: the comet tail burns out past the shape's edge after the front stops.
    waveFullMs = (waveReach + 40) / WAVE_SPEED;
    const dist = opts?.targetPos
      ? clamp(vecLength({ x: opts.targetPos.x - attackerPos.x, y: opts.targetPos.y - attackerPos.y }), 12, waveReach)
      : waveReach;
    waveMs = dist / WAVE_SPEED;
  }
  const contactMs = swingMs + waveMs;
  return {
    kind,
    anticipationMs,
    holdMs,
    strikeMs,
    recoverMs,
    swingMs,
    waveMs,
    contactMs,
    totalMs: Math.max(swingMs + waveFullMs, swingMs + recoverMs, contactMs) + 60,
    backoff,
    lunge,
    projectile,
    ringRadius,
    waveSpeed: WAVE_SPEED,
    waveReach,
  };
}
