/**
 * Floating-text vocabulary for combat feedback. Each function returns a label spec sized,
 * colored, and worded to the moment. Style matches the game's aged-parchment / pencil-sketch
 * look: Georgia serif, warm earth palette, soft dark-brown outline instead of harsh black.
 */

export interface ImpactLabel {
  text: string;
  color: number;
  fontSize: number;
  lifetime: number;
  strokeColor: number;
  strokeWidth: number;
  fontWeight: "normal" | "bold";
  fontFamily: string;
}

// Cinzel — Roman/classical serif, fits the parchment world; falls back to serif while the
// Google Font is still loading.
const IMPACT_FONT = "'Cinzel', 'Trajan Pro', Georgia, serif";

const INK = 0x2a1a0c;       // dark walnut — softer outline than pure black
const PERFECT = 0xb8843a;   // warm amber
const GUARD = 0x5a6f88;     // muted slate blue
const PARRY = 0xc9a850;     // brighter warm gold

/** Power threshold for a "Perfect!" attack — tight enough to feel earned, loose enough to be
 *  achievable with practice (the player's actual peak hovers within ~1 frame of 1.0). */
export const PERFECT_ATTACK_THRESHOLD = 0.97;

/** Player attack quality, based on the 0..1 timing power. */
export function attackPowerLabel(power: number): ImpactLabel | null {
  if (power >= PERFECT_ATTACK_THRESHOLD) return { text: "Perfect!", color: PARRY, fontSize: 20, lifetime: 1.1, strokeColor: INK, strokeWidth: 1.4, fontWeight: "bold", fontFamily: IMPACT_FONT };
  if (power >= 0.9) return { text: "Crit", color: PERFECT, fontSize: 16, lifetime: 1.0, strokeColor: INK, strokeWidth: 1.2, fontWeight: "bold", fontFamily: IMPACT_FONT };
  return null;
}

/** Player defense quality, discrete by tier. */
export function defenseLabel(tier: "perfect" | "decent"): ImpactLabel {
  if (tier === "perfect") return { text: "Parry!", color: PARRY, fontSize: 18, lifetime: 1.1, strokeColor: INK, strokeWidth: 1.4, fontWeight: "bold", fontFamily: IMPACT_FONT };
  return                       { text: "Guard",  color: GUARD, fontSize: 13, lifetime: 0.9, strokeColor: INK, strokeWidth: 1.0, fontWeight: "bold", fontFamily: IMPACT_FONT };
}
