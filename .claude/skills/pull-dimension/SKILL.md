---
name: pull-dimension
description: Pull a generated dimension (sprites, spec, and DB rows) from the desktop to this machine so it can be played locally. Use after a dimension was generated on the desktop and you want to play or review it here.
user_invocable: true
---

# Pull Dimension

Bring a dimension that was generated on the **desktop** down to **this** machine. Dimensions are generated on the desktop (via `/generate-dimension`), which leaves the sprite/spec files and the dimension's rows in the desktop's `hex-discovery.sqlite`. This skill transfers both.

Why a dedicated pipeline: the art/spec files are git-tracked (they move via commit+push+pull), but `server/hex-discovery.sqlite` is **gitignored**. The two databases diverge — the desktop DB often has *fewer* dimensions than the laptop — so the DB half must be a **surgical row transfer** (only the target dimension's rows across `dimensions` + `enemy_templates` + `items`), never a wholesale copy that would clobber local-only dimensions.

## Usage

Run the pipeline with the dimension id:

```bash
bash /home/ben/Projects/turn-based-game/dimension-generator/auto/pull-dimension.sh <dimId>
```

Optional args: `pull-dimension.sh <dimId> [desktopHost] [repoPath]` (defaults: `desktop`, `Projects/turn-based-game`).

## What it does

1. **Remote (desktop):** commits any uncommitted dimension assets and pushes the current branch.
2. **Remote:** dumps the dimension's rows (`dimensions`, `enemy_templates`, `items`) as idempotent `DELETE`+`INSERT` SQL.
3. **Local:** fast-forwards the branch, bringing the sprite/spec files.
4. **Local:** backs up `hex-discovery.sqlite` (`.bak-<timestamp>`), then applies the dumped rows — other dimensions untouched.
5. **Repair:** backfills the `sprites` field on each enemy template if missing (`/api/sprites/enemies/dimension-<id>/<enemyId>-<state>.png`). The generator has historically produced the PNGs but omitted this field, which renders enemies blank — this guards against that.
6. Prints the final dimension/enemy/item counts.

The script is idempotent — safe to re-run.

## After pulling

Restart the local server (or start a fresh encounter) so it reloads templates from the DB. The dimension arrives with whatever `status` it had on the desktop (usually `in_review`); promote it separately when ready.

## Notes

- Both machines must be on the **same branch** with a shared remote; the branch is auto-detected from the local checkout.
- If enemy sprites still render blank after a pull, the PNG filenames don't match the enemy ids — the script prints a `WARNING` listing any missing files.
