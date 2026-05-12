---
name: generate-dimension
description: Generate a new dimension end-to-end — theme, art bundles, sprite extraction, seeding
user_invocable: true
---

# Generate Dimension

Templates to copy:
- Spec format: `dimension-generator/dimension-1-spec.json`
- Seed format: `server/src/seed-dimension-1.ts`

## Pipeline

1. Run `bun dimension-generator/inspire.ts` for random nouns. Use them as mood seeds, not literal constraints.

2. Write `dimension-generator/dimension-N-spec.json`. A dimension is a **whole world** — think of it as an entire planet with diverse biomes, cultures, and ecosystems, not a single room or location. "Underwater caves" is too narrow; "an ocean world with reefs, trenches, and floating kelp cities" is the right scale. The name, description, and enemies should imply variety and depth, not one gimmick. Pick a mechanical identity that contrasts existing dimensions (which on-hit effects it leans on: knockback, pull, bleeding, poisoned, slowed, vulnerable, confused).

3. Run `bun dimension-generator/build-diffusion-bundles.ts dimension-generator/dimension-N-spec.json`. Then **stop and tell the user** to send the bundles through the diffusion model and return with the spritesheets.

4. Extract sprites:
   - Enemies (4×4 grids): `python3 scripts/process-spritesheet.py <sheet> <out> --cols 4 --rows 4 --names <4 names> --states idle,attack,hit,move`
   - Decorations: `python3 scripts/process-decoration-sheet.py <sheet> <out>`
   - Items (4×4 grid): `python3 scripts/process-item-sheet.py <sheet> <out> --cols 4 --rows 4 --names <16 names>`

5. Place sprites: enemies under `server/sprites/enemies/dimension-N/<enemy>/`, items under `client/public/sprites/items/dimension-N/`, decorations under `client/public/sprites/map-objects/dimension-N/{plants,rocks,walls,backgrounds}/`.

6. Build `server/src/seed-dimension-N.ts` in batches of 4. **Look at each sprite before writing its stats** — follow the diffusion model's interpretation when it diverges from the spec. Use `/ability-balance` skill principles for weapons (2+ abilities each, uncommon+ gets 3). Report per batch and pause for user feedback. Set `heightMeters` thematically: 1.0=tiny, 2.0=normal/player, 5.0=colossal.

7. Wire `seedDimensionN()` into `server/src/index.ts`. Add a few new weapons to the starter-extras list. Run `bun run typecheck`.
