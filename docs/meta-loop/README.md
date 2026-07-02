# Meta-Loop Push — Master Design

Branch: `game-loop`. This document is the single source of truth for the five feature
workflows in this push. It was written from a design session with Ben on 2026-07-01.
Workflow agents: read this fully before touching code. Decisions under "Locked decisions"
are settled with the user — do not relitigate them; flag conflicts instead of silently
deviating.

## Vision

An effectively infinite co-op (2–4 player) turn-based tactical roguelike. Dimensions
(worlds) are AI-generated end-to-end by the `dimension-generator` pipeline: spec, enemies,
items, art, encounter maps — each dimension's items exist nowhere else in the multiverse.
The combat sim, hex overworld, and co-op rooms already work. What this push adds is the
game around them: a reason to fight (loot), a reason to win (contracts), a reason to go
deeper (tiered portals + codex), and a persistent identity to hang it all on (accounts,
profiles, community).

Before this push: runs are endless hex crawls ending only in party wipe or abandonment.
No victory path is ever triggered, fights drop nothing, gateway hexes are cosmetic labels,
and identity is a localStorage UUID.

## Locked decisions

1. **Accounts**: username + password (salted hash — use `Bun.password`, argon2id), optional
   email column for later recovery. Stored in SQLite now; schema shaped to migrate to
   Supabase later (text UUID PKs, ISO timestamp columns). Auto-guest accounts: first
   connect mints a guest account bound to the existing localStorage clientId; the player
   can claim it (choose username/password) at any time. All persistence hangs off
   `account_id`.
2. **Account level grants no combat stats.** Level gates expedition (manifest) slots,
   titles, cosmetics. Power comes only from gear tier and player skill.
3. **Contracts (quests)**: exactly one per run, chosen by the party in the lobby.
   Completing it = victory. Types v1: slay-boss, recover-relic (win a specific
   great-ruins/great-treasure hex), activate-gateway, chart-N-hexes.
4. **Codex (extraction)**: winning banks the *designs* of items carried — full item JSON
   snapshot + provenance ("first recovered from Dimension X by <player>"; firsts are
   globally unique and permanent). Duplicates are meaningless (you know the design).
5. **Manifest (bring-back)**: run loadout = starter kit + up to K codex designs, where
   each design's tier must be ≤ the run's starting tier. K = `expeditionSlots(level)` =
   `2 + floor(level / 5)` (tunable constant in shared). Consumable designs are not
   manifestable in v1 (run-scoped only).
6. **Retreat**: at a cleared gateway hex the party may vote to retreat: run ends with
   outcome `retreat` — codex finds bank, 50% of pending XP banks, contract reward and
   tier unlock are forfeit.
7. **Party wipe**: run items/designs found this run are lost; 50% XP banks; stats/titles
   and the shared discovery map always persist.
8. **World shape — tiered descent**: every dimension has an integer `tier` (dim 0 =
   tier 0). Gateway hexes are fixed portals to a specific deeper-tier dimension. The
   multiverse graph is persistent and community-shared: once anyone charts a gateway,
   its destination is fixed for everyone. Destinations are assigned from a pool of
   pre-generated dimensions (the pipeline replenishes the pool out-of-band; never block
   a live run on generation).
9. **Run start**: the party picks any dimension whose address any seat's account has
   charted (dim 0 always available). Starting tier = that dimension's tier; it gates
   manifests.
10. **Difficulty**: scales with dimension tier AND hex distance from the dimension's
    origin. Encounter composition becomes themed archetypes (horde, warband, guardian,
    ambush, ...) instead of pure budget-weighted rolls. Budget scales with party size.
11. **Towns/cities**: themed fights that, once cleared (per run), become safe rest nodes.
    Shops/NPCs are a later layer.
12. **Loot in co-op**: encounter drops go to a shared party pool; the party assigns items
    via a vote/claim UI (the movement-vote pattern already exists).
13. **Community scope**: rich menu lobby — room chat, profiles/titles on player cards,
    friends list (request/accept), online presence, invite-to-room. A walkable spatial
    hub is a future push. Victory variant of the game-over screen is required (only a
    defeat screen exists today).

Future knobs discussed but explicitly deferred: codex-based special game modes (e.g.
bring-anything boss raids), item-design overhaul, economy/duplicate salvage, design
gifting between accounts, shops, spatial hub world, post-victory continue-exploring.

## Feature workflows (build order)

| # | Feature | Status | Design doc |
|---|---------|--------|------------|
| 1 | Accounts & community foundation | IN PROGRESS | `docs/meta-loop/01-accounts.md` |
| 2 | Contracts & run outcomes (victory/retreat) | DONE | `docs/meta-loop/02-contracts.md` |
| 3 | Loot & codex | DONE | `docs/meta-loop/03-loot-codex.md` |
| 4 | Portals & tiered multiverse | DONE | `docs/meta-loop/04-portals.md` |
| 5 | Difficulty & themed encounters | DONE | `docs/meta-loop/05-difficulty.md` |

