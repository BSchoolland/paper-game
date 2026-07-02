# Feature 5 — Difficulty & Themed Encounters: Final Design

Status: FINAL — the design doc referenced by `docs/meta-loop/README.md:81`. Written 2026-07-01
against HEAD `47459b6` (feature 1 committed), with `docs/meta-loop/02-contracts.md`,
`docs/meta-loop/04-portals.md`, AND `docs/meta-loop/03-loot-codex.md` treated as binding,
already-implemented contracts (build order is 1 → 2 → 4 → 3 → 5; this feature lands LAST).
Anchors into feature-2/3/4 artifacts use their names (`run-events.ts`, `settleRun`,
`recordEncounterWon`, `hex-entered`, `Room.dimensionTier`, `Room.runClearedCount`,
`hexDistance`, protocol v6); anchors into pre-feature-2 code use line numbers verified at HEAD
today — they shift once 02/04/03 land, the names do not.

Verified ground truth this design builds on:

- `shared/src/encounter/encounter.ts` (167 lines) — `generateEncounter(hexType, dimension, x,
  y, runId)` (55): `layoutRng = Rng.seeded(x, y)`, `enemyRng = Rng.perRun(runId, x, y)`; enemy
  composition comes from `rollEnemies(pool, profile, rng)` (78) — a greedy budget-weighted
  roll: repeatedly pick an affordable template weighted by `scoreEnemy` (1 + sum of
  `profile.tagWeights` over the template's tags), spend `cost ?? 1`, until nothing is
  affordable. **This is the "arbitrary piles" roller this feature replaces.** It can return
  `[]` only when the cheapest pool unit costs more than the budget (never true in live data)
  and has NO enemy-count ceiling (a boss-hex budget of 35 could legally roll 35 cost-1 units).
  `selectMap` (38) and `rollStructures` (114) are untouched by this feature.
- `shared/src/encounter/encounter-profiles.ts` — `EncounterProfile { enemyBudget, tagWeights,
  structureBudget, structureStyle }`; `EncounterType = HexIconType | "wilderness" |
  "dense-wilderness"`; the static per-icon table (budgets 6–50). `tagWeights` is consumed ONLY
  by `rollEnemies` (verified by grep — the generator's `map-prompts.ts` imports just the
  `EncounterType` type) and is removed by this feature.
- `shared/src/core/types.ts` — `ENEMY_TAGS = ["melee","ranged","tank","swarm","elite","boss"]`
  (289); `UnitTemplate.cost?/tags?` (316-317). Live-DB audit (all 15 dims with enemies): every
  dimension's 16-template roster covers ALL SIX tags (dim 0's 8-template roster too); costs
  span 1–15 with bosses at ~10–15. Archetype slot-matching has real tag data to chew on
  everywhere.
- `shared/src/core/rng.ts` — `Rng.seeded(x,y)` / `Rng.perRun(runId,x,y)`, LCG `next()`. All
  composition randomness must flow through these (determinism discipline).
- `server/src/room-machine.ts` — `encounterTypeFor` (998): `getHexIcon(target, icons) ??
  (isDecorationHex ? "dense-wilderness" : "wilderness")`; `beginCombatEntry` (1012): R7 atomic
  — synchronous pre-await block snapshots `specs = room.seats.map(seatBuildSpec)` then awaits
  `EncounterSession.createEncounter({seats, hexType, hexCoord, runId, dimensionId})`; build
  failure restores overworld (1036-1046); post-await generation re-validation (1049);
  `io.broadcast(room, {type:"combatStart", encounterHex})` (1058). `finalizeMove` (968):
  visited-hex branch is the pure party move (02 adds the `hex-entered` emit there). `endCombat`
  (1070) win branch (02 §4.4 rewires it through `emitRunEvent`). `resetToOrigin` (1135).
- `server/src/encounter-session.ts` — `createEncounter` (57) is the ONLY `generateEncounter`
  caller in src; party size = `seats.length` = room capacity (bots fill at startGame, so hero
  count always equals capacity). `server/src/encounter-builder.ts` —
  `placeEncounterEntities(encounter, grid, seats)` (28) builds one red hero per seat from
  `UNIT_TEMPLATES.player` (hp 120) + item abilities; `makeEntity` stamps `barrier: 0`
  (`shared/src/encounter/entity-factory.ts:23`). **Heroes are rebuilt at FULL HP for every
  encounter — there is no persistent party HP anywhere** (verified: `SeatBuildSpec` carries
  loadout only). `Entity.barrier` is a live combat stat (`turn-resolver.ts:145` — absorbs
  damage before hp).
- `server/src/room.ts` — `Room` (110): `dimensionId`, `visitedThisRun`, `pendingHex`,
  `capacity` ("2..4, fixed at create"), `vote`, `chatLog` ("lost on crash/reap by design" —
  the ephemerality precedent this feature's `rested` flag follows). 04 adds `dimensionTier`,
  `startDimensionId`, `runClearedCount`, `gateways`; 03 adds `lootPool`.
- `server/src/index.ts` — `ORIGIN = {q:0, r:0}` (144); `createRoomFor` Room literal (387-410);
  every dimension's origin hex is icon `"town"` and auto-cleared (376-378, and 04's
  `commitTravel` mirrors it for travel destinations).
- Live DB — run capacities: **825 of 854 historical runs are capacity 2** (26 at 4, 3 at 3);
  the client HomeScreen default capacity is 2 (`home-screen.ts:49`). "The existing game" ≈
  2-hero parties. Balance tooling baselines: `scripts/sim-battle.ts` fields 4v4 with FIXED
  rosters (no `generateEncounter`); `hero-arena/src/t2/balance-test.ts` party scenarios field
  3 heroes at direct budgets `[25, 35, 50]` and its "realistic encounter" section calls
  `generateEncounter(profile, dimension, seed, seed*7, seed*13)` at line 286 — **the one
  out-of-server call site of the signature this feature extends**.
- `shared/src/map/hex-map.ts` — `HEX_ICON_TYPES` (8-21); `getHexIcon` (72) with deterministic
  `pickIconForHex` fallback; 02 §2.3 adds `hexDistance`. `hex-config.ts` spawn weights: town 3,
  city 1, gateway-city 1 (rest nodes are rare but reachable; the origin town is guaranteed).
