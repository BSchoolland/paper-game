---
name: balance-test
description: Run AI-vs-AI combat simulations to audit enemy and item balance in a dimension. Use when balancing a new dimension, debugging why a fight goes badly, or checking if a weapon/enemy is over/undertuned.
user_invocable: true
---

# Balance Test

Scripts in `hero-arena/src/t2/`. Output goes next to the repo root (gitignored).

## Tools

- **`balance-test.ts <dimId>`** — Runs every enemy through solo and party encounters. Writes `balance-report-dim-N.json` and `balance-logs-dim-N/`.
- **`item-test.ts <dimId>`** — Equips each weapon/shield onto a baseline hero and runs through archetypes. Writes `item-report-dim-N.json` and `item-logs-dim-N/`.
- **`item-rank.ts <item-report.json>`** — Scores and ranks items, flags outliers (worse-than-baseline, rarity inversions, punch fallbacks).
- **`item-summary.ts <item-report.json>`** — Grid of items × scenarios. Use to spot scenario-specific patterns.
- **`balance-drill.ts <event-log.json | directory>`** — Per-entity breakdown: damage, kills, ability usage, energy efficiency. Use to understand *why* something is unbalanced.

Both test scripts default to 3 seeds. Pass `--seeds N` for more confidence. Pass `--workers N` to run games in parallel across N subprocesses (typically 3-4x faster on multi-core hardware; use `nproc` to pick N).

## Fixing balance

Run the test, then write a bun script to parse the report JSON and compare against a reference dimension (dim 0's report at `balance-report-dim-0.json`). Key cross-dimension metrics: cost-tier sovereign-solo averages, scenario aggregates, and **skill gap** (sovereign solo win% minus bad solo win% — higher = more skill-expressive).

**Always drill before changing.** Run `balance-drill.ts` on the enemy's logs (`ls balance-logs-dim-N/ | grep <enemy-name>`) to find the mechanical root cause.

Prefer mechanical fixes (strategy, move speed, energy, shape size, cost tier) over raw stat bumps, though sometimes a pure stat change can be the right solution. Re-test after each round of changes.

## Notes

If dumb players do better than they did in dim 0 and/or smart players do worse, that's a problem and will make the levels feel like they are arbitrary and don't reward skill.  We want skill to matter a lot in this game, even more so for later levels (dim 0 is the starting world)

After finishing all changes, re-evaluate whether enemies should still look the same after these updates.

Note that the item baseline is not barehanded, it gives the player essentially a simple starter kit.  Being worse than it is bad, but not the end of the world.

Binary search:  Change things more than you'd think you would need to to get a feel for how things work.  Itteration 2 should be an overcorrection for learning purposes, then itteration 3 is where you really lock in what feels balanced.
