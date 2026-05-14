import type { HeroController } from "../../src/types.js";
import type { MultiFormatAgent } from "../../src/t2/types.js";
import {
  directBoss, directRaid, duelCaptain, makeSoloCaptain,
  squadFighter, squadRanged, squadTank,
} from "./playbook.js";

/** T1 export. */
export const hero: HeroController = duelCaptain;

/** T2 export. */
export const agent: MultiFormatAgent = {
  name: "agent-08",
  solo: makeSoloCaptain,
  squad: { tank: squadTank, fighter: squadFighter, ranged: squadRanged },
  boss: directBoss,
  raid: directRaid,
};
