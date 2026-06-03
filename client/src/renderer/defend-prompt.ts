import type { AimDirection, AttackAbility, Vec2 } from "shared";
import { defenseTierFromPower } from "shared";
import type { ClientState } from "../state/client-state.js";
import type { GameRenderer } from "./game-renderer.js";
import { defenseLabel } from "./impact-labels.js";

/**
 * Defense prompt timing for a single incoming attack.
 *
 * Total sequence:
 *   0          → WINDUP_MS:        subtle preview shape grows in (telegraph)
 *   WINDUP_MS  → "impact" moment:  attacker swings, shape flashes — this is when you press
 *   WINDOW_MS centered on impact:  the press is timed against the impact instant
 *
 * Perfect zone is the PERFECT_WINDOW_MS centered on impact. Outside the perfect zone but inside
 * the window is a "decent" block. Missing the window entirely (or never pressing) is no block.
 */
const WINDUP_MS = 400;
const WINDOW_MS = 260;
// Tight Parry window — about 2 frames at 60Hz (≈33ms), 4 at 120Hz, 4–5 at 144Hz. The decent
// "Guard" zone fills the rest of WINDOW_MS, so casual play still blocks 33% damage; full
// negation requires hitting near the actual impact frame.
const PERFECT_WINDOW_MS = 33;
const RESULT_HOLD_MS = 250;

export interface DefendPromptInput {
  attackerId: string;
  attackerPosition: Vec2;
  aimDirection: AimDirection;
  ability: AttackAbility;
  targetIds: string[];
}

export class DefendPrompt {
  private resolve: ((power: number) => void) | null = null;
  private impactTime = 0;
  private pressed = false;
  private active = false;
  private animFrame = 0;

  constructor(private clientState: ClientState, private renderer: GameRenderer) {}

  run(input: DefendPromptInput): Promise<number> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.pressed = false;
      this.active = true;

      const incoming = {
        attackerId: input.attackerId,
        attackerPosition: input.attackerPosition,
        aimDirection: input.aimDirection,
        ability: input.ability,
      };
      this.clientState.setDefensePrompt(incoming, "windup", 0);

      const startTime = performance.now();
      this.impactTime = startTime + WINDUP_MS;
      let impactFired = false;

      const onPress = (e: KeyboardEvent | MouseEvent) => {
        if (this.pressed || !this.active) return;
        if (e instanceof KeyboardEvent && e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();

        this.pressed = true;

        const offset = performance.now() - this.impactTime; // negative = early, positive = late
        const half = WINDOW_MS / 2;
        let power: number;
        if (Math.abs(offset) > half) {
          power = 0;
        } else if (Math.abs(offset) <= PERFECT_WINDOW_MS / 2) {
          power = 1;
        } else {
          power = 0.5;
        }

        const tier = defenseTierFromPower(power);
        if (tier !== "none") {
          const label = defenseLabel(tier);
          for (const id of input.targetIds) {
            this.renderer.triggerLocalBlock(id, input.attackerPosition, tier);
            const entity = this.clientState.getState()?.entities.get(id);
            if (entity) {
              this.renderer.spawnFloatingText(entity.position.x, entity.position.y - 55, label.text, label.color, {
                fontSize: label.fontSize,
                lifetime: label.lifetime,
                strokeColor: label.strokeColor,
                strokeWidth: label.strokeWidth,
                fontWeight: label.fontWeight,
                fontFamily: label.fontFamily,
              });
            }
          }
        }

        cleanup();
        this.finish(power);
      };

      const cleanup = () => {
        document.removeEventListener("keydown", onPress);
        window.removeEventListener("mousedown", onPress, true);
      };

      document.addEventListener("keydown", onPress);
      window.addEventListener("mousedown", onPress, true);

      const tick = () => {
        if (!this.active) return;
        const now = performance.now();
        const elapsed = now - startTime;
        if (elapsed < WINDUP_MS) {
          this.clientState.setDefensePrompt(incoming, "windup", elapsed / WINDUP_MS);
        } else {
          this.clientState.setDefensePrompt(incoming, "window", Math.min(1, (elapsed - WINDUP_MS) / WINDOW_MS));
        }

        // At the end of the windup, kick off the actual swing + shape-flash visuals so the
        // press lands on the same beat as the attack itself.
        if (!impactFired && elapsed >= WINDUP_MS) {
          impactFired = true;
          this.renderer.previewIncomingAttack(
            input.attackerId,
            input.attackerPosition,
            input.aimDirection,
            input.ability,
          );
        }

        // Window closes; if no press, finish with 0.
        if (!this.pressed && elapsed >= WINDUP_MS + WINDOW_MS / 2) {
          cleanup();
          this.finish(0);
          return;
        }

        this.animFrame = requestAnimationFrame(tick);
      };
      this.animFrame = requestAnimationFrame(tick);
    });
  }

  private finish(power: number) {
    cancelAnimationFrame(this.animFrame);
    setTimeout(() => {
      this.active = false;
      this.clientState.clearDefensePrompt();
      this.resolve?.(power);
      this.resolve = null;
    }, RESULT_HOLD_MS);
  }
}
