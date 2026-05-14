import type { HeroController } from "../../src/types.js";
import type { MultiFormatAgent } from "../../src/t2/types.js";
import {
  makeVanguard, makeSoloVanguard,
  PVE_SQUAD_CONFIG, PVE_TANK_CONFIG, PVE_RANGED_CONFIG,
  FIGHTER_CONFIG,
  RAID_FIGHTER_CONFIG, RAID_TANK_CONFIG, RAID_RANGED_CONFIG,
  BOSS_CONFIG,
} from "./vanguard.js";

export const hero: HeroController = makeVanguard(FIGHTER_CONFIG);

export const agent: MultiFormatAgent = {
  name: "agent-04",
  solo: (abilities) => makeSoloVanguard(abilities),
  squad: {
    tank: makeVanguard(PVE_TANK_CONFIG),
    fighter: makeVanguard(PVE_SQUAD_CONFIG),
    ranged: makeVanguard(PVE_RANGED_CONFIG),
  },
  boss: makeVanguard(BOSS_CONFIG),
  raid: {
    tank: makeVanguard(RAID_TANK_CONFIG),
    fighter: makeVanguard(RAID_FIGHTER_CONFIG),
    ranged: makeVanguard(RAID_RANGED_CONFIG),
  },
};