- `shared/src/core/progression.ts` — `XP_ENCOUNTER_WIN = 25` with the comment "feature 5
  scales by difficulty" (module doc forbids imports from shared/combat/ or the encounter
  builder — account level must never touch combat; this feature respects that: scaling inputs
  are tier/distance/party-size, never level).
- 02 §9 seams reserved for this feature (consumed here): "feature 5 replaces the flat
  `XP_ENCOUNTER_WIN` accrual amount inside `recordEncounterWon` (one call site) and may scale
  `CONTRACTS[*].xpReward`"; `hex-entered` emitted-unused. 04 §10: "`room.dimensionTier` … +
  `hexDistance(hex, ORIGIN)` … are the two inputs its budget formula consumes"; 04 flag #14:
  "rest-node arrival (feature 5) remains `hex-entered`'s first consumer". 03 §10: rest-node
  re-visits are `hex-entered` (no `encounter-won`) so rest nodes drop no loot with zero 03
  changes; `rollDrops` scaling seam offered (declined here, flag #7).
- Protocol — at HEAD `PROTOCOL_VERSION = 3`; after 02 (+1), 04 (+1), 03 (+1) it is **6**; this
  feature bumps to **7**. `combatStart` (267) carries `encounterHex` only. `RoomStatePayload`
  (51) post-03 carries contract/outcome/dimensionName/dimensionTier/lootPool.
- Client — `main.ts` `pushToast` stack (210); `conn.on("combatStart")` is not currently a
  toast site (phase switching rides roomState). 02's ContractHud (`renderer/contract-hud.ts`,
  top-right, visible iff `phase === "overworld" && contract`) is the HUD this feature extends
  with threat + rested readouts. `client/dev/mock-data.ts` roomState fixtures.
- Tests — `db-migration-idempotency.test.ts` expects `user_version === 9` after 03 —
  **unchanged by this feature (no migration)**. No existing test imports
  `generateEncounter`/`getEncounterProfile`/`tagWeights` (verified), so the profile reshape
  breaks no test mechanically.

---

## 0. Flags & decisions (read first)

Orchestrator: items 1–4 are the load-bearing calls Ben should eyeball; 5–12 are smaller. None
contradict a locked decision; #1 and #2 interpret locked #10/#11 where the master is silent —
flag them prominently.

