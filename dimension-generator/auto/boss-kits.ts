#!/usr/bin/env bun
// Hand-tuned attack kits for existing bosses. Merges kit metadata (and a few new phase
// abilities) into the enemy_templates rows in place, preserving sprites and stats.
// Usage: bun dimension-generator/auto/boss-kits.ts   (respects GAME_DB_PATH)
import type { AbilityDefinition, UnitTemplate } from "../../shared/src/index.js";
import { getEnemyTemplate, saveEnemyTemplate } from "../../server/src/db.js";

interface BossKitPatch {
  readonly dimensionId: number;
  readonly enemyId: string;
  /** kit rules merged onto existing abilities by id. */
  readonly kits: Record<string, NonNullable<AbilityDefinition["kit"]>>;
  /** New abilities appended to the template (skipped if the id already exists). */
  readonly add?: readonly AbilityDefinition[];
}

const PATCHES: readonly BossKitPatch[] = [
  {
    // Frost Wyrm — opens sniping with the rooting Rime Lance, fills with Frost Breath;
    // below half HP it alternates the harder, wider Whiteout with the lance.
    dimensionId: 700,
    enemyId: "frost-wyrm",
    kits: {
      "frost-wyrm-rime-line": { priority: 3, cooldown: 2 },
      "frost-wyrm-whiteout": { hpBelow: 0.5, priority: 5, cooldown: 2 },
    },
    add: [
      {
        id: "frost-wyrm-whiteout",
        name: "Whiteout",
        kind: "attack",
        cost: { red: 1, blue: 1 },
        shape: { kind: "sector", radius: 115, halfAngle: 0.95 },
        damage: 36,
        knockback: 30,
        onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 50 }],
        visual: { color: 0xffffff, trailEffect: "splash", screenShake: 0.5 },
      } as AbilityDefinition,
    ],
  },
  {
    // Avalanche Troll — buries the escape lane behind you every 3 turns, sweeps when players
    // clump, line-smashes otherwise; below half HP it adds a huge knockback line that slams
    // targets into its own walls.
    dimensionId: 700,
    enemyId: "avalanche-troll",
    kits: {
      "avalanche-troll-bury": { priority: 5, cooldown: 3 },
      "avalanche-troll-sweep": { minTargets: 2, priority: 4 },
      "avalanche-troll-rockslide": { hpBelow: 0.5, priority: 6, cooldown: 2 },
    },
    add: [
      {
        id: "avalanche-troll-rockslide",
        name: "Rockslide Fury",
        kind: "attack",
        cost: { red: 2 },
        shape: { kind: "rectangle", length: 140, width: 60 },
        damage: 38,
        knockback: 60,
        wallSlamDamage: 25,
        visual: { color: 0xd6e8ff, trailEffect: "explosion", screenShake: 0.7 },
      } as AbilityDefinition,
    ],
  },
  {
    // Black Dragon — alternates Crushing Bite nukes with Shadow Breath on clumps, tail-sweeping
    // as filler; under half HP it leads with Wing Buffet wall-slams every other turn.
    dimensionId: 705,
    enemyId: "black-dragon",
    kits: {
      "black-dragon-bite": { priority: 4, cooldown: 2 },
      "black-dragon-breath": { priority: 3, minTargets: 2, cooldown: 2 },
      "black-dragon-buffet": { hpBelow: 0.5, priority: 6, cooldown: 2 },
    },
  },
];

for (const patch of PATCHES) {
  const template = getEnemyTemplate(patch.enemyId, patch.dimensionId);
  if (!template) throw new Error(`${patch.enemyId} not found in dimension ${patch.dimensionId}`);

  const abilities: AbilityDefinition[] = [...template.abilities];
  for (const ability of patch.add ?? []) {
    if (!abilities.some((a) => a.id === ability.id)) abilities.push(ability);
  }
  const patched = abilities.map((a) => {
    const kit = patch.kits[a.id];
    return kit ? { ...a, kit } : a;
  });

  const unknown = Object.keys(patch.kits).filter((id) => !patched.some((a) => a.id === id));
  if (unknown.length > 0) throw new Error(`${patch.enemyId}: kit rules for missing abilities ${unknown.join(", ")}`);

  const next: UnitTemplate = { ...template, abilities: patched };
  saveEnemyTemplate(patch.enemyId, patch.dimensionId, next);
  console.log(`patched ${patch.enemyId} (dim ${patch.dimensionId}): ${patched.filter((a) => a.kit).map((a) => a.id).join(", ")}`);
}
