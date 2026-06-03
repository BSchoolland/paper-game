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

/** The map for an encounter is one of two sources, never both. */
export type EncounterMapSource =
  | { readonly kind: "image"; readonly mapImage: string; readonly maskImage?: string }
  | { readonly kind: "structures"; readonly structures: readonly MapObjectPlacement[] };

export interface GeneratedEncounter {
  readonly enemies: readonly UnitTemplate[];
  readonly map: EncounterMapSource;
}

/**
 * Pick a pre-generated map for this encounter type, deterministic per hex.
 * Returns {} when the dimension has no maps for the type (legacy fallback).
 */
export function selectMap(
  hexType: EncounterType,
  dimension: Dimension,
  x: number,
  y: number
): { mapImage?: string; maskImage?: string } {
  const pool = dimension.maps?.[hexType];
  if (!pool || pool.length === 0) return {};
  const rng = Rng.seeded(x, y);
  const mapImage = pool[Math.floor(rng.next() * pool.length)]!;
  // Only claim a mask when the dimension actually has masks for this type
  // (maps can be generated without collision via --no-collision).
  const hasMasks = (dimension.masks?.[hexType]?.length ?? 0) > 0;
  const maskImage = hasMasks ? mapImage.replace(/\.png$/i, ".mask.png") : undefined;
  return { mapImage, maskImage };
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

  // One map source, chosen here: a pre-generated single image when the dimension
  // has maps for this type, otherwise the legacy structure roll.
  const { mapImage, maskImage } = selectMap(hexType, dimension, x, y);
  const map: EncounterMapSource = mapImage
    ? { kind: "image", mapImage, maskImage }
    : { kind: "structures", structures: rollStructures(dimension.structures, profile, layoutRng) };

  return { enemies, map };
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
  const maxIndex = pool.reduce((m, s) => Math.max(m, s.index), 0) || 1;

  const picks: StructureEntry[] = [];
  let budgetRemaining = profile.structureBudget;

  const affordable = () => pool.filter((s) => s.cost <= budgetRemaining);

  let candidates = affordable();
  while (candidates.length > 0) {
    const weights = candidates.map((s) => structureWeight(s.index, maxIndex, style));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * totalWeight;
    let picked = candidates[0]!;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) { picked = candidates[i]!; break; }
    }
    picks.push(picked);
    budgetRemaining -= picked.cost;
    candidates = affordable();
  }

  return placeObjects(
    picks.map((e) => ({ name: e.name, scale: e.scale })),
    800,
    600,
    rng
  );
}

function structureWeight(
  index: number,
  maxIndex: number,
  style: EncounterProfile["structureStyle"]
): number {
  const t = maxIndex > 0 ? index / maxIndex : 0.5;
  switch (style) {
    case "natural":
      return 1 + 3 * (1 - t);
    case "fortified":
    case "arena":
      return 1 + 3 * t;
    case "ruins":
      return 1;
  }
}