Implementation order is 1 → 2 → 4 → 3 → 5: codex needs accounts; retreat needs gateways
to mean something; the manifest tier-gate needs dimension tiers; scaling needs tiers too.
Features 2–5 are designed sequentially in that same order, each design treating its
predecessors' docs as binding contracts.

## Feature spec summaries

### 1 — Accounts & community foundation
- DB: accounts (uuid PK, username unique nullable-until-claimed, password hash, email
  nullable, guest flag, created_at), sessions, profiles (display name, xp, level, equipped
  title), friends (requests + edges), titles + account_titles, account_stats.
- Server: register/login/logout/claim handlers; session validation on ws connect
  (coexisting with or replacing the HMAC seat-token reclaim in `db.ts`); profile
  fetch/update; friends CRUD; presence (online = live ws connection); room chat relay.
- run_seats gains `account_id` so future features can attribute per-seat outcomes.
- XP v1: earned from encounter wins (contract XP arrives with feature 2). Simple level
  curve as a pure shared function. `expeditionSlots(level)` lives in shared too.
- Stats v1: encounters won, hexes charted, dimensions discovered, wipes; recorders wired
  where those events already happen. Later features add their own stat writes.
- Titles v1: schema + a few earnable seeds; more arrive with later features.
- Client: login/register/claim UI; home screen shows profile card + friends panel; lobby
  gets chat + richer player cards (name, level, title). Guests can play without friction.

### 2 — Contracts & run outcomes
- Contract selection UI in lobby (host proposes / party sees it; one contract per run).
- Contract state tracked on the run; progress surfaced in the overworld HUD.
- Victory path: `finalizeRun(runId, "victory")` finally gets called; victory game-over
  screen variant; banking hooks (feature 3 fills them in).
- Retreat vote at cleared gateway hexes; `retreat` run outcome added.
- Wipe keeps 50% pending XP.

### 3 — Loot & codex
- Drop generation post-encounter (dimension item pool, richer at treasure hexes).
- Party loot-assignment UI (vote/claim), items enter the winner's run inventory.
- codex_entries: account_id, dimension_id, item_id, item JSON snapshot, tier, provenance,
  first_recovered_by (global first = separate unique record), acquired_at.
- Lobby manifest UI: starter kit + K tier-gated codex picks.

### 4 — Portals & tiered multiverse
- `dimensions.tier` column; `dimension_gateways` (from_dim, hex q/r, to_dim) assigned on
  first activation from the ready pool.
- Post-clear gateway hex offers: travel deeper (vote) / retreat (feature 2) / stay.
- Runs track current dimension; discovery/cleared state is per-dimension.
- Run-start dimension picker (charted addresses across the party's accounts).

### 5 — Difficulty & themed encounters
- Effective budget = f(base profile, dimension tier, hex distance from origin, party
  size).
- Composition archetypes replace raw weighted rolls; encounters read as coherent groups
  (a warband, a guardian and minions, a horde) rather than arbitrary piles of big enemies.
- Towns/cities cleared → safe rest nodes.

## Key code anchor points

- `server/src/db.ts` — all SQLite: runs, run_seats (+HMAC session tokens ~line 601),
  discovered_hexes (community map), items/enemy_templates per dimension, finalizeRun
  (~line 418, outcome type includes an unused `"victory"`).
- `server/src/index.ts` — ws message dispatch; room create/join (~line 295); startGame
  (~line 515); debugWin/debugLose (~line 772).
- `server/src/room.ts` / `room-machine.ts` — seats, phases (`lobby`→`overworld`→`combat`),
  movement votes, `finalizeMove` (~961), `encounterTypeFor` (~991), `endCombat` (~1063,
  defeat-only), `resetToOrigin` (~1124).
- `shared/src/net/protocol.ts` — wire messages (gameOver already types
  `outcome: "victory" | "defeat"`).
- `shared/src/encounter/` — `encounter.ts` (generateEncounter/rollEnemies),
  `encounter-profiles.ts` (static per-icon budgets), `dimension.ts` (Dimension shape).
- `shared/src/map/hex-map.ts` + `hex-config.ts` — hex icon types, spawn table.
- `shared/src/core/items.ts`, `inventory.ts`, `presets.ts` — item defs, bag/equip,
  starter presets.
- `client/src/net/player-token.ts` — localStorage clientId + stored seat.
- `client/src/screens/` — `ui-kit.ts` (THEME/FONT design tokens), home/lobby/game-over
  screens, `screen-manager.ts`.

## Conventions for all workflow agents

- Type-check with `bun run typecheck` from the repo root. Never bare `tsc` without
  `--noEmit`. Tests: `bun test`.
- Fail loud: no silent fallbacks, no empty catch blocks. If a fallback is genuinely
  needed, leave a `FALLBACK:` note in your report so the orchestrator can surface it.
- Comments sparse: only what the code can't say (gotchas, external constraints).
- The working tree has unrelated modified files (`server/sprites/**`,
  `dimension-generator/**`). Never touch, revert, or commit them.
- Never run `git add`/`git commit`/`git push` — the orchestrator commits.
