/**
 * agent-07 — "Concord".
 *
 * Identity: where everyone else runs three independent single-hero brains on the same turn,
 * Concord runs a single JOINT PLANNER across the whole squad. When the first hero in the
 * action order is invoked, we compute a coordinated plan for the entire squad (tank →
 * fighter → ranged), publish it via module-level state, and the later controllers just
 * execute their pre-assigned slice (re-verifying against the live state).
 *
 * Solo: kit-archetype classifier picks one of a few hand-tuned policies based on the
 * abilities drawn — beam search wastes 2s of budget on weird kits, a focused policy doesn't.
 *
 * Boss: positional brain that bullies raid heroes with knockback and stays near minions.
 * Raid: reuses the squad joint planner with the boss as priority target.
 */
import type { MultiFormatAgent } from "../../src/t2/types.js";
import { makeSquadControllers, makeRaidControllers } from "./squad.js";
import { makeSoloController } from "./solo.js";
import { bossController } from "./boss.js";

const squad = makeSquadControllers("squad");
const raid = makeRaidControllers("raid");

export const agent: MultiFormatAgent = {
  name: "agent-07",
  solo: (abilities) => makeSoloController(abilities),
  squad,
  boss: bossController,
  raid,
};

// Keep T1 `hero` export so the T1 harness/registry still works.
export { referenceHero as hero } from "../../src/reference-bot.js";
