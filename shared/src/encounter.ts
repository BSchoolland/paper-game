import type { EnemyTag, UnitTemplate } from "./types.js";
import type { HexIconType } from "./hex-map.js";
import type { Biome, StructureEntry } from "./biome.js";
import type { MapObjectPlacement } from "./map-definition.js";
import { seededRandom, placeObjects } from "./map-definition.js";

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
  "enemy-camp": {
    enemyBudget: 24,
    tagWeights: { melee: 3, ranged: 2 },
    structureBudget: 30,
    structureStyle: "natural",
  },
  "ruins": {
    enemyBudget: 14,
    tagWeights: { tank: 3, swarm: 2 },
    structureBudget: 40,
    structureStyle: "ruins",
  },
  "treasure": {
    enemyBudget: 10,
    tagWeights: { swarm: 3, ranged: 1 },
    structureBudget: 12,
    structureStyle: "natural",
  },
  "town": {
    enemyBudget: 8,
    tagWeights: { melee: 2, ranged: 1 },
    structureBudget: 20,
    structureStyle: "fortified",
  },
  "elite-encounter": {
    enemyBudget: 40,
    tagWeights: { elite: 4, melee: 2, tank: 1 },
    structureBudget: 18,
    structureStyle: "arena",
  },
  "gateway": {
    enemyBudget: 16,
    tagWeights: { tank: 3, melee: 2, ranged: 1 },
    structureBudget: 22,
    structureStyle: "fortified",
  },
  "great-ruins": {
    enemyBudget: 22,
    tagWeights: { elite: 3, tank: 2, swarm: 2 },
    structureBudget: 30,
    structureStyle: "ruins",
  },
  "city": {
    enemyBudget: 18,
    tagWeights: { ranged: 3, tank: 2, melee: 1 },
    structureBudget: 28,
    structureStyle: "fortified",
  },
  "gateway-city": {
    enemyBudget: 22,
    tagWeights: { tank: 3, elite: 2, ranged: 2 },
    structureBudget: 30,
    structureStyle: "fortified",
  },
  "great-treasure": {
    enemyBudget: 18,
    tagWeights: { elite: 3, ranged: 2, swarm: 1 },
    structureBudget: 15,
    structureStyle: "natural",
  },
  "boss": {
    enemyBudget: 56,
    tagWeights: { boss: 5, melee: 1, swarm: 1 },
    structureBudget: 20,
    structureStyle: "arena",
  },
  "calamity": {
    enemyBudget: 100,
    tagWeights: { boss: 4, elite: 3, tank: 2 },
    structureBudget: 10,
    structureStyle: "arena",
  },
  "dense-wilderness": {
    enemyBudget: 8,
    tagWeights: { swarm: 3, melee: 2 },
    structureBudget: 42,
    structureStyle: "natural",
  },
};

export function getEncounterProfile(type: EncounterType): EncounterProfile {
  return ENCOUNTER_PROFILES[type];
}

function scoreEnemy(
  template: UnitTemplate,
  tagWeights: Partial<Record<EnemyTag, number>>
): number {
  const tags = template.tags ?? [];
  let score = 1;
  for (const tag of tags) {
    score += tagWeights[tag] ?? 0;
  }
  return score;
}

export interface GeneratedEncounter {
  readonly enemies: readonly UnitTemplate[];
  readonly structures: readonly MapObjectPlacement[];
}

export function generateEncounter(
  hexType: EncounterType,
  biome: Biome,
  seed: number
): GeneratedEncounter {
  const profile = getEncounterProfile(hexType);
  const rand = seededRandom(seed);

  const enemies = rollEnemies(biome.enemies, profile, rand);
  const structures = rollStructures(biome.structures, profile, rand);

  return { enemies, structures };
}

function rollEnemies(
  pool: readonly UnitTemplate[],
  profile: EncounterProfile,
  rand: () => number
): UnitTemplate[] {
  if (pool.length === 0) return [];

  const result: UnitTemplate[] = [];
  let budgetRemaining = profile.enemyBudget;

  const affordable = () => pool.filter((e) => (e.cost ?? 1) <= budgetRemaining);

  let candidates = affordable();
  while (candidates.length > 0) {
    const weights = candidates.map((e) => scoreEnemy(e, profile.tagWeights));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const roll = rand() * totalWeight;

    let acc = 0;
    let picked = candidates[0]!;
    for (let i = 0; i < candidates.length; i++) {
      acc += weights[i]!;
      if (roll < acc) {
        picked = candidates[i]!;
        break;
      }
    }

    result.push(picked);
    budgetRemaining -= picked.cost ?? 1;
    candidates = affordable();
  }

  return result;
}

function rollStructures(
  pool: readonly StructureEntry[],
  profile: EncounterProfile,
  rand: () => number
): MapObjectPlacement[] {
  if (pool.length === 0) return [];

  const style = profile.structureStyle;
  const filtered = filterStructuresByStyle(pool, style);
  if (filtered.length === 0) return [];

  const picks: StructureEntry[] = [];
  let budgetRemaining = profile.structureBudget;

  const affordable = () => filtered.filter((s) => s.cost <= budgetRemaining);

  let candidates = affordable();
  while (candidates.length > 0) {
    const idx = Math.floor(rand() * candidates.length);
    const entry = candidates[idx]!;
    picks.push(entry);
    budgetRemaining -= entry.cost;
    candidates = affordable();
  }

  return placeObjects(
    picks.map((e) => ({ name: e.name, category: e.category, scale: e.scale })),
    800,
    600,
    rand
  );
}

function filterStructuresByStyle(
  pool: readonly StructureEntry[],
  style: EncounterProfile["structureStyle"]
): StructureEntry[] {
  switch (style) {
    case "natural":
      return pool.filter((s) => s.category === "decoration");
    case "ruins":
      return pool.filter(
        (s) =>
          s.name.includes("ruins") ||
          s.name.includes("rock") ||
          s.name.includes("stone") ||
          s.category === "wall"
      );
    case "fortified":
      return pool.filter(
        (s) => s.category === "wall" || s.name.includes("stone")
      );
    case "arena":
      return pool.filter(
        (s) =>
          s.category === "wall" &&
          (s.name.includes("enclosure") ||
            s.name.includes("u-shape") ||
            s.name.includes("long"))
      );
  }
}
