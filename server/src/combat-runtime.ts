import type { CoopPhase } from "shared";

/**
 * The single combat-state value (the DISEASE A source of truth). It replaces the four-way scatter on
 * Room — coopPhase + phaseTransitioning + aiPlayerBusy + paused. `room.combat` is null off-combat;
 * room.phase still owns lobby/overworld/combat/gameover (the run-lifecycle axis). `activeTeam` stays
 * the pure resolver's concern; coopPhase is DERIVED here, never stored.
 */

/** Where we are inside one encounter — exactly one holds at a time. */
export type CombatStep =
  | { kind: "playerOpen" } // human turn accepting input (was coopPhase=player, !transitioning, !busy)
  | { kind: "playerBots" } // synchronous player-side bot burst in flight (was aiPlayerBusy)
  | { kind: "enemy" } // enemy sweep in flight (was coopPhase=enemy)
  | { kind: "defend" } // a defend round is open mid-burst; resumeAfterDefend says where to go back
  | { kind: "transition" }; // momentary: applying the player->enemy endTurn (was phaseTransitioning)

export interface CombatRuntime {
  step: CombatStep;
  /** The single pause axis: true when the scheduler is stopped because no human is connected. */
  suspended: boolean;
  /** When step==="defend", which sub-phase driveCombat resumes after the round resolves. Set at
   *  enterDefend time so a reclaim between prompt and resolve can't change which phase resumes. */
  resumeAfterDefend: "playerBots" | "enemy";
}

// --- transition constructors (pure; the side-effectful orchestration stays in room-machine.ts) ---
export function enterPlayerOpen(): CombatRuntime {
  return { step: { kind: "playerOpen" }, suspended: false, resumeAfterDefend: "enemy" };
}
export function enterPlayerBots(): CombatRuntime {
  return { step: { kind: "playerBots" }, suspended: false, resumeAfterDefend: "enemy" };
}
export function enterEnemy(): CombatRuntime {
  return { step: { kind: "enemy" }, suspended: false, resumeAfterDefend: "enemy" };
}
export function enterTransition(): CombatRuntime {
  return { step: { kind: "transition" }, suspended: false, resumeAfterDefend: "enemy" };
}
export function enterDefend(resume: "playerBots" | "enemy"): CombatRuntime {
  return { step: { kind: "defend" }, suspended: false, resumeAfterDefend: resume };
}

// --- derivations (the single readers; replace every read of the four legacy flags) ---
export function coopPhaseOf(rt: CombatRuntime | null): CoopPhase {
  if (!rt) return "player"; // off-combat default (lobby/overworld) — never the enemy side
  const enemySide = rt.step.kind === "enemy" || (rt.step.kind === "defend" && rt.resumeAfterDefend === "enemy");
  return enemySide ? "enemy" : "player";
}

/** A human may submit an action: the player turn is open and not suspended. */
export function isPlayerInputOpen(rt: CombatRuntime | null): boolean {
  return !!rt && rt.step.kind === "playerOpen" && !rt.suspended;
}

/** An AI burst/sweep/flip is in flight — block the player->enemy latch (was aiPlayerBusy||transitioning). */
export function isBusy(rt: CombatRuntime | null): boolean {
  return !!rt && (rt.step.kind === "playerBots" || rt.step.kind === "enemy" || rt.step.kind === "transition");
}

export function isSuspended(rt: CombatRuntime | null): boolean {
  return !!rt && rt.suspended;
}
