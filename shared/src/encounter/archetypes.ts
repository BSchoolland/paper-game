import type { EnemyTag, UnitTemplate } from "../core/types.js";
import type { Rng } from "../core/rng.js";

export type ArchetypeId = "horde" | "warband" | "guardian" | "ambush" | "garrison";

export interface ArchetypeSlot {
  /** Debug/flavor label; also the test handle for per-slot assertions. */
  readonly role: string;
  /** A template qualifies if it has ANY of these tags. Empty = any template qualifies. */
  readonly tags: readonly EnemyTag[];
  /** Fraction of the encounter's effective budget reserved for this slot (unspent rolls
   *  forward to the next slot; the final leftover is spent via `overflow`). */
  readonly budgetShare: number;
  readonly minCount: number;
  readonly maxCount: number;
  /** Cost bias for picks within the slot: heavy = weight ∝ cost², light = ∝ 1/cost, mid = 1. */
  readonly bias: "heavy" | "mid" | "light";
}

export interface EncounterArchetype {
  readonly id: ArchetypeId;
  readonly name: string;    // HUD/combat-banner display
  readonly flavor: string;  // combat-entry toast line
  readonly slots: readonly ArchetypeSlot[];
  /** After all slots, leftover budget is spent on these tags (light bias) up to the
   *  encounter's enemy ceiling — so big budgets are never silently discarded. */
  readonly overflow: readonly EnemyTag[];
}

export const ARCHETYPES: readonly EncounterArchetype[] = [
  {
    id: "horde",
    name: "Horde",
    flavor: "A horde swarms forth.",
    slots: [
      { role: "chaff",    tags: ["swarm", "melee"], budgetShare: 0.8, minCount: 3, maxCount: 12, bias: "light" },
      { role: "stingers", tags: ["ranged"],         budgetShare: 0.2, minCount: 0, maxCount: 2,  bias: "light" },
    ],
    overflow: ["swarm", "melee"],
  },
  {
    id: "warband",
    name: "Warband",
    flavor: "A warband bars the way.",
    slots: [
      { role: "leader",  tags: ["elite"],          budgetShare: 0.3,  minCount: 1, maxCount: 1, bias: "heavy" },
      { role: "line",    tags: ["melee", "tank"],  budgetShare: 0.45, minCount: 2, maxCount: 4, bias: "mid" },
      { role: "support", tags: ["ranged"],         budgetShare: 0.25, minCount: 1, maxCount: 2, bias: "mid" },
    ],
    overflow: ["melee"],
  },
  {
    id: "guardian",
    name: "Guardian",
    flavor: "Something ancient stirs to guard this place.",
    slots: [
      { role: "anchor",  tags: ["boss", "elite"],  budgetShare: 0.6, minCount: 1, maxCount: 1, bias: "heavy" },
      { role: "minions", tags: ["swarm", "melee"], budgetShare: 0.4, minCount: 2, maxCount: 5, bias: "light" },
    ],
    overflow: ["swarm", "melee"],
  },
  {
    id: "ambush",
    name: "Ambush",
    flavor: "An ambush springs from cover!",
    slots: [
      { role: "shooters", tags: ["ranged"],          budgetShare: 0.55, minCount: 2, maxCount: 4, bias: "mid" },
      { role: "blades",   tags: ["melee", "swarm"],  budgetShare: 0.45, minCount: 1, maxCount: 4, bias: "light" },
    ],
    overflow: ["ranged", "melee"],
  },
  {
    id: "garrison",
    name: "Garrison",
    flavor: "The garrison musters against you.",
    slots: [
      { role: "bulwark", tags: ["tank"],   budgetShare: 0.4,  minCount: 1, maxCount: 3, bias: "heavy" },
      { role: "watch",   tags: ["ranged"], budgetShare: 0.35, minCount: 1, maxCount: 3, bias: "mid" },
      { role: "reserve", tags: ["melee"],  budgetShare: 0.25, minCount: 1, maxCount: 3, bias: "mid" },
    ],
    overflow: ["melee", "ranged"],
  },
];

