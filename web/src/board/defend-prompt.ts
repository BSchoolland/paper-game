import type { AimDirection, AttackAbility, Vec2 } from "shared";
import type { ClientState } from "./client-state.svelte.js";
import type { GameRenderer } from "./render/game-renderer.js";
import { blockInput } from "./block-input.js";

/**
 * Defense prompt for a single incoming attack: HOLD to guard, TAP at contact to parry.
 *
 * The clock is the attacker's performance (attack-performance.ts): wind-up → tension → strike,
 * with the plan's `contactMs` as the impact instant — a body lunging or a projectile arriving,
 * so the beat is readable as motion. The verdict is the input STATE at that instant:
 *
 *   key pressed within the tap window around contact  → parry  (power 1, negates everything)
 *   key held down at contact (pressed any time before) → guard  (power 0.5, half damage, no shove)
 *   key up at contact                                  → hit    (power 0)
 *
 * There is no "late block" rule to learn — you either were blocking when it landed or you
 * weren't. A slightly-early parry attempt degrades to a guard as long as the key stays held,
 * so the safe play (hold early) and the greedy play (tap at the last instant) form a smooth
 * skill ramp. Every outcome, including no input at all, is decidable within TAP_AFTER_MS of
 * the impact frame.
 */
const TAP_BEFORE_MS = 50;
const TAP_AFTER_MS = 33;
// Only if the performance can't start (combat not mounted) — a plain fixed windup.
const FALLBACK_WINDUP_MS = 700;

export interface DefendPromptInput {
  promptId: string;
  attackerId: string;
  attackerPosition: Vec2;
  aimDirection: AimDirection;
  ability: AttackAbility;
  targetIds: string[];
}

export class DefendPrompt {
  private resolve: ((power: number) => void) | null = null;
  private impactTime = 0;
  private active = false;
  private animFrame = 0;

  constructor(private clientState: ClientState, private renderer: GameRenderer) {}

  run(input: DefendPromptInput): Promise<number> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.active = true;

      const incoming = {
        attackerId: input.attackerId,
        attackerPosition: input.attackerPosition,
        aimDirection: input.aimDirection,
        ability: input.ability,
      };
      this.clientState.setDefensePrompt(input.promptId, incoming, "windup", 0);

      // The attacker's motion is the clock: the swing launches a shockwave/projectile, and the
      // plan's contact beat — the moment it physically reaches MY hero — is the verdict frame.
      const plan = this.renderer.startIncomingAttackPerformance(
        input.attackerId,
        input.attackerPosition,
        input.aimDirection,
        input.ability,
        input.targetIds[0],
      );
      const windupMs = plan?.contactMs ?? FALLBACK_WINDUP_MS;

      const startTime = performance.now();
      this.impactTime = startTime + windupMs;

      // Pre-guard: the player may ALREADY be holding block from before this prompt opened
      // (bracing during the enemy's approach). The always-on tracker makes that count — an
      // old hold is a guard (its keydown is far outside the tap window, so never a parry).
      let heldSince: number | null = blockInput.heldSince();
      let lastTapAt: number | null = null; // most recent QUALIFYING tap time (survives release)
      let prevDownAt = heldSince ?? -Infinity; // any previous keydown, for the anti-mash rule
      let downAtImpact: boolean | null = null; // sampled once, at the first tick past impact

      if (heldSince !== null) {
        this.renderer.raiseGuard(input.targetIds, input.attackerPosition);
      }
      blockInput.setCapturing(true);

      const offDown = blockInput.onBlockDown((at) => {
        if (!this.active) return;
        heldSince = at;
        // Anti-mash: a keydown right after another one still guards (holding is holding),
        // but doesn't count as a tap — otherwise spamming lucks into parries.
        lastTapAt = at - prevDownAt < 250 ? null : at;
        prevDownAt = at;
        // Guard goes up the instant the input registers — the pose is the acknowledgment;
        // the verdict (label, flash, damage) waits for the impact frame.
        this.renderer.raiseGuard(input.targetIds, input.attackerPosition);
      });
      const offUp = blockInput.onBlockUp(() => {
        heldSince = null;
      });

      const cleanup = () => {
        blockInput.setCapturing(false);
        offDown();
        offUp();
      };

      const settle = (power: number) => {
        this.scheduleOutcome(input, power);
        cleanup();
        this.finish(power);
      };

      const tick = () => {
        if (!this.active) return;
        const now = performance.now();
        const elapsed = now - startTime;
        if (elapsed < windupMs) {
          this.clientState.setDefensePrompt(input.promptId, incoming, "windup", elapsed / windupMs);
        } else {
          this.clientState.setDefensePrompt(input.promptId, incoming, "window", Math.min(1, (elapsed - windupMs) / TAP_AFTER_MS));
        }

        if (now >= this.impactTime) {
          if (downAtImpact === null) downAtImpact = heldSince !== null;
          const tapped = lastTapAt !== null && lastTapAt >= this.impactTime - TAP_BEFORE_MS && lastTapAt <= this.impactTime + TAP_AFTER_MS;
          if (tapped) return settle(1);
          if (downAtImpact) return settle(0.5);
          // Key was up at contact — allow the tap window's tail before ruling it a miss.
          if (now > this.impactTime + TAP_AFTER_MS) return settle(0);
        }

        this.animFrame = requestAnimationFrame(tick);
      };
      this.animFrame = requestAnimationFrame(tick);
    });
  }

  /** Play the predicted outcome exactly on the impact frame: verdicts land at (or a tap-tail
   *  after) the impact, so this fires immediately. */
  private scheduleOutcome(input: DefendPromptInput, power: number): void {
    const untilImpact = Math.max(0, this.impactTime - performance.now());
    const fire = () => {
      for (const id of input.targetIds) {
        this.renderer.predictDefendOutcome(
          input.attackerId,
          input.attackerPosition,
          input.aimDirection,
          input.ability,
          id,
          power,
        );
      }
    };
    if (untilImpact === 0) fire();
    else setTimeout(fire, untilImpact);
  }

  /** Resolve IMMEDIATELY — every ms here delays the authoritative confirmation, and the
   *  local performance + predicted outcome already cover every visual. */
  private finish(power: number) {
    cancelAnimationFrame(this.animFrame);
    this.active = false;
    this.clientState.clearDefensePrompt();
    this.resolve?.(power);
    this.resolve = null;
  }
}
