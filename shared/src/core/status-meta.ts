import type { StatusEffectType } from "./types.js";

/** Which banked energy pool a status drains the regen of, if any. */
export type EnergyPoolName = "red" | "blue";

export interface StatusMeta {
  /** Human-facing name, e.g. for floating combat text and tooltips. */
  readonly label: string;
  /** Pip / floating-text colour (0xRRGGBB). */
  readonly color: number;
  /** Short description of the magnitude, given the status's `value`. */
  readonly describe: (value: number) => string;
  /**
   * If set, while the status is active the owner's start-of-turn regen for this
   * pool is reduced by the status's `value` (floored at 0).
   */
  readonly regenPenalty?: EnergyPoolName;
}

// In this game attack abilities are paid from the `red` pool and movement from `blue`.
export const STATUS_META: Record<StatusEffectType, StatusMeta> = {
  slowed: {
    label: "Slowed",
    color: 0x5b9bd5,
    describe: (v) => `-${Math.round(v * 100)}% move range`,
  },
  winded: {
    label: "Winded",
    color: 0x2e86c1,
    describe: (v) => `-${v} move energy / turn`,
    regenPenalty: "blue",
  },
  suppressed: {
    label: "Suppressed",
    color: 0xc0392b,
    describe: (v) => `-${v} attack energy / turn`,
    regenPenalty: "red",
  },
  rooted: {
    label: "Rooted",
    color: 0x6b4f2a,
    describe: () => "cannot move",
  },
};
