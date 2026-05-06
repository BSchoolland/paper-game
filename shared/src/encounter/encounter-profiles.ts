import type { EnemyTag } from "../core/types.js";
import type { HexIconType } from "../map/hex-map.js";

export interface EncounterProfile {
  readonly enemyBudget: number;
  readonly tagWeights: Partial<Record<EnemyTag, number>>;
  readonly structureBudget: number;
  readonly structureStyle: "natural" | "ruins" | "fortified" | "arena";
}

export type EncounterType = HexIconType | "wilderness" | "dense-wilderness";

const ENCOUNTER_PROFILES: Record<EncounterType, EncounterProfile> = {
  "wilderness": {
    enemyBudget: 6,
    tagWeights: { swarm: 2, melee: 1 },
    structureBudget: 10,
    structureStyle: "natural",
  },
  "dense-wilderness": {
    enemyBudget: 8,
    tagWeights: { swarm: 3, melee: 2 },
    structureBudget: 42,
    structureStyle: "natural",
  },
  "enemy-camp": {
    enemyBudget: 18,
    tagWeights: { melee: 3, ranged: 2 },
    structureBudget: 30,
    structureStyle: "natural",
  },
  "elite-encounter": {
      enemyBudget: 25,
      tagWeights: { elite: 4, melee: 2, tank: 1 },
      structureBudget: 18,
      structureStyle: "arena",
  },
  "boss": {
    enemyBudget: 35,
    tagWeights: { boss: 5, melee: 1, swarm: 1 },
    structureBudget: 20,
    structureStyle: "arena",
  },
  "calamity": {
    enemyBudget: 50,
    tagWeights: { boss: 4, elite: 3, tank: 2 },
    structureBudget: 10,
    structureStyle: "arena",
  },
  "town": {
    enemyBudget: 8,
    tagWeights: { melee: 2, ranged: 1 },
    structureBudget: 20,
    structureStyle: "fortified",
  },
  "city": {
    enemyBudget: 16,
    tagWeights: { ranged: 3, tank: 2, melee: 1 },
    structureBudget: 28,
    structureStyle: "fortified",
  },
  "gateway-city": {
    enemyBudget: 16,
    tagWeights: { tank: 3, elite: 2, ranged: 2 },
    structureBudget: 30,
    structureStyle: "fortified",
  },
  "gateway": {
    enemyBudget: 16,
    tagWeights: { tank: 3, melee: 2, ranged: 1 },
    structureBudget: 22,
    structureStyle: "fortified",
  },
  "ruins": {
    enemyBudget: 12,
    tagWeights: { tank: 3, swarm: 2 },
    structureBudget: 40,
    structureStyle: "ruins",
  },
  "great-ruins": {
    enemyBudget: 18,
    tagWeights: { elite: 3, tank: 2, swarm: 2 },
    structureBudget: 30,
    structureStyle: "ruins",
  },
  "treasure": {
    enemyBudget: 10,
    tagWeights: { swarm: 3, ranged: 1 },
    structureBudget: 12,
    structureStyle: "natural",
  },
  "great-treasure": {
    enemyBudget: 18,
    tagWeights: { elite: 3, ranged: 2, swarm: 1 },
    structureBudget: 15,
    structureStyle: "natural",
  },
};

export function getEncounterProfile(type: EncounterType): EncounterProfile {
  return ENCOUNTER_PROFILES[type];
}