export function archetypeById(id: ArchetypeId): EncounterArchetype {
  const a = ARCHETYPES.find((a) => a.id === id);
  if (!a) throw new Error(`archetypeById: unknown archetype "${id}"`);
  return a;
}

/** Seeded weighted pick over a profile's archetypeWeights (first draw of the enemy rng). */
export function pickArchetype(
  weights: Partial<Record<ArchetypeId, number>>,
  rng: Rng,
): EncounterArchetype {
  const entries = ARCHETYPES.filter((a) => (weights[a.id] ?? 0) > 0);
  if (entries.length === 0) throw new Error("pickArchetype: profile has no archetype weights");
  const total = entries.reduce((s, a) => s + weights[a.id]!, 0);
  let roll = rng.next() * total;
  for (const a of entries) {
    roll -= weights[a.id]!;
    if (roll < 0) return a;
  }
  return entries[entries.length - 1]!;
}

function slotWeight(cost: number, bias: ArchetypeSlot["bias"]): number {
  switch (bias) {
    case "heavy": return cost * cost;
    case "light": return 1 / cost;
    case "mid":   return 1;
  }
}

function weightedPick(candidates: readonly UnitTemplate[], bias: ArchetypeSlot["bias"], rng: Rng): UnitTemplate {
  const weights = candidates.map((c) => slotWeight(c.cost ?? 1, bias));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

function qualifying(pool: readonly UnitTemplate[], tags: readonly EnemyTag[]): UnitTemplate[] {
  if (tags.length === 0) return [...pool];
  const matched = pool.filter((t) => t.tags?.some((tag) => tags.includes(tag)));
  // Preference ladder (flag #5): a sparse pool with no tag match falls back to the whole
  // pool — a deterministic composition rule, so small/odd pools still field coherent groups.
  return matched.length > 0 ? matched : [...pool];
}

/**
 * Fill an archetype's slot structure from a dimension pool within `budget`. Pure: all
 * randomness through `rng` (same stream that picked the archetype — one Rng.perRun per
 * encounter). Duplicate templates across picks are allowed (a horde IS duplicates).
 * Invariant: returns at least one enemy for any non-empty pool (flag #5's floor).
 */
export function fillArchetype(
  pool: readonly UnitTemplate[],
  archetype: EncounterArchetype,
  budget: number,
  maxEnemies: number,
  rng: Rng,
): UnitTemplate[] {
  if (pool.length === 0) return [];
  const picked: UnitTemplate[] = [];
  let carry = 0;

  const spend = (candidates: readonly UnitTemplate[], slotBudget: number,
                 maxCount: number, bias: ArchetypeSlot["bias"]): number => {
    let remaining = slotBudget;
    let count = 0;
    while (count < maxCount && picked.length < maxEnemies) {
      const affordable = candidates.filter((c) => (c.cost ?? 1) <= remaining);
      if (affordable.length === 0) break;
      const choice = weightedPick(affordable, bias, rng);
      picked.push(choice);
      remaining -= choice.cost ?? 1;
      count++;
    }
    return remaining;
  };

  for (const slot of archetype.slots) {
    const slotBudget = budget * slot.budgetShare + carry;
    carry = spend(qualifying(pool, slot.tags), slotBudget, slot.maxCount, slot.bias);
  }
  // Overflow: spend the leftover so scaled-up budgets buy bigger fights, not nothing.
  spend(qualifying(pool, archetype.overflow), carry, maxEnemies, "light");

  // Floor (flag #5): an encounter always fields at least one enemy.
  if (picked.length === 0) {
    picked.push([...pool].sort((a, b) => (a.cost ?? 1) - (b.cost ?? 1))[0]!);
  }
  return picked;
}
