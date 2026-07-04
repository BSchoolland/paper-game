/**
 * Encounter difficulty scaling (docs/meta-loop/05-difficulty.md).
 * effective budget = base profile budget × tier mult × distance mult × party-size mult.
 * Inputs are dimension tier, hex distance from origin, and party size — NEVER account level
 * (progression.ts's zero-combat-stats rule; this module must not import progression.ts).
 */

export interface EncounterScaling {
  /** Room.dimensionTier (04). null = unplaced dev-override dimension → scales as tier 0. */
  readonly dimensionTier: number | null;
  /** hexDistance(encounter hex, ORIGIN). Every dimension's origin is (0,0). */
  readonly distanceFromOrigin: number;
  /** Hero count = the humans who started (empty seats are dropped, never bot-filled). Valid: 1 | 2 | 3 | 4. */
  readonly partySize: number;
}

// --- Tunables (flag #1, §5 table) ---
export const TIER_BUDGET_RATE = 0.4;          // +40% budget per dimension tier
export const DISTANCE_GRACE_RADIUS = 2;       // hexes from origin with no distance scaling
export const DISTANCE_BUDGET_RATE = 0.07;     // +7% per hex beyond the grace radius
export const DISTANCE_BUDGET_MULT_CAP = 2.5;  // distance can at most 2.5× a fight
export const PARTY_SIZE_BUDGET_MULT: Readonly<Record<number, number>> = {
  1: 0.8,   // solo: one hero below the 2-player anchor, same +0.2/hero slope
  2: 1.0,   // anchor: the dominant live configuration — near-origin dim 0 stays as today
  3: 1.2,
  4: 1.4,
};
export const MAX_ENCOUNTER_ENEMIES = 12;      // hard composition ceiling (flag #10)

/** Multiplier-identity scaling: reproduces pre-feature-5 budgets exactly (balance tooling). */
export const BASELINE_SCALING: EncounterScaling = {
  dimensionTier: 0,
  distanceFromOrigin: 0,
  partySize: 2,
};

/** 04 §10 / 03's effectiveStartingTier rule, applied to encounter scaling (flag #4). */
export function effectiveTier(dimensionTier: number | null): number {
  return dimensionTier ?? 0;
}

export function tierBudgetMult(dimensionTier: number | null): number {
  return 1 + TIER_BUDGET_RATE * effectiveTier(dimensionTier);
}

export function distanceBudgetMult(distanceFromOrigin: number): number {
  const scaled = Math.max(0, distanceFromOrigin - DISTANCE_GRACE_RADIUS);
  return Math.min(DISTANCE_BUDGET_MULT_CAP, 1 + DISTANCE_BUDGET_RATE * scaled);
}

export function partySizeBudgetMult(partySize: number): number {
  const mult = PARTY_SIZE_BUDGET_MULT[partySize];
  if (mult === undefined) throw new Error(`partySizeBudgetMult: no multiplier for party size ${partySize}`);
  return mult;
}

export function effectiveEnemyBudget(baseBudget: number, s: EncounterScaling): number {
  return Math.round(
    baseBudget *
      tierBudgetMult(s.dimensionTier) *
      distanceBudgetMult(s.distanceFromOrigin) *
      partySizeBudgetMult(s.partySize),
  );
}

/** Reward scaling (flag #6): tier × distance only — party size never scales XP. Used by
 *  recordEncounterWon (encounter XP) and settleRun (contract reward, distance 0). */
export function scaledXp(base: number, dimensionTier: number | null, distanceFromOrigin: number): number {
  return Math.round(base * tierBudgetMult(dimensionTier) * distanceBudgetMult(distanceFromOrigin));
}

/** The HUD threat readout (§6.2): how much harder than baseline fights are HERE. */
export function threatMultiplier(dimensionTier: number | null, distanceFromOrigin: number): number {
  return tierBudgetMult(dimensionTier) * distanceBudgetMult(distanceFromOrigin);
}
