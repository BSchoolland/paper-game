---
name: generate-dimension
description: Generate a new dimension end-to-end — theme, art bundles, sprite extraction, seeding
user_invocable: true
---

# Generate Dimension

Templates to copy (dimension 3 = "The Gilt Barrens" is the current reference):
- Spec format: `dimension-generator/dimension-3-spec.json`
- Seed format: `server/src/seed-dimension-3.ts`

Extraction scripts output **PNG** (what the game's loaders expect) and write a `manifest.json` for decoration sheets. Sprite directories are **flat** (no `plants/rocks/walls` subfolders) except enemies, which go in per-enemy subfolders.

## Pipeline

1. Run `bun dimension-generator/inspire.ts` for random nouns. Use them as mood seeds, not literal constraints.

2. Write `dimension-generator/dimension-N-spec.json`. A dimension is a **whole world** — an entire planet with diverse biomes, cultures, and ecosystems, not a single room. "Underwater caves" is too narrow; "an ocean world with reefs, trenches, and floating kelp cities" is the right scale. Pick a mechanical identity that contrasts existing dimensions (which on-hit effects it leans on: knockback, pull, bleeding, poisoned, slowed, vulnerable, confused).

3. Run `bun dimension-generator/build-diffusion-bundles.ts dimension-generator/dimension-N-spec.json`. Then **stop and tell the user** to send the bundles through the diffusion model and return with the spritesheets.

4. Extract sprites (all output PNG). After extracting enemies, move each `<enemy>-<state>.png` into a `<enemy>/` subfolder.
   - Enemies (4×4 grids → `server/sprites/enemies/dimension-N/`): `python3 scripts/process-spritesheet.py <sheet> server/sprites/enemies/dimension-N --cols 4 --rows 4 --names <4 names> --states idle,attack,hit,move`
   - Structures (decoration sheet → `client/public/sprites/map-objects/dimension-N/`): `python3 scripts/process-decoration-sheet.py <sheet> client/public/sprites/map-objects/dimension-N` — produces `sprite-00.png … sprite-NN.png` + `manifest.json`
   - Hex decorations (decoration sheet → `client/public/sprites/map-decorations/dimension-N/`): `python3 scripts/process-decoration-sheet.py <sheet> client/public/sprites/map-decorations/dimension-N` — produces `sprite-NN.png` + `manifest.json`
   - Items (4×4 grid → `client/public/sprites/items/dimension-N/`): `python3 scripts/process-item-sheet.py <sheet> client/public/sprites/items/dimension-N --cols 4 --rows 4 --names <16 names>`
   - Background: copy the raw background sheet to `client/public/sprites/map-objects/dimension-N/background.png`

5. **Sanity check the structure extraction.** Open `client/public/sprites/map-objects/dimension-N/` in a file browser. The script auto-calibrates and filters size outliers, but if it merged or split sprites badly, re-run with `--tolerance <n>` or check the count is reasonable.

6. Build `server/src/seed-dimension-N.ts` (copy from `seed-dimension-3.ts`):
   - **Enemies** — in batches of 4. **Look at each sprite before writing its stats**; follow the diffusion model's interpretation when it diverges from the spec. Use `/ability-balance` skill principles for weapons (2+ abilities each, uncommon+ gets 3). Report per batch and pause for user feedback. Set `heightMeters` thematically: 1.0=tiny, 2.0=normal/player, 5.0=colossal. The `enemySprites()` helper builds `.png` paths.
   - **Structures** — do NOT label them. Copy the `buildDimNStructures()` helper from `seed-dimension-3.ts`: it generates `structure-00 … structure-NN` from the `sprite-NN.png` count, with `cost` (1/2/3) and `scale` derived from sheet position (sheets are laid out small/natural at the top → large/built at the bottom; the encounter generator weights selection by this position — natural encounters favor the top, fortified/arena favor the bottom). Just set `STRUCTURE_COUNT` to match how many `sprite-NN.png` files exist.
   - **Items** — weapons need ability definitions (shields/accessories/consumables are not yet supported by the item system; skip them).

7. Wire `seedDimensionN()` into `server/src/index.ts` (import + call alongside the others). Add a few new weapons to the `DIM1_STARTER_EXTRAS` list for playtesting. Run `bun run typecheck`.

8. Tell the user to restart the server (seeds run at startup) and load `?dim=N` to verify assets load and the dimension plays.