1. **FLAG — party-size multiplier is anchored at capacity 2 = 1.0**:
   `PARTY_SIZE_BUDGET_MULT = {2: 1.0, 3: 1.2, 4: 1.4}`. Locked #10 mandates "budget scales
   with party size"; the task mandates "the dim-0 near-origin experience must stay
   approximately as it is today". Those two constraints pick the anchor together: 96% of all
   historical runs (825/854) are capacity 2 and the client's default capacity is 2, so
   capacity-2 IS today's game — anchoring it at 1.0 leaves the dominant experience bit-
   identical near origin, while 3/4-hero parties (29 runs ever) get proportionally larger
   fights, which is the locked decision's intent. The slope is deliberately sublinear in hero
   count (2→4 doubles heroes but only 1.4×'s budget) because co-op action economy compounds —
   four heroes focusing fire are more than twice as strong as two. **Alternative** (one-table
   change if Ben prefers the 4-hero balance-report framing as the anchor):
   `{2: 0.7, 3: 0.85, 4: 1.0}` — but that makes today's default rooms ~30% easier, a real
   rebalance. **Ben: confirm the anchor.**
2. **FLAG — the v1 rest effect is a next-combat barrier, not a heal.** The task's example
   ("e.g. party heal") is a no-op in this game: heroes are rebuilt at full HP for every
   encounter (`makeEntity` from `UNIT_TEMPLATES.player`; no persistent party HP exists — see
   ground truth). The nearest meaningful translation: a party standing on a **cleared rest
   node** (town / city / gateway-city, per-run cleared) becomes **Rested** — every hero enters
   the NEXT combat with `REST_BARRIER_HP = 30` barrier (an existing combat stat: absorbed
   before hp, rendered by the existing barrier UI). Consumed on the next combat entry;
   re-armed by returning to any rest node. **Ben: confirm the mechanic** (if he'd rather rest
   granted a consumable-recharge or an energy head start, the grant/consume plumbing in §4 is
   identical — only the §2.4 constant and the §4.3 barrier stamp change).
3. **DECISION — `Room.rested` is ephemeral in-memory state; NO migration (v10 stays unused).**
   An unconsumed rest is lost on server crash, exactly like open votes, in-flight combat, and
   room chat (all documented "lost on crash by design"). It is one walk-back to re-arm. This
   is the whole reason this feature ships zero DDL.
4. **DECISION — an untiered (NULL-tier) dimension scales as tier 0.** Dev-override runs
   (04 flag #5/#10) fight inside unplaced dims; `effectiveTier(dimensionTier) = dimensionTier
   ?? 0` is the same explicit named-function rule 03 used for manifests
   (`effectiveStartingTier`) — a defined rule for a defined state, not a silent coerce.
5. **DECISION — archetype slot tag-matching is a preference ladder, not a hard filter.** A
   slot whose tag set matches nothing in the dimension's pool draws from the whole pool; and
   an archetype fill that produces zero enemies (cheapest unit > budget — impossible in live
   data, reachable in tests) takes the single cheapest pool unit. Both are deterministic
   composition RULES (documented in §2.2's code), not error recovery: every dimension pool is
   generator-authored and small, and an encounter must always field at least one enemy.
   FALLBACK: none — these rules fire identically every time for the same inputs and are unit-
   tested; there is no error being swallowed.
6. **DECISION — encounter XP and contract rewards adopt 02's reserved scaling seam.**
   `scaledXp(base, tier, distance)` applies the SAME tier/distance multipliers as the budget
   formula (party size never scales XP — it normalizes fairness, not reward):
   `recordEncounterWon`'s flat `XP_ENCOUNTER_WIN` becomes `scaledXp(XP_ENCOUNTER_WIN,
   room.dimensionTier, hexDistance(ev.hex, ORIGIN))`; `settleRun`'s contract-reward accrual
   becomes `scaledXp(def.xpReward, startTier, 0)` where startTier is the run's start
   dimension's tier. Near-origin tier 0 = today's exact values (25 / 80–150). Both edits are
   pre-authorized by 02 §9 — no predecessor doc amendment needed.
7. **DECISION — loot drops do NOT scale with tier/distance in v1.** 03 §10 offered the wrap
   seam; declined: drop richness is already icon-keyed, item POWER already scales by
   descending to deeper dims (each dim's unique pool), and quantity inflation would flood the
   claim UI. One-line wrap later if wanted.
8. **DECISION — rest is granted on every ARRIVAL at a cleared rest node, never at run start.**
   Three grant points, all in the run-event bus: `hex-entered` (pure move onto a cleared
   town/city/gateway-city — `hex-entered`'s long-promised first consumer), `encounter-won`
   (the party camps in the town it just liberated), and `dimension-entered` (04's travel lands
   the party on the destination's auto-cleared origin town). NOT granted at run start — that
   would give every run's first fight a free barrier and rebalance the near-origin experience
   this feature is required to preserve. Known and accepted: a party camped next to a rest
   node can step off/on to re-arm before every fight — rest deliberately makes a rest node's
   neighborhood safer; the price is walking back after pushing deeper, which is exactly the
   push-your-luck rhythm wanted.
9. **DECISION — `generateEncounter` gains a required 6th `scaling` argument;
   `hero-arena/src/t2/balance-test.ts:286` is updated to pass `BASELINE_SCALING`** (tier 0,
   distance 0, party size 2 — the multiplier-1.0 identity). The CLI entry points
   (`balance-test.ts <dimId>`, `item-test.ts`, `sim-battle.ts`) are untouched; report SCHEMA
   is untouched. Deliberately NOT an optional parameter with a default: the server must never
   be able to forget scaling silently. Distance must be passed, never derived from `(x, y)`
   inside `generateEncounter` — balance-test passes seeds as coordinates and would otherwise
   see phantom distance multipliers.
10. **DECISION — hard enemy-count ceiling `MAX_ENCOUNTER_ENEMIES = 12`.** Today's roller is
    theoretically unbounded; with tier/distance multipliers it would really explode (blue AI
    turn time scales with entity count). 12 blue + up to 4 red = 16 entities max.
11. **DECISION — the encounter's archetype rides `combatStart` for flavor** ("A warband bars
    the way"). Costs one wire field, sells the whole feature ("encounters read as coherent
    themed groups"); also gives tests a cheap composition assertion handle. The threat readout
    (§6.2) is client-COMPUTED from shared functions + data already on `roomState`
    (dimensionTier) and `hexMapState` (party position) — zero protocol surface.
12. Small calls: `tagWeights` is deleted from `EncounterProfile` (its only consumer was the
    old roller), replaced by `archetypeWeights`; `structureBudget`/`structureStyle` and map
    selection are untouched (terrain does not scale). No new titles in v1 (nothing here
    creates a stat worth a title; deferred). Difficulty plateau accepted and documented:
    enemy STATS do not scale with tier, so once the budget saturates the 12-enemy /
    most-expensive-slots ceiling (around tier 4–5 at the distance cap), deeper tiers stop
    getting mechanically harder — the deferred knobs are tier-aware generated content and/or
    stat multipliers (master doc's "item-design overhaul" family). `debugWin` bypasses combat,
    so it exercises none of this feature's combat-side scaling but ALL of its XP/rest/HUD
    plumbing (fine — that is what it is for).

FALLBACK: none introduced by this feature (see flag #5 for the two deterministic composition
rules that are explicitly not fallbacks).

---

## 1. Data model & migration

**None.** This feature ships zero DDL; `user_version` stays 9 (03's value); the v10 slot
remains free. `Room.rested` is in-memory only (flag #3). All new tunables are shared-code
constants. The migration-idempotency test expectation is UNCHANGED by this feature — assert
that explicitly in review (a diff touching db.ts migrations is out of scope here).

---

## 2. Shared modules

### 2.1 `shared/src/encounter/difficulty.ts` (new; add `export * from "./encounter/difficulty.js"` to `shared/src/index.ts` next to the other encounter exports)

The named tunable formulas — THE scaling table for the whole feature.

```ts
/**
 * Encounter difficulty scaling (docs/meta-loop/05-difficulty.md).
 * effective budget = base profile budget × tier mult × distance mult × party-size mult.
 * Inputs are dimension tier, hex distance from origin, and party size — NEVER account level
 * (progression.ts's zero-combat-stats rule; this module must not import progression.ts).
 */

export interface EncounterScaling {
  /** Room.dimensionTier (04). null = unplaced dev-override dimension → scales as tier 0. */
  readonly dimensionTier: number | null;
  /** hexDistance(encounter hex, ORIGIN). Every dimension's origin is (0,0). */
  readonly distanceFromOrigin: number;
  /** Hero count = room capacity (bots included). Valid: 2 | 3 | 4. */
  readonly partySize: number;
}

// --- Tunables (flag #1, §5 table) ---
export const TIER_BUDGET_RATE = 0.4;          // +40% budget per dimension tier
export const DISTANCE_GRACE_RADIUS = 2;       // hexes from origin with no distance scaling
export const DISTANCE_BUDGET_RATE = 0.07;     // +7% per hex beyond the grace radius
export const DISTANCE_BUDGET_MULT_CAP = 2.5;  // distance can at most 2.5× a fight
export const PARTY_SIZE_BUDGET_MULT: Readonly<Record<number, number>> = {
  2: 1.0,   // anchor: the dominant live configuration — near-origin dim 0 stays as today
  3: 1.2,
  4: 1.4,
};
export const MAX_ENCOUNTER_ENEMIES = 12;      // hard composition ceiling (flag #10)

/** Multiplier-identity scaling: reproduces pre-feature-5 budgets exactly (balance tooling). */
export const BASELINE_SCALING: EncounterScaling = {
  dimensionTier: 0,
  distanceFromOrigin: 0,
  partySize: 2,
};

/** 04 §10 / 03's effectiveStartingTier rule, applied to encounter scaling (flag #4). */
export function effectiveTier(dimensionTier: number | null): number {
  return dimensionTier ?? 0;
}

export function tierBudgetMult(dimensionTier: number | null): number {
  return 1 + TIER_BUDGET_RATE * effectiveTier(dimensionTier);
}

export function distanceBudgetMult(distanceFromOrigin: number): number {
  const scaled = Math.max(0, distanceFromOrigin - DISTANCE_GRACE_RADIUS);
  return Math.min(DISTANCE_BUDGET_MULT_CAP, 1 + DISTANCE_BUDGET_RATE * scaled);
}

export function partySizeBudgetMult(partySize: number): number {
  const mult = PARTY_SIZE_BUDGET_MULT[partySize];
  if (mult === undefined) throw new Error(`partySizeBudgetMult: no multiplier for party size ${partySize}`);
  return mult;
}

export function effectiveEnemyBudget(baseBudget: number, s: EncounterScaling): number {
  return Math.round(
    baseBudget *
      tierBudgetMult(s.dimensionTier) *
      distanceBudgetMult(s.distanceFromOrigin) *
      partySizeBudgetMult(s.partySize),
  );
}

/** Reward scaling (flag #6): tier × distance only — party size never scales XP. Used by
 *  recordEncounterWon (encounter XP) and settleRun (contract reward, distance 0). */
export function scaledXp(base: number, dimensionTier: number | null, distanceFromOrigin: number): number {
  return Math.round(base * tierBudgetMult(dimensionTier) * distanceBudgetMult(distanceFromOrigin));
}

/** The HUD threat readout (§6.2): how much harder than baseline fights are HERE. */
export function threatMultiplier(dimensionTier: number | null, distanceFromOrigin: number): number {
  return tierBudgetMult(dimensionTier) * distanceBudgetMult(distanceFromOrigin);
}
```

Worked values (party 2): dim-0 wilderness at distance ≤ 2 → `6 × 1 × 1 × 1 = 6` (today's
exact budget — the required no-rebalance proof); distance 5 → ×1.21; distance 10 → ×1.56;
tier 1 near origin → wilderness 8, enemy-camp 25; tier 2 at distance 8 → enemy-camp
`18 × 1.8 × 1.42 = 46`. Party 4 multiplies all of the above by 1.4. XP: win at tier 1,
distance 5 → `scaledXp(25, 1, 5) = round(25 × 1.4 × 1.21) = 42`.

### 2.2 `shared/src/encounter/archetypes.ts` (new; export from `shared/src/index.ts`)

Pure data + pure functions. The server composes with them; the client resolves flavor copy
from the same catalog (TITLES/CONTRACTS precedent); tests script the rng.

```ts
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
```

Notes: `minCount` is intentionally advisory-at-fill-time (a slot stops early only when nothing
is affordable — with live pools' cost-1/2 units and shares of budgets ≥ 6, min counts are met
in practice; the floor guarantees non-emptiness in pathological cases). `weightedPick` and
`pickArchetype` consume rng draws in a FIXED order — the composition for `(runId, q, r)` is
fully determined, preserving the `Rng.perRun` discipline the old roller had.

### 2.3 `shared/src/encounter/encounter-profiles.ts` (edit)

`EncounterProfile` drops `tagWeights` (only the old roller read it) and gains
`archetypeWeights`:

```ts
export interface EncounterProfile {
  readonly enemyBudget: number;   // BASE budget — scaled by effectiveEnemyBudget at roll time
  readonly archetypeWeights: Partial<Record<ArchetypeId, number>>;
  readonly structureBudget: number;
  readonly structureStyle: "natural" | "ruins" | "fortified" | "arena";
}
```

The full replacement table (budgets and structure fields UNCHANGED from today; only the
composition column changes):

| EncounterType     | enemyBudget | archetypeWeights                      |
|-------------------|-------------|---------------------------------------|
| wilderness        | 6           | horde 3, ambush 2, warband 1          |
| dense-wilderness  | 8           | horde 3, ambush 2, guardian 1         |
| enemy-camp        | 18          | warband 3, horde 1, ambush 1          |
| elite-encounter   | 25          | warband 2, guardian 2                 |
| boss              | 35          | guardian 1                            |
| calamity          | 50          | guardian 2, warband 1                 |
| town              | 8           | garrison 1                            |
| city              | 16          | garrison 1                            |
| gateway-city      | 16          | garrison 1                            |
| gateway           | 16          | garrison 2, warband 1                 |
| ruins             | 12          | guardian 1, ambush 1, horde 1         |
| great-ruins       | 18          | guardian 2, warband 1                 |
| treasure          | 10          | horde 2, ambush 2                     |
| great-treasure    | 18          | guardian 2, ambush 1                  |

Rationale anchors: boss hexes are ALWAYS a guardian (one big anchor + parasites — the fight
locked #3's slay-boss contract points at); towns/cities/gateway-cities are always garrisons
(the "themed fights" of locked #11 — tanks holding a line with ranged behind); plain
wilderness leans horde/ambush so early roaming reads as vermin and skirmishers, not elites.

### 2.4 `shared/src/overworld/rest.ts` (new; export from `shared/src/index.ts` next to `movement-vote.js`/`contracts.js`)

```ts
import type { HexIconType } from "../map/hex-map.js";

/** Locked #11: towns and cities (gateway-city is a city) become safe rest nodes once cleared
 *  this run. Plain gateways are portals, not settlements — excluded. */
export const REST_NODE_ICONS: readonly HexIconType[] = ["town", "city", "gateway-city"];

export function isRestNodeIcon(icon: HexIconType | null): boolean {
  return icon !== null && REST_NODE_ICONS.includes(icon);
}

/** Rested (flag #2): every hero starts the party's NEXT combat with this much barrier. */
export const REST_BARRIER_HP = 30;   // vs player hp 120 — one big enemy hit absorbed
```

### 2.5 `shared/src/encounter/encounter.ts` (rewrite of the composition half)

`scoreEnemy` and the old `rollEnemies` are DELETED. `selectMap`, `rollStructures`,
`structureWeight`, and the map-source selection are untouched.

```ts
import type { EnemyTag, UnitTemplate } from "../core/types.js";
import type { Dimension, StructureEntry } from "./dimension.js";
import type { MapObjectPlacement } from "../map/map-definition.js";
import { placeObjects } from "../map/map-definition.js";
import { Rng } from "../core/rng.js";
import type { EncounterProfile, EncounterType } from "./encounter-profiles.js";
import { getEncounterProfile } from "./encounter-profiles.js";
import type { EncounterScaling } from "./difficulty.js";
import { effectiveEnemyBudget, MAX_ENCOUNTER_ENEMIES } from "./difficulty.js";
import type { ArchetypeId } from "./archetypes.js";
import { pickArchetype, fillArchetype } from "./archetypes.js";

export interface GeneratedEncounter {
  readonly enemies: readonly UnitTemplate[];
  readonly map: EncounterMapSource;
  /** The themed group this encounter rolled (combat banner + tests). */
  readonly archetype: ArchetypeId;
  /** effectiveEnemyBudget(profile.enemyBudget, scaling) — telemetry/test handle. */
  readonly effectiveBudget: number;
}

export function generateEncounter(
  hexType: EncounterType,
  dimension: Dimension,
  x: number,
  y: number,
  runId: number,
  scaling: EncounterScaling,          // REQUIRED (flag #9)
): GeneratedEncounter {
  const profile = getEncounterProfile(hexType);
  const layoutRng = Rng.seeded(x, y);
  const enemyRng = Rng.perRun(runId, x, y);

  const effectiveBudget = effectiveEnemyBudget(profile.enemyBudget, scaling);
  const archetype = pickArchetype(profile.archetypeWeights, enemyRng); // draw #1
  const enemies = fillArchetype(dimension.enemies, archetype, effectiveBudget,
    MAX_ENCOUNTER_ENEMIES, enemyRng);                                  // draws #2..n

  const { mapImage, maskImage } = selectMap(hexType, dimension, x, y);
  const map: EncounterMapSource = mapImage
    ? { kind: "image", mapImage, maskImage }
    : { kind: "structures", structures: rollStructures(dimension.structures, profile, layoutRng) };

  return { enemies, map, archetype: archetype.id, effectiveBudget };
}
```

Determinism: unchanged seams — `layoutRng` still `Rng.seeded(x,y)` (map/structures identical
per hex forever), `enemyRng` still `Rng.perRun(runId,x,y)` (composition fixed per run+hex; a
new run re-rolls). The archetype pick is the enemy stream's first draw, so archetype AND fill
are reproducible from `(runId, x, y)` alone.

---

## 3. Wire protocol (shared/src/net/protocol.ts)

`PROTOCOL_VERSION` bumps **6 → 7** (02 took 3→4, 04 → 5, 03 → 6; a same-push deploy shows one
refresh banner).

### 3.1 Changed DTOs

```ts
// RoomStatePayload (post-03 shape) gains one field:
export interface RoomStatePayload {
  // ...existing (incl. 02 contract/outcome, 04 dimensionName/dimensionTier, 03 lootPool)...
  /** True while the party carries an unconsumed rest (reconnect-safe truth; flag #2/#8). */
  readonly rested: boolean;
}

// combatStart (267) gains the themed-group id (client resolves name/flavor via ARCHETYPES):
  | { type: "combatStart"; encounterHex: HexCoord; archetype: ArchetypeId }

// NEW — broadcast at rest-grant time (toast + HUD refresh; consumption rides the combat
// entry's roomState broadcast, so no rested:false send exists in v1):
  | { type: "restUpdate"; rested: boolean }
```

(`ArchetypeId` is imported from `../encounter/archetypes.js` — protocol.ts already imports
from sibling shared modules.)

No new ClientMessages and no new ErrorCodes: this feature adds zero client→server surface.
All new sends go through `io`/broadcast (envelope `seq` discipline).

---

## 4. Server flows

### 4.1 Room state (room.ts, both construction sites + reconstruction)

```ts
// Room:
  rested: boolean;   // unconsumed rest buff; ephemeral (flag #3)
```

Init: `createRoomFor` Room literal (index.ts:387) — `rested: false`. `reconstructRoomForRun` —
`rested: false` (documented crash loss, flag #3). `resetToOrigin` — `room.rested = false`
(fresh run). `travelToDimension` (04) — no explicit write: the `dimension-entered` rest
recorder (§4.4) grants rest on arrival at the destination's origin town, which also covers the
pre-existing value. `roomStatePayload` (room-machine.ts:128) adds `rested: room.rested`.

### 4.2 Combat entry scaling + rest consumption (room-machine.ts `beginCombatEntry`, 1012)

The synchronous pre-await block (R7 discipline — everything the build needs is snapshotted
before the await) gains two lines, and the create call gains two fields:

```ts
const specs = room.seats.map(seatBuildSpec);
const hexType = encounterTypeFor(room, target);
const rested = room.rested;
room.rested = false;                     // consumed on combat entry — one fight per rest
broadcastRoomState(room, io);            // existing broadcast: now carries rested: false

let session: EncounterSession;
try {
  session = await EncounterSession.createEncounter({
    seats: specs,
    hexType,
    hexCoord: target,
    runId: room.runId,
    dimensionId: room.dimensionId,
    dimensionTier: room.dimensionTier,   // 04's cached tier (null for unplaced dev dims)
    rested,
  });
} catch (e) {
  console.error(`[room] encounter build failed: ${(e as Error).message}`);
  if (room.generation === gen) {
    room.rested = rested;                // build failed -> the rest was not spent
    // ...existing failure restore (phase overworld, pendingHex null, broadcast)...
  }
  return;
}
```

And the combat-start broadcast (1058) becomes:

```ts
io.broadcast(room, { type: "combatStart", encounterHex: target, archetype: session.archetype });
```

### 4.3 EncounterSession + encounter-builder

`EncounterSession.createEncounter` opts gain `dimensionTier: number | null` and
`rested: boolean`; the session exposes the roll:

```ts
// encounter-session.ts
readonly archetype: ArchetypeId;         // set in the private constructor from the encounter

const encounter = generateEncounter(hexType, dimension, hexCoord.q, hexCoord.r, runId, {
  dimensionTier,
  distanceFromOrigin: hexDistance(hexCoord, { q: 0, r: 0 }),   // every dim's origin is (0,0)
  partySize: seats.length,               // = capacity; bots included by design (they fight)
});
...
const entities = placeEncounterEntities(encounter, map.grid, seats, rested);
```

`placeEncounterEntities(encounter, grid, seats, rested)` (encounter-builder.ts:28) — the hero
spread (45) gains the barrier stamp:

```ts
entities.set(seat.heroEntityId, {
  ...hero,
  playerAnimSet: seat.animSet,
  controllerId: seat.controllerId,
  ...(rested ? { barrier: REST_BARRIER_HP } : {}),
});
```

(Enemies never rest. `Entity.barrier` is already serialized/rendered — zero combat-sim or
client-renderer changes.)

### 4.4 Rest recorders (server/src/run-recorders.ts) + registry

One core function, three thin typed recorders (the bus types handlers per event):

```ts
/** Rest grant (flag #8): arriving on a cleared rest node makes the party Rested. */
function grantRest(room: Room, io: RoomIO, icon: HexIconType | null): void {
  if (!isRestNodeIcon(icon)) return;
  if (room.rested) return;                                   // idempotent, no broadcast spam
  room.rested = true;
  io.broadcast(room, { type: "restUpdate", rested: true });
}

export function restOnArrivalRecorder(room, io, ev: Extract<RunEvent, {type:"hex-entered"}>): void {
  grantRest(room, io, ev.icon);
}
export function restOnClearRecorder(room, io, ev: Extract<RunEvent, {type:"encounter-won"}>): void {
  grantRest(room, io, ev.icon);
}
export function restOnTravelRecorder(room, io, ev: Extract<RunEvent, {type:"dimension-entered"}>): void {
  grantRest(room, io, "town");   // 04's commitTravel lands the party on the auto-cleared origin town
}
```

Recorder discipline holds (02 §4.1): they mutate a Room field and push, never touch
phase/vote/session, never await. The `run-events.ts` static REGISTRY (final, post-05 —
supersedes 03 §4.2's listing):

```ts
const REGISTRY: readonly RunEventRegistration[] = [
  on("run-started", recordRunStarted),
  on("encounter-won", recordEncounterWon),         // 02 (edited here: scaled XP, §4.5)
  on("encounter-won", contractProgressRecorder),   // 02
  on("encounter-won", gatewayAttunementRecorder),  // 04
  on("encounter-won", lootDropRecorder),           // 03
  on("encounter-won", restOnClearRecorder),        // 05
  on("hex-entered", restOnArrivalRecorder),        // 05 — hex-entered's first consumer
  on("run-ended", recordRunSettled),               // 02
  on("run-ended", codexBankingRecorder),           // 03
  on("dimension-entered", recordDimensionEntered), // 04
  on("dimension-entered", restOnTravelRecorder),   // 05
];
```

Ordering notes: rest recorders are last within their events (independent of XP/contract/
gateway/loot state). On a win that completes the contract, `settleRun` fires after the emit —
`room.rested` may flip true first; harmless (gameover ignores it; `resetToOrigin`/rematch
reset it). On travel, `restOnTravelRecorder` runs during the emit, BEFORE `travelToDimension`'s
`broadcastRoomState` — the arrival roomState already carries `rested: true`.

Broadcast coverage audit (why `restUpdate` exists): the `hex-entered` grant happens inside
`finalizeMove`'s pure-move branch, which broadcasts only `hexMapState` — without `restUpdate`
the client would not learn `rested` until the next roomState. The other two grant paths get
roomState broadcasts anyway; `restUpdate` still fires there for the uniform toast.

### 4.5 XP scaling (run-recorders.ts `recordEncounterWon` — 02 §9's reserved one-call-site edit)

```ts
const amount = scaledXp(XP_ENCOUNTER_WIN, room.dimensionTier, hexDistance(ev.hex, ORIGIN));
const pending = accruePendingXp(ev.runId, accountId, amount);
...
io.send(seat, { type: "xpAward", amount, pending });
```

(`ORIGIN` = `{q:0,r:0}` — import the existing const; 04 already moved `DISCOVERY_RADIUS` into
room-machine.ts, put `ORIGIN` alongside it if import direction demands.) Everything else in
the recorder (stats, titles, pushes) is unchanged; the pending ledger and banking multipliers
(02) are untouched — harder fights simply accrue more.

### 4.6 Contract reward scaling (room-machine.ts `settleRun` — 02 §4.4's snippet, one line)

```ts
if (outcome === "victory") {
  const startMeta = getDimensionMeta(room.startDimensionId);
  if (!startMeta) throw new Error(`settleRun: start dimension ${room.startDimensionId} missing`);
  const reward = scaledXp(contractById(room.contract!.type).xpReward, startMeta.tier, 0);
  for (const seat of eligibleSeats(room)) accruePendingXp(room.runId, seat.accountId!, reward);
}
```

The run's START tier prices the contract (the contract was chosen against that dimension's
map, 02 flag #12); distance is 0 (a contract is not hex-local). Tier 0 = today's exact reward
values. A NULL start tier (dev-override run) scales as tier 0 via `scaledXp`'s
`effectiveTier` (flag #4).

### 4.7 Crash / reconnect / sweep behavior

- Reconnect into any phase: `roomState.rested` restores the HUD chip; no transient message is
  replayed (restUpdate is toast-only sugar).
- Crash recovery: `rested` rehydrates false (flag #3 — one walk-back re-arms). Encounter
  composition after recovery is unaffected: `Rng.perRun(runId, q, r)` re-derives identical
  fights for the same run.
- Sweep/abandon paths (`deactivateStaleRuns`, `abandonPriorSeatForClient`): no interaction —
  rest and scaling live entirely inside the in-room machine.
- Legacy contract-less runs (02 flag #11): scaling and rest work normally (they key off
  dimension tier + position, not contracts).

---

## 5. Tunable constants (single table)

| Constant | Value | Lives in |
|---|---|---|
| `TIER_BUDGET_RATE` | 0.4 (+40%/tier) | shared/encounter/difficulty.ts |
| `DISTANCE_GRACE_RADIUS` | 2 hexes | shared/encounter/difficulty.ts |
| `DISTANCE_BUDGET_RATE` | 0.07 (+7%/hex past grace) | shared/encounter/difficulty.ts |
| `DISTANCE_BUDGET_MULT_CAP` | 2.5× | shared/encounter/difficulty.ts |
| `PARTY_SIZE_BUDGET_MULT` | 2→1.0, 3→1.2, 4→1.4 (**flag #1 anchor**) | shared/encounter/difficulty.ts |
| `MAX_ENCOUNTER_ENEMIES` | 12 | shared/encounter/difficulty.ts |
| `BASELINE_SCALING` | tier 0 / dist 0 / party 2 (identity) | shared/encounter/difficulty.ts |
| XP scaling | `scaledXp` = base × tier mult × dist mult (party excluded) | shared/encounter/difficulty.ts |
| Archetype set + slots | §2.2 tables (shares/counts/biases) | shared/encounter/archetypes.ts |
| `archetypeWeights` per icon | §2.3 table | shared/encounter/encounter-profiles.ts |
| Base `enemyBudget` per icon | unchanged (6–50) | shared/encounter/encounter-profiles.ts |
| `REST_NODE_ICONS` | town, city, gateway-city | shared/overworld/rest.ts |
| `REST_BARRIER_HP` | 30 | shared/overworld/rest.ts |

---

## 6. Client (ui-kit THEME language throughout; no new colors)

### 6.1 main.ts wiring (composition root)

- `conn.on("restUpdate", (msg) => { if (msg.rested) pushToast("The party rests — fortified for the next battle."); })`
  — the existing gold toast stack.
- `conn.on("combatStart", (msg) => pushToast(archetypeById(msg.archetype).flavor))` — shared
  catalog resolve (TITLES precedent), e.g. "A warband bars the way." No screen changes: phase
  switching still rides roomState; this is flavor only.
- `client/dev/mock-data.ts` roomState fixtures gain `rested: false` (typecheck vs the v7
  payload).

### 6.2 ContractHud (renderer/contract-hud.ts — extends 02 §6.2 / 04 §6.3 in place)

Two additions and one visibility amendment:

- **Visibility**: was `phase === "overworld" && contract` (02); becomes
  `phase === "overworld"` with the contract block rendered only when `contract` is non-null.
  The HUD is now also the difficulty/rest readout, which exists for every run (including
  legacy contract-less ones).
- **Threat line** (bottom of the panel, above 02's pending-XP chip; `12px ${FONT.body}`):
  `Threat ×${t.toFixed(1)}` where
  `t = threatMultiplier(room.dimensionTier, hexDistance(playerPos, {q:0,r:0}))` — shared
  import + the HUD's existing `getHexMapState` getter; recomputed on the existing
  `setHexMap`/SeatContext re-render triggers. Color: `THEME.muted` while `t < 1.5`,
  `THEME.gold` for `1.5 ≤ t < 2`, `THEME.danger` for `t ≥ 2`. (Client-computed — zero
  protocol, flag #11.)
- **Rested chip** (rendered iff `room.rested`, directly under the eyebrow row; `12px;
  color: ${THEME.green}`): `Rested — fortified for the next battle` with a small `+${REST_BARRIER_HP}`
  suffix in `THEME.faint`. Disappears on its own when the consuming combat entry's roomState
  lands (`rested: false`).

### 6.3 No other surfaces

Rest nodes need no map-screen affordance in v1 (the toast + chip carry the UX; the icons are
already towns/cities on the map). OPTIONAL, explicitly deferrable: a small green glow on
cleared rest-node hexes in HexMapRenderer.

---

## 7. Migration / compat behavior for existing data

1. **No DB migration.** `user_version` stays 9. Nothing to backfill: scaling derives from
   existing tier/position data at roll time; rest state is ephemeral.
2. In-flight runs at deploy: fights re-roll under archetypes on their next combat entry (the
   per-hex composition changes mid-run — acceptable; composition was already per-run random).
   `rested` starts false everywhere.
3. Near-origin dim-0/dim-1 capacity-2 rooms: budgets, XP amounts, and contract rewards are
   numerically identical to today (multiplier identity — the no-rebalance requirement). What
   changes everywhere is composition SHAPE (themed groups instead of weighted piles).
4. Protocol 6 clients get `protocolMismatch` + the refresh banner (existing UX).
5. **Balance tooling** (task requirement):
   - `scripts/sim-battle.ts` — untouched (fixed rosters, never calls `generateEncounter`).
   - `hero-arena/src/t2/balance-test.ts:286` — call updated to
     `generateEncounter(profile, dimension, seed, seed * 7, seed * 13, BASELINE_SCALING)`
     (flag #9). CLI + report schema unchanged. Its solo/party direct-budget scenarios
     (`SOLO_BUDGETS`/`PARTY_BUDGETS`) are completely unaffected; its `encounter-*` scenarios
     now sample ARCHETYPE compositions, so pre-/post-feature-5 encounter-scenario numbers are
     not apples-to-apples — **regenerate the dim-0 reference report**
     (`balance-report-dim-0.json`) after this lands, per the balance-test skill's
     cross-dimension comparison workflow.
   - `generate-dimension` pipeline: no entry-point changes. Note for the skill docs (not this
     feature's code): archetype fill leans on tag coverage — keep the generator's current
     guarantee that every roster covers all six `ENEMY_TAGS` (verified true for all 15
     shipped rosters).
6. Difficulty plateau (flag #12) documented as a known ceiling, not a bug.

---

## 8. Test plan (`bun test` from repo root; typecheck via `bun run typecheck`)

Patterns: pure shared tests need no DB; machine-level tests use the stub-RoomIO pattern (02's
run-outcomes / 04's travel / 03's loot-claim suites); end-to-end uses `coop-harness.ts`.

**shared/src/__tests__/difficulty.test.ts** (new)
- `effectiveEnemyBudget(base, BASELINE_SCALING) === base` for every profile budget (the
  no-rebalance identity proof).
- `tierBudgetMult`: 0→1.0, 1→1.4, 2→1.8; null→1.0 (flag #4).
- `distanceBudgetMult`: 0/1/2→1.0 (grace), 3→1.07, 10→1.56, huge→capped 2.5.
- `partySizeBudgetMult`: 2/3/4 table values; 1 and 5 throw (fail loud).
- `effectiveEnemyBudget` rounding + combined math on two worked examples from §2.1.
- `scaledXp`: baseline identity (25 stays 25); tier 1 dist 5 → 42; party size provably absent
  from the signature; `threatMultiplier` spot values.

**shared/src/__tests__/archetypes.test.ts** (new)
- Catalog sanity: every `ArchetypeId` resolves via `archetypeById` (unknown throws); every
  profile's `archetypeWeights` keys resolve; every slot's `budgetShare` sums to ~1 per
  archetype (tolerance — documented shares).
- `pickArchetype`: deterministic under a scripted rng; respects weights (boss profile → always
  guardian); throws on an empty weight table.
- `fillArchetype` determinism: same pool + budget + fresh `Rng.perRun(7, 3, -2)` twice →
  identical template sequences.
- Tag matching: a dim-0-shaped pool under `warband` puts an elite-tagged unit in the leader
  slot; `guardian` anchor is boss/elite-tagged; slot with no matching tags (pool stripped of
  `ranged`) falls back to the whole pool (flag #5 ladder).
- Budget discipline: total cost ≤ budget + the single floor unit; overflow spends leftover
  (guardian at budget 50 fields more than anchor+5 minions' nominal cost); `maxEnemies` caps a
  horde at 12 even with huge budgets.
- Floor: pool of one cost-99 unit at budget 6 → exactly that one unit (flag #5 floor);
  empty pool → [].
- Bias: with a scripted rng, "heavy" on {cost 2, cost 14} picks cost 14 with weight
  196/200; "light" inverts.

**shared/src/__tests__/encounter.test.ts** (new)
- `generateEncounter(..., BASELINE_SCALING)` twice with the same `(runId, x, y)` → identical
  enemies + archetype + map (determinism regression, both rng streams).
- Different `runId` → composition may differ, map identical (`Rng.seeded` vs `Rng.perRun`
  separation).
- `archetype` ∈ the profile's weight table for every EncounterType; `effectiveBudget`
  reported = `effectiveEnemyBudget(profile.enemyBudget, scaling)`.
- Scaled call (tier 2, dist 8, party 4) yields total enemy cost ≤ effectiveBudget and count ≤
  12.

**server/src/__tests__/rest.test.ts** (new, machine-level, stub RoomIO)
- `hex-entered` with icon "town"/"city"/"gateway-city" → `room.rested` true +
  `restUpdate{rested:true}` broadcast; "ruins"/null → no grant; second grant while rested →
  no duplicate broadcast.
- `encounter-won` at a town → grant; at a plain hex → none. `dimension-entered` → grant.
- Combat entry consumes: `beginCombatEntry` on a rested room → heroes carry
  `barrier === REST_BARRIER_HP` in the built session, enemies carry 0, `room.rested === false`,
  the pre-build roomState broadcast carries `rested:false`; un-rested room → barrier 0.
- Build failure restores: force `createEncounter` to throw (bad dimension) → `room.rested`
  back to true.
- `resetToOrigin` → rested false. `reconstructRoomForRun` → rested false (flag #3).
- Scaled XP: `recordEncounterWon` at tier 1/dist 5 accrues 42 (not 25) into the pending
  ledger and pushes `xpAward{amount:42}`; tier 0/dist ≤2 accrues exactly 25 (02 regression).
- `settleRun("victory")` on a tier-2-start run accrues `scaledXp(reward, 2, 0)`; tier-0 run
  accrues the flat reward (02 regression).

**server/src/__tests__/coop-integration.test.ts additions** (harness, end-to-end)
- Combat entry broadcast: start → move onto an unexplored hex → both sockets receive
  `combatStart` with an `archetype` string resolvable via `archetypeById`.
- Rest end-to-end: override a nearby hex's community icon to "town" → win it (debugWin skips
  combat but drives `encounter-won`) → both sockets get `restUpdate{rested:true}` and
  roomState `rested:true`; enter the next fight → roomState `rested:false`.
- Party-size scaling smoke: capacity-4 room's first real combat session fields total enemy
  cost ≤ `effectiveEnemyBudget(base, {tier, dist, partySize:4})` (assert via the session's
  serialized entities if exposed to the harness, else via a machine-level test instead).

**Existing-suite mechanical updates**
- `db-migration-idempotency.test.ts`: UNCHANGED (`user_version === 9`) — assert no diff.
- roomState-shape assertions across 01–04 suites gain `rested: false`; `combatStart`
  destructuring gains `archetype`; protocol version consts move to 7.
- `hero-arena/src/t2/balance-test.ts:286` updated per flag #9 (not a test, but typecheck
  gates it).

**Regression clause**: 02's contract/retreat/banking, 03's loot/codex/manifest, and 04's
travel/gateway suites pass with the mechanical updates only. Seat reclaim, crash recovery,
host migration, discovery, HMAC, and the golden-master combat determinism suite are asserted
unchanged (this feature never touches the combat resolver — barrier stamping happens at
entity construction, upstream of the sim).

---

## 9. Cross-feature changes (edits made to predecessor docs by this design)

**None.** The two predecessor code edits this feature makes were both pre-authorized as seams:
02 §9 explicitly reserved the `recordEncounterWon` XP amount and `CONTRACTS[*].xpReward`
scaling for feature 5 (§4.5/§4.6 here), and 02/04 pre-declared `hex-entered`'s first consumer
as feature 5's rest nodes (§4.4 here). 04 §10's committed difficulty inputs
(`room.dimensionTier`, `hexDistance`) are consumed verbatim, extended only by party size
(capacity — pre-existing Room state). 03 §10's `rollDrops` scaling seam is deliberately left
unconsumed (flag #7). The ContractHud extension (§6.2) follows 04 §6.3's precedent of
extending 02's component in the successor doc. 03 §4.2's "final" REGISTRY listing is
superseded by §4.4 here, exactly as 04 superseded 02's — the registry remains greppable in
one place in code.

---

## 10. Post-push seams this design leaves open (non-binding notes for future work)

- **Deeper-tier hardness beyond the plateau** (flag #12): tier-aware enemy stat multipliers
  would slot into `fillArchetype`'s return (map templates through a `scaleTemplate(t, tier)`)
  — one function, no structural change. Alternatively the generator pipeline can target
  higher cost ceilings for pool dims destined for deep tiers.
- **Drop scaling** (flag #7): wrap `richnessForIcon` in 03's `lootDropRecorder` with a
  tier/distance bump — one call site, per 03 §10.
- **Rest v2**: shops/NPCs at rest nodes (master doc "later layer"); the grant/consume plumbing
  and `restUpdate` message generalize (the boolean can become a rest-effect payload).
- **Archetype-aware spawn placement**: `placeEncounterEntities` currently grids enemies
  generically; ambushes could spawn flanking. Cosmetic, deferred.
