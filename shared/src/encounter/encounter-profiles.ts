import type { HexIconType } from "../map/hex-map.js";
import type { ArchetypeId } from "./archetypes.js";

export interface EncounterProfile {
  readonly enemyBudget: number;   // BASE budget — scaled by effectiveEnemyBudget at roll time
  readonly archetypeWeights: Partial<Record<ArchetypeId, number>>;
  readonly structureBudget: number;
  readonly structureStyle: "natural" | "ruins" | "fortified" | "arena";
}

export type EncounterType = HexIconType | "wilderness" | "dense-wilderness";

const ENCOUNTER_PROFILES: Record<EncounterType, EncounterProfile> = {
  "wilderness": {
    enemyBudget: 6,
    archetypeWeights: { horde: 3, ambush: 2, warband: 1 },
    structureBudget: 30,
    structureStyle: "natural",
  },
  "dense-wilderness": {
    enemyBudget: 8,
    archetypeWeights: { horde: 3, ambush: 2, guardian: 1 },
    structureBudget: 60,
    structureStyle: "natural",
  },
  "enemy-camp": {
    enemyBudget: 18,
    archetypeWeights: { warband: 3, horde: 1, ambush: 1 },
    structureBudget: 40,
    structureStyle: "natural",
  },
  "elite-encounter": {
    enemyBudget: 25,
    archetypeWeights: { warband: 2, guardian: 2 },
    structureBudget: 30,
    structureStyle: "arena",
  },
  "boss": {
    enemyBudget: 35,
    archetypeWeights: { guardian: 1 },
    structureBudget: 20,
    structureStyle: "arena",
  },
  "calamity": {
    enemyBudget: 50,
    archetypeWeights: { guardian: 2, warband: 1 },
    structureBudget: 20,
    structureStyle: "arena",
  },
  "town": {
    enemyBudget: 8,
    archetypeWeights: { garrison: 1 },
    structureBudget: 30,
    structureStyle: "fortified",
  },
  "city": {
    enemyBudget: 16,
    archetypeWeights: { garrison: 1 },
    structureBudget: 50,
    structureStyle: "fortified",
  },
  "gateway-city": {
    enemyBudget: 16,
    archetypeWeights: { garrison: 1 },
    structureBudget: 60,
    structureStyle: "fortified",
  },
  "gateway": {
    enemyBudget: 16,
    archetypeWeights: { garrison: 2, warband: 1 },
    structureBudget: 40,
    structureStyle: "fortified",
  },
  "ruins": {
    enemyBudget: 12,
    archetypeWeights: { guardian: 1, ambush: 1, horde: 1 },
    structureBudget: 40,
    structureStyle: "ruins",
  },
  "great-ruins": {
    enemyBudget: 18,
    archetypeWeights: { guardian: 2, warband: 1 },
    structureBudget: 30,
    structureStyle: "ruins",
  },
  "treasure": {
    enemyBudget: 10,
    archetypeWeights: { horde: 2, ambush: 2 },
    structureBudget: 30,
    structureStyle: "natural",
  },
  "great-treasure": {
    enemyBudget: 18,
    archetypeWeights: { guardian: 2, ambush: 1 },
    structureBudget: 30,
    structureStyle: "natural",
  },
};

export function getEncounterProfile(type: EncounterType): EncounterProfile {
  return ENCOUNTER_PROFILES[type];
}
