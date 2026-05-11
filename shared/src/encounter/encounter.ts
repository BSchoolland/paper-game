import type { EnemyTag, UnitTemplate } from "../core/types.js";
import type { Dimension, StructureEntry } from "./dimension.js";
import type { MapObjectPlacement } from "../map/map-definition.js";
import { placeObjects } from "../map/map-definition.js";
import { Rng } from "../core/rng.js";
import type { EncounterProfile, EncounterType } from "./encounter-profiles.js";
import { getEncounterProfile } from "./encounter-profiles.js";

export type { EncounterProfile, EncounterType };
export { getEncounterProfile };

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
  dimension: Dimension,
  x: number,
  y: number,
  runId: number
): GeneratedEncounter {
  const profile = getEncounterProfile(hexType);
  const layoutRng = Rng.seeded(x, y);
  const enemyRng = Rng.perRun(runId, x, y);

  const enemies = rollEnemies(dimension.enemies, profile, enemyRng);
  const structures = rollStructures(dimension.structures, profile, layoutRng);

  return { enemies, structures };
}

function rollEnemies(
  pool: readonly UnitTemplate[],
  profile: EncounterProfile,
  rng: Rng
): UnitTemplate[] {
  if (pool.length === 0) return [];

  const result: UnitTemplate[] = [];
  let budgetRemaining = profile.enemyBudget;

  const affordable = () => pool.filter((e) => (e.cost ?? 1) <= budgetRemaining);

  let candidates = affordable();
  while (candidates.length > 0) {
    const weights = candidates.map((e) => scoreEnemy(e, profile.tagWeights));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const roll = rng.next() * totalWeight;

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
  rng: Rng
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
    const idx = Math.floor(rng.next() * candidates.length);
    const entry = candidates[idx]!;
    picks.push(entry);
    budgetRemaining -= entry.cost;
    candidates = affordable();
  }

  return placeObjects(
    picks.map((e) => ({ name: e.name, category: e.category, scale: e.scale })),
    800,
    600,
    rng
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
