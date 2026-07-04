import type { StatusEffectType } from "../core/types.js";

/**
 * THE defense policy. Every rule for how a block modifies a hit lives in this file:
 * the damage multiplier per tier, and — for every other consequence a hit can carry —
 * the answer to "does a guard stop this, or does it take a parry?"
 *
 * Load-bearing invariant (do not break): a target's outcome depends ONLY on its own
 * entry in the defense map. The client predicts a defended hit frame-perfectly by
 * dry-running the resolver with just its own multiplier — cross-target coupling would
 * silently desync that prediction.
 */
export type DefenseTier = "perfect" | "decent" | "none";

/** Minimum defense that fully stops a consequence: "guard" = any successful block
 *  (guard or parry) stops it; "parry" = only a perfect parry does. */
export type BlockRequirement = "guard" | "parry";

/** Everything a hit can do to you besides raw damage. */
export type HitConsequence = "knockback" | "pull" | StatusEffectType;

export const DEFENSE_POLICY: {
  readonly damageMult: Record<DefenseTier, number>;
  readonly stops: Record<HitConsequence, BlockRequirement>;
} = {
  // A guard halves the damage — a round, legible number the HP bar visibly reflects.
  damageMult: { none: 1, decent: 0.5, perfect: 0 },
  // Blocking plants your feet (all displacement stops at a guard), but status payloads
  // seep through a shield — deflecting them entirely is the parry's reward.
  stops: {
    knockback: "guard",
    pull: "guard",
    slowed: "parry",
    winded: "parry",
    suppressed: "parry",
    rooted: "parry",
  },
};

export function tierFromMultiplier(defenseMult: number): DefenseTier {
  if (defenseMult <= 0) return "perfect";
  if (defenseMult < 1) return "decent";
  return "none";
}

/** Does this consequence still land through the given defense? */
export function consequenceApplies(consequence: HitConsequence, defenseMult: number): boolean {
  const tier = tierFromMultiplier(defenseMult);
  if (tier === "none") return true; // no block — everything lands
  if (tier === "perfect") return false; // parry — nothing lands
  // Guard: only consequences that demand a parry still get through.
  return DEFENSE_POLICY.stops[consequence] === "parry";
}
