# Feature 4 — Portals & Tiered Multiverse: Final Design

Status: FINAL — the design doc referenced by `docs/meta-loop/README.md:80`. Written 2026-07-01
against HEAD `47459b6` (feature 1 committed) with `docs/meta-loop/02-contracts.md` treated as a
binding, already-implemented contract (feature 2 lands before this feature per the build order
1 → 2 → 4 → 3 → 5). Anchors into feature-2 artifacts use 02's names (`settleRun`,
`run-events.ts`, `RoomVote`, protocol v4); anchors into pre-feature-2 code use line numbers
verified at HEAD today — they shift once 02 lands, the names do not.

Verified ground truth this design builds on:

- `server/src/db.ts` (918 lines at HEAD) — migrations gated on `PRAGMA user_version`; feature 2
  adds the v7 block (02 §1.2), so this feature is **v8**, inserted directly after v7.
  `dimensions` table (34-52): `id, name, structures_json, background_path,
  hex_decorations_path, status` — status values in the live DB are `'approved'` and
  `'in_review'` only (generator writes `in_review` at init, `set-status` promotes to
  `approved`; the status column's ALTER default backfilled every pre-generator row as
  `approved`, including incomplete ones). `run_cleared_hexes` (134-140) is keyed
  `(run_id, q, r)` — **no dimension column**; `commitExplore` (415) writes discovery + icon +
  cleared + party pos in one transaction; `markRunCleared` (395), `loadRunCleared` (399).
  `runs.dimension_id` is written ONLY by `insertRunStmt` (448) — never updated after creation.
  `startNewRun` (473), `RunRow` (432), `finalizeRun` (503, first-writer-wins via
  `AND active = 1`), `seedDiscovery` (377), `loadSeatInventory` (689 — merges
  `loadItems(0..3) + loadItems(currentDim)`, the narrow-merge gotcha this feature removes),
  `saveItems` (880 — **enforces globally-unique item ids across dimensions**, which is what
  makes global id resolution sound), `loadDimension` (798), `listDimensions` (842),
  `eraseClient` (540).
- Live DB (`server/hex-discovery.sqlite`, user_version 5 — v6/v7 apply on next boot):
  16 dimension rows; per-dim completeness inspected (see the tier table in §0.2).
  `discovered_hexes` exist for dims 0, 1, 700, 704, 705; runs exist for 0 (26), 1 (805),
  700 (3), 704 (12), 705 (8). `account_dimensions` does not exist yet (v6 pending), so there is
  **no charted-address data to grandfather** — charting starts accruing at deploy.
- `server/src/index.ts` — `DISCOVERY_RADIUS = 15`, `DEFAULT_DIMENSION = 1` (146-147);
  `createRoomFor` (356) does the run-create durable block (startNewRun, seedDiscovery,
  discoverHex origin, origin icon `"town"`, markRunCleared origin); `handleCreateRoom` (348)
  accepts **any** `msg.dimensionId` unvalidated; `handleJoinRoom` (456);
  `sendSeatSnapshots` (244); `handleStartGame` (596); `handlePlayAgain` (672 — rematch room at
  `room.dimensionId`); `detachSeat` lobby branch (935).
- `server/src/room-machine.ts` — `roomStatePayload` (128), `hexMapStatePayload` (206),
  `endCombat` (1070), `exploreHex` (1117), `resetToOrigin` (1135 — reseeds hexMap at the SAME
  `room.dimensionId`), `reconstructRoomForRun` (1399 — rehydrates from `runRow.dimension_id` +
  `loadRunCleared(runId)`), vote block (872-992, generalized by 02 into `RoomVote`
  kind `"move" | "retreat"` + `resolveOpenVote`), `VOTE_TIMEOUT_MS` (88).
- `server/src/room.ts` — `Room` (110), `buildPresetInventory` (196 — same 0-3 merge),
  `createOpenSeats` (233).
- `server/src/accounts.ts` — `recordDimensionSeen` (403) writes `account_dimensions`
  (`INSERT OR IGNORE`, first insert bumps `dimensions_discovered`); 01-accounts §1.2 states
  `account_dimensions` "intentionally doubles as feature 4's charted-addresses source".
- `server/src/awards.ts` → 02 renames to `run-recorders.ts`; `eligibleSeats` (22) is the
  attribution gate every new recorder reuses. `run-events.ts` (02 §4.1) is the static registry
  this feature plugs into; 02 pre-declared the `hex-entered` event for feature 4's use.
- `shared/src/map/hex-map.ts` — `HEX_ICON_TYPES` includes `gateway`, `gateway-city`;
  `pickIconForHex` (61) is deterministic on `(q, r)` ONLY — **every dimension shares the same
  derived icon layout** (community overrides record the same values). A gateway hex in dim A is
  a gateway hex at the same coords in dim B. Known quirk, not fixed here; gateway identity is
  `(from_dimension, q, r)` so nothing breaks. `getHexIcon` (72).
- `shared/src/net/protocol.ts` — feature 2 leaves this at `PROTOCOL_VERSION = 4` with
  `VoteStatePayload{kind, target: HexCoord | null}` (02 §3.1); this feature bumps to **5**.
- `shared/src/overworld/contracts.ts` (02 §2.2) — `isRetreatHex(icon)` is the "party stands on
  a cleared gateway" stance predicate; `applyContractEvent`'s `activate-gateway` arm completes
  on clearing any gateway/gateway-city hex; `ContractHexEvent.clearedCount` feeds chart-hexes.
- Client — `main.ts`: `roomState` listener already reloads dimension sprites when
  `room.dimensionId` changes (295-300) and the combat switch awaits `dimensionReady` (428-434),
  so **mid-run travel needs zero new asset plumbing**; overworld rendering
  (`HexMapRenderer`) uses generic map-icon art, not dimension backgrounds — no overworld art
  swap needed either. `LobbyScreen` header hardcodes `Dimension ${room.dimensionId} · Gateway
  City` (122); 02 adds the contract board section + ContractHud + generalized VotePanel.
- Tests — `db-migration-idempotency.test.ts` (two-subprocess pattern; 02 moves it to 7 — this
  feature moves it to **8**); `coop-harness.ts`; 02's `run-outcomes.test.ts` machine-level
  pattern (stub RoomIO).

---

## 0. Flags & decisions (read first)

Orchestrator: items 1-6 are the load-bearing decisions Ben should eyeball; 7-14 are smaller
calls. None contradict a locked decision; #1 and #2 interpret locked #8's "pool at tier+1"
wording — flag them prominently.

1. **DECISION — tier is assigned at attunement time, not pre-assigned to pool dimensions.**
   `dimensions.tier` is `INTEGER NULL`. NULL = "not yet placed in the multiverse" (a pool
   candidate once ready). When a gateway in a tier-`t` dimension first attunes, the chosen pool
   dimension gets `tier = t + 1` in the same transaction as the gateway insert. Consequences:
   ONE pool serves every tier (no per-tier starvation — the master's "pool empty for tier+1"
   collapses to "pool empty"); the multiverse is a tree rooted at tier 0 whose tiers equal
   descent depth by construction; content difficulty does NOT need to be pre-matched to tier
   because feature 5 scales encounter budgets by tier at runtime. **Alternative** (rejected but
   cheap to switch to): pre-assign tiers to generated dims and pool per-tier — requires the
   generator/Ben to tier every new dim and reintroduces per-tier starvation. **Ben: confirm.**
2. **FLAG — concrete tier backfill for all 16 existing dimensions** (§0.2 table). Tier 0 =
   dims 0 and 1 (locked: dim 0; dim 1 is the server `DEFAULT_DIMENSION` — note the shipped
   client actually defaults `?dim=0`, so both are "current defaults"). Proposed: 2 and 501 at
   tier 1, 3 at tier 2, everything else NULL. **The 1/2/501/3 placements are judgment calls —
   Ben must adjust the UPDATE statements in §1.2 before this ships.**
3. **DECISION — "ready" (pool/startable) is a data-completeness predicate, not bare status.**
   `READY(d) := status = 'approved' AND background_path IS NOT NULL AND has ≥1 enemy_template
   AND has ≥1 item`. Bare `status = 'approved'` is polluted: the status column's ALTER default
   marked incomplete legacy rows approved (4 and 100 and 500 lack backgrounds; 502 has zero
   items; 703 has zero enemies — verified against the live DB). Encounter-map manifests are NOT
   required (dims 2/3 play fine without one). Recommend Ben demote the five incomplete rows to
   a non-approved status (`bun dimension-generator/auto/set-status.ts`) for hygiene; the
   predicate keeps them out of the pool either way. **No status rows are rewritten by the
   migration** — the generator tooling owns `status`.
4. **DECISION — pool-empty is loud and retriable, never a fallback.** When a gateway hex is
   first cleared and no pool candidate exists: NO gateway row is written, the server logs
   `console.error("[gateways] attunement pool EMPTY …")`, and a `gatewayUpdate{gateway: null}`
   broadcast drives explicit player-facing copy ("The gateway is unattuned — nothing lies
   beyond yet"). The Descend button never renders for an unattuned gateway. Attunement is
   **re-attempted** on every later `proposeTravel` at that hex (and on any later re-clear in a
   future run), so replenishing the pool out-of-band (generate + approve) heals every
   previously-starved gateway with zero migration. FALLBACK: none — the run simply cannot
   descend there until the pool refills; retreat (02) remains available at the same hex.
5. **DECISION — run-start eligibility = `READY AND tier IS NOT NULL AND (tier = 0 OR charted
   by a seated account)`; enforced server-side at `chooseDimension` AND `createRoom`/
   `quickMatch`.** Tier-0 dims are the always-available surface (the task's "plus dim 0"
   generalized: dim 1 is also tier 0 and today's actual default — excluding it would break
   every existing client flow). Deeper dims require an `account_dimensions` row for at least
   one seated human account. **Dev escape hatch**: `GAME_ALLOW_UNCHARTED_DIMENSIONS=1` skips
   the eligibility check (NOT the existence check) so Ben's `?dim=705` playtest flow for
   in_review/tierless dims keeps working; it is an explicit env knob, logged once at boot, not
   a silent fallback. **Ben: confirm the knob.**
6. **DECISION — `resetToOrigin` and Play-Again rematch return to `startDimensionId`, not the
   current depth.** A run that traveled 0 → 2 → 5 and wipes restarts (host Reset / Play Again)
   at the run's lobby-picked start dimension. Rationale: depth was earned by descent through
   gateways within a run; a wipe forfeits it (locked #7 spirit). The party CAN still lobby-pick
   any deep dimension they've charted (locked #9 — traveling into a dimension charts it via the
   `dimension-entered` recorder), so this costs nothing legitimate. `runs.start_dimension_id`
   (new column) makes it durable.
7. **DECISION — the activate-gateway contract keeps 02's "activated ≡ cleared" semantics;
   attunement is NOT required.** If pool-empty could fail the contract, an empty pool would
   brick a chosen contract mid-run. Clearing kindles the portal (contract fulfilled);
   attunement decides where it leads. `applyContractEvent`'s gateway arm is untouched.
8. **DECISION — chart-hexes counts cumulatively across travel.** `Room.runClearedCount` (new)
   counts combat-cleared hexes for the whole run, origins excluded, surviving dimension swaps
   and crash recovery (recovered via `COUNT(*) … WHERE NOT (q=0 AND r=0)` — every dimension's
   origin is `(0,0)` and always auto-cleared, never combat-cleared). 02's
   `ContractHexEvent.clearedCount` feed changes from `room.visitedThisRun.size - 1` to
   `room.runClearedCount` — a minimal amendment made directly in 02 (see §9 Cross-feature
   changes). Semantics ("hexes cleared this run, origins excluded") are unchanged for
   non-traveling runs.
9. **DECISION — item resolution goes global-by-id; the dims-0-3 merge dies.** `saveItems`
   already throws on cross-dimension id collisions, so an item id resolves to exactly one row.
   (One legacy row predates the check — `short-sword` in dims 0 AND 501; the v8 migration
   dedup-renames it, see §1.2 — amendment recorded in 03-loot-codex §9.)
   `loadSeatInventory` and `buildPresetInventory` stop merging `loadItems(0..3) +
   loadItems(current)` and resolve each id via a single `WHERE id = ?` lookup. This is a
   travel prerequisite (a bag carried from dim 501 must rehydrate after traveling to dim 707)
   and pre-work feature 3 needs anyway (drops/manifests from arbitrary dims). The pre-existing
   warn+skip on an unknown id in `loadSeatInventory` is kept as-is (pre-existing behavior, not
   a new fallback). `buildPresetInventory(presetId, dimensionId)` →
   `buildPresetInventory(presetId)`; `createOpenSeats(capacity, dimensionId)` →
   `createOpenSeats(capacity)`.
10. **DECISION — attunement from a tierless dimension is refused, loudly.** A dev-override run
    inside a NULL-tier dim (flag #5 knob) that clears a gateway gets the unattuned treatment +
    a distinct server log ("cannot attune from an untiered dimension"). Tierless dims are not
    part of the multiverse graph until linked; `t + 1` is undefined there. Feature 3 note: such
    runs also have a NULL starting tier — 03 must handle that explicitly (gate manifests to
    tier 0 or refuse), not silently.
11. **DECISION — pool selection is deterministic: lowest `id` first** (`ORDER BY d.id LIMIT 1`
    = oldest generated dimension links first). Testable, fair queue, zero RNG plumbing.
    Trivially swappable for a seeded shuffle later. Single server process + synchronous
    machine means no assignment races; the `UNIQUE(to_dimension_id)` constraint is the
    belt-and-suspenders backstop.
12. **DECISION — a lobby dimension change resets the contract selection.** Offers derive from
    the dimension's icon map (02 flag #12); after `chooseDimension` the server recomputes
    offers, re-assigns the same contract TYPE if still offered (fresh target hex) else nulls
    the selection, and re-sends `contractOffers` to every seat. This is the one case 02's
    "offers never re-broadcast" claim didn't foresee — amended in 02 (§9).
13. **DECISION — a seat leaving the lobby does not invalidate an already-chosen dimension.**
    Eligibility is validated at `chooseDimension` time against the then-seated accounts; the
    union rule is a discovery-sharing mechanic, not a security boundary. Re-validating at
    startGame would punish the host confusingly. **Ben: confirm.**
14. Small calls: `dimension_gateways.attuned_by_account_id` records the acting party's host
    account (cosmetic provenance for a future "first attuned by" credit — nullable, never
    read in v1). Travel votes reuse `VOTE_TIMEOUT_MS` (15s) and the movement-vote resolution
    math. Travel awards no XP itself (the descent payoff is loot tier, features 3/5); it bumps
    a new `dimensions_traveled` stat and seeds one title. `hex-entered` (02's pre-declared
    event) gains its first subscriber NOWHERE in this feature — gateway attunement keys off
    `encounter-won` (a gateway must be cleared first); rest-node arrival (feature 5) remains
    `hex-entered`'s first consumer.

### 0.2 Tier backfill — the concrete mapping (FLAG: Ben adjusts here)

Live `dimensions` rows, completeness audit (bg = background_path set; e/i = enemy/item counts),
and the proposed assignment baked into §1.2's migration:

| id  | name                | status    | bg | e  | i  | READY (flag #3) | **tier** | rationale |
|-----|---------------------|-----------|----|----|----|-----------------|----------|-----------|
| 0   | Greenlands          | approved  | ✓  | 8  | 17 | yes             | **0**    | locked #8: dim 0 = tier 0 |
| 1   | The Shallows        | approved  | ✓  | 16 | 4  | yes             | **0**    | server `DEFAULT_DIMENSION`; master: "current default … = tier 0" |
| 2   | The Gloom Hollows   | approved  | ✓  | 16 | 4  | yes             | **1**    | hand-built successor content; judgment call |
| 3   | The Gilt Barrens    | approved  | ✓  | 16 | 8  | yes             | **2**    | latest hand-built, richest kit; judgment call |
| 4   | The Scarlet Atelier | approved  | ✗  | 16 | 8  | no (no bg)      | NULL     | incomplete — recommend demoting status |
| 100 | Chalk Barrens       | approved  | ✗  | 16 | 10 | no (no bg)      | NULL     | incomplete — recommend demoting status |
| 500 | Thornwood           | approved  | ✗  | 16 | 8  | no (no bg)      | NULL     | incomplete — recommend demoting status |
| 501 | Clay Flats          | approved  | ✓  | 16 | 18 | yes             | **1**    | complete generated dim; judgment call |
| 502 | Thornwood (dup)     | approved  | ✗  | 16 | 0  | no (no items)   | NULL     | incomplete duplicate of 500 |
| 600 | The Smolder         | in_review | ✓  | 16 | 10 | no (in_review)  | NULL     | pool candidate on approval |
| 700 | Frostreach          | in_review | ✓  | 16 | 16 | no (in_review)  | NULL     | pool candidate on approval |
| 701 | Hornmarsh           | in_review | ✓  | 16 | 16 | no (in_review)  | NULL     | pool candidate on approval |
| 702 | Stormveldt          | in_review | ✓  | 16 | 16 | no (in_review)  | NULL     | pool candidate on approval |
| 703 | Bloomwild           | approved  | ✗  | 0  | 16 | no (no enemies) | NULL     | incomplete — recommend demoting status |
| 704 | Nestlands           | in_review | ✓  | 16 | 16 | no (in_review)  | NULL     | pool candidate on approval |
| 705 | The Sundered Crowns | in_review | ✓  | 16 | 16 | no (in_review)  | NULL     | pool candidate on approval |

Operational note: **replenishing the pool = `generate-dimension` + promote to `approved`**
(`dimension-generator/auto/set-status.ts`). At ship time the pool is EMPTY (all candidates are
in_review) — approving 600/700/701/702/704/705 gives six links of runway. The pool-empty path
(flag #4) is therefore the day-one behavior for gateway clears until Ben approves some.

---

## 1. Data model & migration (v8)

### 1.1 Design rules

- Same conventions as v3-v7: new columns on legacy integer-keyed tables keep INTEGER ids and
  INTEGER-ms timestamps; account references stay TEXT uuid; FKs declarative only
  (`foreign_keys` pragma off, matching the schema).
- `dimension_gateways` is COMMUNITY state (like `discovered_hexes`): permanent, append-only,
  never per-run, never touched by `eraseClient`. `UNIQUE (to_dimension_id)` encodes
  "not-yet-linked" — a dimension is the destination of at most one gateway (the multiverse is
  a tree).
- `run_cleared_hexes` gains `dimension_id` in its PRIMARY KEY. SQLite cannot ALTER a PK →
  rebuild + copy, with the backfill joining `runs.dimension_id` (correct because no pre-v8 run
  ever changed dimension). Orphan cleared rows whose run row was hard-deleted (eraseClient) are
  dropped by the JOIN — they were unreadable anyway.
- `dimensions.tier` NULL semantics: see flag #1. The backfill (§0.2) is the ONLY place existing
  rows get tiers; everything else earns a tier via attunement.

### 1.2 DDL — new `user_version < 8` block in db.ts, inserted directly after the v7 block

```ts
// v8: portals & tiered multiverse (docs/meta-loop/04-portals.md).
// dimensions.tier: descent depth; NULL = not yet placed (attunement-pool candidate when ready).
// dimension_gateways: community-permanent portal graph — (from_dimension, hex) -> to_dimension,
// destination fixed forever on first attunement; UNIQUE(to_dimension_id) keeps it a tree.
// runs.start_dimension_id: the lobby-picked start (resetToOrigin/rematch target; feature 3
// derives the run's starting tier from it). runs.dimension_id becomes "current dimension".
// run_cleared_hexes rebuilt with dimension_id in the PK (per-run cleared state is now
// per-dimension; backfill joins runs.dimension_id — pre-v8 runs never changed dimension).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 8) {
    const migrate = db.transaction(() => {
      for (const sql of [
        "ALTER TABLE dimensions ADD COLUMN tier INTEGER",
        "ALTER TABLE runs ADD COLUMN start_dimension_id INTEGER",
      ]) {
        try {
          db.exec(sql);
        } catch (e) {
          if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
        }
      }
      // Tier backfill for pre-portal dimensions — mapping flagged in 04-portals §0.2 (ADJUST ME).
      db.exec("UPDATE dimensions SET tier = 0 WHERE id IN (0, 1) AND tier IS NULL");
      db.exec("UPDATE dimensions SET tier = 1 WHERE id IN (2, 501) AND tier IS NULL");
      db.exec("UPDATE dimensions SET tier = 2 WHERE id = 3 AND tier IS NULL");
      db.exec("UPDATE runs SET start_dimension_id = dimension_id WHERE start_dimension_id IS NULL");
      db.exec(`CREATE TABLE IF NOT EXISTS dimension_gateways (
        from_dimension_id     INTEGER NOT NULL,
        q                     INTEGER NOT NULL,
        r                     INTEGER NOT NULL,
        to_dimension_id       INTEGER NOT NULL UNIQUE,
        attuned_at            INTEGER NOT NULL,
        attuned_by_account_id TEXT,
        PRIMARY KEY (from_dimension_id, q, r),
        FOREIGN KEY (from_dimension_id) REFERENCES dimensions(id),
        FOREIGN KEY (to_dimension_id)   REFERENCES dimensions(id)
      )`);
      // Legacy item-id dedup (03-loot-codex §9): pre-collision-check data has ONE duplicated id
      // ("short-sword" in dims 0 AND 501). getItemById's global WHERE id = ? resolution — and
      // feature 3's codex_firsts(item_id) PK — require uniqueness. Keep the lowest-dimension
      // owner; rename other rows to the d<dim>-<id> convention saveItems' error prescribes,
      // rewriting item_json.id and re-pointing seat rows for runs at that dimension (no-op on
      // live data: zero runs exist at 501).
      const dupeIds = (db.query("SELECT id FROM items GROUP BY id HAVING COUNT(*) > 1").all() as { id: string }[]);
      for (const { id } of dupeIds) {
        const owners = db.query("SELECT dimension_id FROM items WHERE id = ? ORDER BY dimension_id").all(id) as { dimension_id: number }[];
        for (const { dimension_id } of owners.slice(1)) {
          const newId = `d${dimension_id}-${id}`;
          db.prepare("UPDATE items SET id = ?, item_json = json_set(item_json, '$.id', ?) WHERE id = ? AND dimension_id = ?")
            .run(newId, newId, id, dimension_id);
          db.prepare("UPDATE run_seat_items SET item_id = ? WHERE item_id = ? AND run_id IN (SELECT id FROM runs WHERE dimension_id = ?)")
            .run(newId, id, dimension_id);
          db.prepare("UPDATE run_seat_attachments SET item_id = ? WHERE item_id = ? AND run_id IN (SELECT id FROM runs WHERE dimension_id = ?)")
            .run(newId, id, dimension_id);
        }
      }
      const clearedCols = (db.query("PRAGMA table_info(run_cleared_hexes)").all() as { name: string }[])
        .map((c) => c.name);
      if (!clearedCols.includes("dimension_id")) {
        db.exec(`CREATE TABLE run_cleared_hexes_v8 (
          run_id       INTEGER NOT NULL,
          dimension_id INTEGER NOT NULL,
          q            INTEGER NOT NULL,
          r            INTEGER NOT NULL,
          PRIMARY KEY (run_id, dimension_id, q, r),
          FOREIGN KEY (run_id) REFERENCES runs(id)
        )`);
        db.exec(`INSERT INTO run_cleared_hexes_v8 (run_id, dimension_id, q, r)
          SELECT rc.run_id, r.dimension_id, rc.q, rc.r
          FROM run_cleared_hexes rc JOIN runs r ON r.id = rc.run_id`);
        db.exec("DROP TABLE run_cleared_hexes");
        db.exec("ALTER TABLE run_cleared_hexes_v8 RENAME TO run_cleared_hexes");
      }
      db.exec(`PRAGMA user_version = 8`);
    });
    migrate();
  }
}
```

Idempotent against the populated DB (duplicate-column-guarded ALTERs, `IF NOT EXISTS`, the
cleared-table rebuild guarded on column absence, `AND tier IS NULL` on backfills, all gated
once by `user_version`; the whole block is one transaction so a crash mid-migration leaves
user_version 7 and a clean retry). Fresh DBs flow v3→…→v8. Never edit the shipped v3-v7 blocks.

### 1.3 db.ts surface changes

**Cleared-hex functions gain the dimension key** (all callers updated in §4):

```ts
const insertClearedStmt = db.prepare(
  "INSERT OR IGNORE INTO run_cleared_hexes (run_id, dimension_id, q, r) VALUES (?, ?, ?, ?)"
);
const clearedForRunStmt = db.prepare(
  "SELECT q, r FROM run_cleared_hexes WHERE run_id = ? AND dimension_id = ?"
);
// count of combat-cleared hexes for the whole run: every dimension's origin is (0,0) and is
// auto-cleared at entry (run start / travel), never combat-cleared — so excluding (0,0) rows
// yields exactly the encounter-win count (feeds Room.runClearedCount on crash recovery).
const combatClearedCountStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM run_cleared_hexes WHERE run_id = ? AND NOT (q = 0 AND r = 0)"
);

export function markRunCleared(runId: number, dimensionId: number, coord: HexCoord): void;
export function loadRunCleared(runId: number, dimensionId: number): Set<string>;
export function countRunCombatCleared(runId: number): number;
```

`clearRunCleared(runId)` and `eraseClient`'s per-run delete stay keyed by `run_id` alone
(erasure/reset semantics are whole-run). `commitExplore(dimensionId, runId, coord, icon)`
signature is unchanged — its internal `insertClearedStmt` call adds the dimension param.

**Run row / run lifecycle:**

```ts
export interface RunRow {
  // ...existing...
  start_dimension_id: number; // v8 backfill guarantees non-null
}

const insertRunStmt = db.prepare(
  `INSERT INTO runs (dimension_id, start_dimension_id, capacity, host_client_id, active,
                     party_q, party_r, created_at, updated_at)
   VALUES (?, ?, ?, ?, 1, 0, 0, ?, ?)`
); // startNewRun passes dimensionId for BOTH — a fresh run starts where it starts.

// Lobby-only re-pick (chooseDimension): current AND start move together, pre-start.
const setRunStartDimensionStmt = db.prepare(
  "UPDATE runs SET dimension_id = ?, start_dimension_id = ?, updated_at = ? WHERE id = ? AND active = 1"
);
export function setRunStartDimension(runId: number, dimensionId: number): void;

/**
 * Mid-run gateway travel (write point: 04-portals §4.3). ONE transaction: re-point the run's
 * current dimension + reset party pos to origin, seed the destination's community discovery
 * disc + origin icon, and mark the destination origin cleared for this run — a crash can never
 * persist the dimension swap without the origin state that makes it resumable.
 */
export function commitTravel(runId: number, toDimensionId: number, radius: number): void {
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE runs SET dimension_id = ?, party_q = 0, party_r = 0, updated_at = ? WHERE id = ? AND active = 1"
    ).run(toDimensionId, now, runId);                       // prepare once at module scope
    for (let q = -radius; q <= radius; q++) {               // seedDiscovery body, in-tx
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) insertDiscoveredStmt.run(toDimensionId, q, r);
    }
    insertDiscoveredIconStmt.run(toDimensionId, 0, 0, "town");
    insertClearedStmt.run(runId, toDimensionId, 0, 0);
  });
  tx();
}
```

**Dimension metadata:**

```ts
export interface DimensionMeta { id: number; name: string; tier: number | null }
const dimensionMetaStmt = db.prepare("SELECT id, name, tier FROM dimensions WHERE id = ?");
export function getDimensionMeta(id: number): DimensionMeta | null;
```

**Global item resolution (flag #9)** — replaces the 0-3 merge in `loadSeatInventory`:

```ts
const itemByIdStmt = db.prepare("SELECT item_json FROM items WHERE id = ?");
/** Item ids are globally unique (saveItems enforces the cross-dimension collision check). */
export function getItemById(id: string): ItemDefinition | null;
```

`loadSeatInventory(runId, seatIndex)` drops its `dimensionId` param and resolves each row via
`getItemById`; the existing unknown-id `console.warn` + skip is preserved verbatim.
`loadDimension`/`listDimensions` add `tier` to their row reads (additive).

### 1.4 `server/src/gateways.ts` (new domain module, accounts.ts precedent — shares the db handle)

```ts
import { db, getDimensionMeta } from "./db.js";

// Readiness predicate (flag #3) — reused by the pool and by startable-dimension queries.
const READY_SQL = `
  d.status = 'approved'
  AND d.background_path IS NOT NULL
  AND EXISTS (SELECT 1 FROM enemy_templates e WHERE e.dimension_id = d.id)
  AND EXISTS (SELECT 1 FROM items i WHERE i.dimension_id = d.id)`;

const gatewayAtStmt = db.prepare(
  `SELECT g.to_dimension_id, d.name, d.tier
   FROM dimension_gateways g JOIN dimensions d ON d.id = g.to_dimension_id
   WHERE g.from_dimension_id = ? AND g.q = ? AND g.r = ?`);
const gatewaysForDimStmt = db.prepare(
  `SELECT g.q, g.r, g.to_dimension_id, d.name, d.tier
   FROM dimension_gateways g JOIN dimensions d ON d.id = g.to_dimension_id
   WHERE g.from_dimension_id = ?`);
const poolCandidateStmt = db.prepare(
  `SELECT d.id FROM dimensions d
   WHERE d.tier IS NULL AND ${READY_SQL}
     AND NOT EXISTS (SELECT 1 FROM dimension_gateways g WHERE g.to_dimension_id = d.id)
   ORDER BY d.id LIMIT 1`); // flag #11: deterministic queue, oldest first
const insertGatewayStmt = db.prepare(
  `INSERT INTO dimension_gateways
     (from_dimension_id, q, r, to_dimension_id, attuned_at, attuned_by_account_id)
   VALUES (?, ?, ?, ?, ?, ?)`);
const setTierStmt = db.prepare("UPDATE dimensions SET tier = ? WHERE id = ?");

export type AttuneResult =
  | { attuned: true; gateway: GatewayInfo; firstAttunement: boolean }
  | { attuned: false; reason: "pool-empty" | "untiered-source" };

/**
 * Idempotent gateway resolution: return the fixed destination if one exists, else attune the
 * first pool candidate (assigning it tier = fromTier + 1) atomically. Loud on both failure
 * modes (flags #4, #10); NEVER falls back.
 */
export function ensureGatewayAttuned(
  fromDimensionId: number,
  fromTier: number | null,
  hex: HexCoord,
  attunedBy: string | null,
): AttuneResult {
  const existing = gatewayAtStmt.get(fromDimensionId, hex.q, hex.r) as
    { to_dimension_id: number; name: string; tier: number } | null;
  if (existing) {
    return { attuned: true, firstAttunement: false,
      gateway: { toDimensionId: existing.to_dimension_id, toName: existing.name, toTier: existing.tier } };
  }
  if (fromTier === null) {
    console.error(`[gateways] cannot attune from untiered dimension ${fromDimensionId} at (${hex.q},${hex.r}) — dev-override runs are outside the multiverse graph`);
    return { attuned: false, reason: "untiered-source" };
  }
  const candidate = poolCandidateStmt.get() as { id: number } | null;
  if (!candidate) {
    console.error(`[gateways] attunement pool EMPTY: gateway at (${hex.q},${hex.r}) in dimension ${fromDimensionId} (tier ${fromTier}) stays unattuned — approve more generated dimensions`);
    return { attuned: false, reason: "pool-empty" };
  }
  const toTier = fromTier + 1;
  const tx = db.transaction(() => {
    setTierStmt.run(toTier, candidate.id);
    insertGatewayStmt.run(fromDimensionId, hex.q, hex.r, candidate.id, Date.now(), attunedBy);
  });
  tx();
  const meta = getDimensionMeta(candidate.id)!;
  console.log(`[gateways] attuned (${hex.q},${hex.r}) in dim ${fromDimensionId} -> dim ${candidate.id} "${meta.name}" (tier ${toTier})`);
  return { attuned: true, firstAttunement: true,
    gateway: { toDimensionId: candidate.id, toName: meta.name, toTier } };
}

/** Community gateway knowledge for a dimension, keyed by hexKey — feeds Room.gateways. */
export function loadGatewaysForDimension(dimensionId: number): Record<string, GatewayInfo>;

/**
 * Run-start options (flag #5): READY tiered dims that are tier 0 OR charted by any of the
 * given accounts. Sorted (tier, id). accountIds ≤ 4 — build the IN(...) per call.
 */
export function startableDimensions(accountIds: readonly string[]): DimensionOption[];
export function isStartableDimension(dimensionId: number, accountIds: readonly string[]): boolean;
```

(`startableDimensions` SQL: `SELECT d.id, d.name, d.tier FROM dimensions d WHERE d.tier IS NOT
NULL AND ${READY_SQL} AND (d.tier = 0 OR EXISTS (SELECT 1 FROM account_dimensions ad WHERE
ad.dimension_id = d.id AND ad.account_id IN (…))) ORDER BY d.tier, d.id`.)

`server/src/accounts.ts` — no changes needed (charted reads go through the SQL above;
`recordDimensionSeen` already exists for writes).

---

## 2. Shared modules

### 2.1 `shared/src/net/protocol.ts` DTOs (full protocol changes in §3)

```ts
/** A community-attuned gateway destination (dimension_gateways row + destination meta). */
export interface GatewayInfo {
  readonly toDimensionId: number;
  readonly toName: string;
  readonly toTier: number;
}

/** One run-start option in the lobby picker (union of tier-0 + party-charted, server-built). */
export interface DimensionOption {
  readonly id: number;
  readonly name: string;
  readonly tier: number;
}
```

### 2.2 `shared/src/overworld/contracts.ts` (02's module — no semantic edits)

`isRetreatHex(icon)` is reused verbatim as the shared "party stands on a cleared gateway"
stance predicate for BOTH retreat (02) and travel (this feature) — the name is 02's; do not
rename in this push. `applyContractEvent` untouched (flag #7). The only contracts.ts-adjacent
change is the `clearedCount` FEED amendment recorded in §9 (a room-machine change, not a
contracts.ts change).

### 2.3 `shared/src/core/titles.ts` (edit — one seed; boot-time `seedTitles()` upsert propagates)

```ts
  { id: "depthfarer", name: "Depthfarer", description: "Pass through a gateway to a deeper dimension.",
    sortOrder: 7, requirement: { stat: "dimensions_traveled", gte: 1 } },
```

(`sortOrder: 7` assumes 02 shipped `sealbearer` at 6.)

---

## 3. Wire protocol (shared/src/net/protocol.ts)

`PROTOCOL_VERSION` bumps **4 → 5** (from feature 2's 4; if 2 and 4 deploy together players see
one refresh banner, not two).

### 3.1 Changed DTOs

```ts
export type VoteKind = "move" | "retreat" | "travel";

// VoteStatePayload gains the travel destination (null unless kind === "travel"):
export interface VoteStatePayload {
  readonly proposalId: string;
  readonly kind: VoteKind;
  readonly proposerSeatId: SeatId;
  readonly target: HexCoord | null;      // move-only (02)
  readonly travel: GatewayInfo | null;   // travel-only — drives the VotePanel destination line
  readonly votes: Partial<Record<SeatId, VoteChoice>>;
  readonly electorate: readonly SeatId[];
  readonly deadlineMs: number;
}

// RoomStatePayload gains dimension identity (cached on Room — never a per-broadcast DB read):
export interface RoomStatePayload {
  // ...existing (incl. 02's contract/outcome)...
  readonly dimensionName: string;
  /** NULL only for dev-override runs in unplaced dimensions (flag #10); feature 3 reads the
   *  lobby value as the run's starting tier. */
  readonly dimensionTier: number | null;
}

// AccountStatsPayload gains:
  readonly dimensionsTraveled: number;
```

### 3.2 ClientMessage additions

```ts
  // Host-gated, lobby-only: re-point the expedition's start dimension (from dimensionOptions).
  | { type: "chooseDimension"; dimensionId: number }
  // Seat-scoped, overworld-only, party on a cleared gateway hex: open a travel-deeper vote.
  | { type: "proposeTravel" }
```

(`castVote` is reused unchanged for travel ballots — one open vote per room, matched by
`proposalId`, exactly as 02 did for retreat.)

### 3.3 ServerMessage additions/changes

```ts
  // Lobby run-start picker: union of tier-0 + party-charted dims. Sent on lobby land AND
  // re-broadcast to the whole lobby whenever the seated-account union changes (join/leave).
  | { type: "dimensionOptions"; options: readonly DimensionOption[] }

  // Broadcast on a gateway attunement ATTEMPT at first-clear or travel-retry time:
  // gateway = the fixed destination (toast: "A gateway attunes — …"), or null when the pool
  // was empty (toast + HUD copy: unattuned; server already console.error'd — flag #4).
  | { type: "gatewayUpdate"; hex: HexCoord; gateway: GatewayInfo | null }

  // hexMapState gains the dimension's community gateway map (keyed by hexKey):
  | { type: "hexMapState"; hexMap: HexMapState; gateways: Record<string, GatewayInfo> }
```

`ErrorCode` gains `"GATEWAY_UNATTUNED"` (proposeTravel at a gateway the retry could not
attune). `chooseDimension` failures reuse `NOT_HOST` / `BAD_PHASE` / `INVALID_INPUT`
("You haven't charted that dimension" / "Unknown dimension"). `proposeTravel` guard failures
reuse `BAD_PHASE` / `NOT_YOUR_SEAT` / `INVALID_MOVE` ("The party must stand on a cleared
gateway to travel"). The shared `HexMapState` TYPE is unchanged (it is also the in-memory Room
map shape) — only the wire message grows a sibling field.

---

## 4. Server flows

### 4.1 Room state additions (room.ts `Room`, both construction sites + reconstruction)

```ts
  dimensionId: number;                        // existing — now "current dimension"
  startDimensionId: number;                   // lobby-picked start (resetToOrigin/rematch target)
  dimensionName: string;                      // cached meta (roomStatePayload fires constantly)
  dimensionTier: number | null;               //   "
  gateways: Record<string, GatewayInfo>;      // community gateway map for the CURRENT dimension
  runClearedCount: number;                    // combat-cleared this run, origins excl., cumulative (flag #8)
```

Init values: `createRoomFor` — `startDimensionId = dimensionId`, meta from
`getDimensionMeta(dimensionId)` (throw if null — a room cannot be built on a nonexistent
dimension), `gateways = loadGatewaysForDimension(dimensionId)`, `runClearedCount = 0`.
`reconstructRoomForRun` — `dimensionId = runRow.dimension_id`, `startDimensionId =
runRow.start_dimension_id`, meta/gateways for the CURRENT dimension, `visitedThisRun =
loadRunCleared(runId, runRow.dimension_id)`, `runClearedCount = countRunCombatCleared(runId)`.

`roomStatePayload` adds `dimensionName: room.dimensionName, dimensionTier: room.dimensionTier`.
`broadcastHexMapState` / `sendSeatSnapshots` send
`{ type: "hexMapState", hexMap: hexMapStatePayload(room), gateways: room.gateways }`.
`exploreHex` increments `room.runClearedCount` (right where it adds to `visitedThisRun`), and
02's `encounter-won` emit in `endCombat` reads `clearedCount: room.runClearedCount` (§9
amendment).

### 4.2 Gateway attunement recorder (gateways.ts, registered in run-events.ts)

02's static REGISTRY gains two lines (order within `encounter-won`: XP recorder → contract
recorder → gateway recorder; attunement is independent of both, listed last for clarity):

```ts
  on("encounter-won", gatewayAttunementRecorder),   // gateways.ts
  on("dimension-entered", recordDimensionEntered),  // run-recorders.ts (§4.4)
```

```ts
/** encounter-won subscriber: first clear of a gateway hex fixes its destination for everyone.
 *  Pure recorder — persists + pushes; never touches phase/vote/session (02 §4.1 discipline). */
export function gatewayAttunementRecorder(room: Room, io: RoomIO,
    ev: Extract<RunEvent, { type: "encounter-won" }>): void {
  if (ev.icon === null || !isRetreatHex(ev.icon)) return;      // gateway | gateway-city only
  const key = hexKey(ev.hex);
  if (room.gateways[key]) return;                              // already community-attuned
  const result = ensureGatewayAttuned(room.dimensionId, room.dimensionTier, ev.hex, hostAccountId(room));
  if (result.attuned) {
    room.gateways = { ...room.gateways, [key]: result.gateway };
    io.broadcast(room, { type: "gatewayUpdate", hex: ev.hex, gateway: result.gateway });
  } else {
    io.broadcast(room, { type: "gatewayUpdate", hex: ev.hex, gateway: null }); // flag #4: loud, visible
  }
}
```

(`hostAccountId(room)` = the host seat's `accountId ?? null` — provenance only, flag #14.)
Ordering note: the recorder runs during the emit, BEFORE endCombat's
`broadcastHexMapState`, so the win's map broadcast already carries the new gateway; the
`gatewayUpdate` broadcast exists for the toast + the unattuned (absent-from-map) case. If the
same clear also completes an activate-gateway contract, `settleRun` fires after the emit —
attunement still persisted (community state outlives the run). Timing: the recorder is
synchronous SQLite inside the already-synchronous emit (R7 discipline preserved).

### 4.3 Travel vote + travelToDimension (room-machine.ts)

`RoomVote` (02 §4.4) gains a third kind:

```ts
export type RoomVote =
  | (RoomVoteBase & { readonly kind: "move"; readonly target: HexCoord })
  | (RoomVoteBase & { readonly kind: "retreat" })
  | (RoomVoteBase & { readonly kind: "travel"; readonly gateway: GatewayInfo });
```

`voteStatePayload` emits `travel: vote.kind === "travel" ? vote.gateway : null` (and
`target: null` for travel, as for retreat).

**`proposeTravel(room, io, seat)`** — sibling of 02's `proposeRetreat`, same guard ladder:

```ts
export function proposeTravel(room: Room, io: RoomIO, seat: Seat): void {
  // guards (same codes/copy discipline as proposeRetreat):
  //   phase !== "overworld"            -> BAD_PHASE  "Not in overworld"
  //   room.vote                        -> BAD_PHASE  "A vote is already open"
  //   seat.state !== "human-connected" -> NOT_YOUR_SEAT "Spectators cannot propose"
  //   !isRetreatHex(getHexIcon(room.hexMap.playerPos, room.hexMap.icons))
  //                                    -> INVALID_MOVE "The party must stand on a cleared gateway to travel"
  const pos = room.hexMap.playerPos;
  const key = hexKey(pos);
  let gateway = room.gateways[key];
  if (!gateway) {
    // Retry attunement (flag #4): the pool may have been replenished since the clear.
    const result = ensureGatewayAttuned(room.dimensionId, room.dimensionTier, pos, seat.accountId);
    if (!result.attuned) {
      return err("GATEWAY_UNATTUNED", "The gateway is unattuned — no new dimension is ready beyond it");
    }
    gateway = result.gateway;
    room.gateways = { ...room.gateways, [key]: gateway };
    io.broadcast(room, { type: "gatewayUpdate", hex: pos, gateway });
  }
  // Single connected human -> instant resolve (movement/retreat precedent):
  //   io.broadcast(room, { type: "voteState", vote: null }); travelToDimension(room, io, gateway);
  // Else open { kind: "travel", gateway, ... } with VOTE_TIMEOUT_MS, proposer auto-yes,
  // voteState broadcast — identical mechanics to proposeRetreat.
}
```

`resolveOpenVote`'s decided branch gains:

```ts
} else if (vote.kind === "travel") {
  if (resolution.accepted) travelToDimension(room, io, vote.gateway);
}
```

(`cancelVote` needs no change — its `moveResolved` broadcast is already move-only per 02.)

**`travelToDimension(room, io, gateway)`** — the mid-run dimension swap, the counterpart of
`resetToOrigin` that does NOT end the run:

```ts
function travelToDimension(room: Room, io: RoomIO, gateway: GatewayInfo): void {
  const toDim = gateway.toDimensionId;
  const meta = getDimensionMeta(toDim);
  if (!meta) throw new Error(`travelToDimension: destination dimension ${toDim} missing`); // fail loud
  commitTravel(room.runId, toDim, DISCOVERY_RADIUS);   // ONE durable transaction (§1.3)

  room.dimensionId = toDim;
  room.dimensionName = meta.name;
  room.dimensionTier = meta.tier;
  const originKey = hexKey(ORIGIN);
  const hexes = loadDiscoveredHexes(toDim);
  hexes[originKey] = "explored";
  const icons: Record<string, HexIconType> = { [originKey]: "town" };
  for (const [k, icon] of Object.entries(loadDiscoveredHexIcons(toDim))) icons[k] = icon as HexIconType;
  room.hexMap = { playerPos: ORIGIN, hexes, icons };
  room.visitedThisRun = new Set([originKey]);
  room.gateways = loadGatewaysForDimension(toDim);
  room.pendingHex = null;
  // Deliberately UNTOUCHED: room.runId, room.contract, room.runClearedCount, pending-XP ledger,
  // seat inventories/presets — the run CONTINUES (locked #8: descent, not restart).

  emitRunEvent(room, io, { type: "dimension-entered", runId: room.runId,
    dimensionId: toDim, tier: meta.tier });
  broadcastRoomState(room, io);       // dimensionId change triggers the client's sprite reload
  broadcastHexMapState(room, io);     // destination map + gateways
}
```

`DISCOVERY_RADIUS` moves from index.ts to an exported const in room-machine.ts (index.ts
imports it) — the machine now needs it and the machine must not import index.ts.

### 4.4 Run-event bus additions

`run-events.ts` `RunEvent` union gains:

```ts
  /** Mid-run gateway travel arrival. NOT emitted at run start (that is run-started). */
  | { type: "dimension-entered"; runId: number; dimensionId: number; tier: number | null }
```

`run-recorders.ts` gains:

```ts
/** dimension-entered: chart the destination for every attributed seat (this is what makes it
 *  appear in future run-start pickers — locked #9), bump dimensions_traveled, evaluate titles. */
export function recordDimensionEntered(room: Room, io: RoomIO,
    ev: Extract<RunEvent, { type: "dimension-entered" }>): void {
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    const first = recordDimensionSeen(accountId, ev.dimensionId);
    bumpStat(accountId, "dimensions_traveled", 1);
    const newTitles = evaluateTitles(accountId);
    refreshCardProfile(seat, accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    if (first || newTitles.length > 0) io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}
```

`accounts.ts` `loadProfilePayload` stats mapping adds `dimensionsTraveled` (open key set — no
schema change).

### 4.5 Lobby: dimension options + chooseDimension (index.ts)

**Options push.** `startableForRoom(room)` = `startableDimensions(accountIds of seats with
accountId !== null and state human-connected/disconnected)` (the `eligibleSeats` filter).
Sent:

- in `sendSeatSnapshots`' lobby branch, alongside 02's `contractOffers`:
  `io.send(seat, { type: "dimensionOptions", options: startableForRoom(room) })`;
- to the host socket in `createRoomFor` (after `broadcastRoomState`, next to 02's offers send);
- re-broadcast to EVERY connected seat when the lobby's account union changes:
  in `handleJoinRoom` after `broadcastRoomState`, and in `detachSeat`'s lobby branch after its
  `broadcastRoomState` (the union shrank; flag #13 — the current selection is NOT revalidated).

**`handleChooseDimension(room, seat, ws, dimensionId)`** — host-gated block, next to
`handleStartGame` / 02's `handleChooseContract`:

```ts
NOT_HOST unless isHost; BAD_PHASE unless room.phase === "lobby";
const meta = getDimensionMeta(dimensionId);
if (!meta) return sendError(ws, "INVALID_INPUT", "Unknown dimension");
if (process.env.GAME_ALLOW_UNCHARTED_DIMENSIONS !== "1" &&
    !isStartableDimension(dimensionId, seatedAccountIds(room))) {
  return sendError(ws, "INVALID_INPUT", "No one in the party has charted that dimension");
}
if (dimensionId !== room.dimensionId) {
  setRunStartDimension(room.runId, dimensionId);           // durable: dimension_id + start_dimension_id
  seedDiscovery(dimensionId, DISCOVERY_RADIUS);            // idempotent community seed
  discoverHex(dimensionId, ORIGIN);
  saveDiscoveredHexIcon(dimensionId, ORIGIN, "town");
  markRunCleared(room.runId, dimensionId, ORIGIN);         // old dim's origin row lingers (harmless)
  room.dimensionId = dimensionId;
  room.startDimensionId = dimensionId;
  room.dimensionName = meta.name; room.dimensionTier = meta.tier;
  /* rebuild room.hexMap + room.gateways from the new dimension's community rows —
     identical shape to createRoomFor's block */
  room.visitedThisRun = new Set([hexKey(ORIGIN)]);
  // Contract re-derivation (flag #12): offers are per-dimension-map.
  if (room.contract) {
    const offers = buildContractOffers(room.hexMap.icons);
    if (offers.some((o) => o.type === room.contract!.type)) assignContract(room, room.contract.type);
    else { room.contract = null; clearRunContract(room.runId); }   // new db fn: contract_json = NULL, AND active = 1
  }
  broadcastRoomState(room, io);
  for (const s of room.seats) if (s.socket) {
    io.send(s, { type: "contractOffers", offers: buildContractOffers(room.hexMap.icons) });
  }
}
```

(`clearRunContract` is a 4-line db.ts addition mirroring `saveRunContract` with NULL.)
Seat inventories are untouched — presets resolve globally (flag #9), independent of dimension.

**`handleCreateRoom` / `handleQuickMatch` validation** (flag #5): when `msg.dimensionId` is
provided, apply the same existence + startability check against the CALLER's account
(`ws.data.accountId` — resolved at hello) before `createRoomFor`; same env override; on
failure send `INVALID_INPUT` and do not create. `DEFAULT_DIMENSION = 1` (tier 0) and the
client's `?dim=0` default both pass by construction.

**routeMessage additions:**

```ts
case "chooseDimension":
  return handleChooseDimension(room, seat, ws, msg.dimensionId);
case "proposeTravel":
  return proposeTravel(room, io, seat);
```

**`handlePlayAgain`** — the rematch room is created at `room.startDimensionId` (flag #6),
not `room.dimensionId`.

### 4.6 resetToOrigin (room-machine.ts) — updated semantics (flag #6)

On top of 02's edits (finalize + run-ended emit + default contract):

```ts
const startDim = room.startDimensionId;                       // NOT room.dimensionId
const newRunId = startNewRun(startDim, hostClientId(room), room.capacity); // stamps start_dimension_id too
markRunCleared(newRunId, startDim, ORIGIN);
if (room.dimensionId !== startDim) {
  room.dimensionId = startDim;
  const meta = getDimensionMeta(startDim)!;                   // was valid at run start; fail loud if gone
  room.dimensionName = meta.name; room.dimensionTier = meta.tier;
}
/* hexMap reseed block now reads startDim; plus: */
room.gateways = loadGatewaysForDimension(startDim);
room.runClearedCount = 0;
```

Documented behavior: **a wipe/abandon deep in the multiverse restarts at the run's start
dimension.** Discovery made in deeper dimensions persists globally; charting persists per
account; only the party's position/cleared-state resets.

### 4.7 Crash / reconnect / compat behavior

- `reconstructRoomForRun` rehydrates at the CURRENT dimension (§4.1) — a crash after travel
  resumes in the destination with the origin cleared (commitTravel's transaction guarantees
  it), contract intact (runs.contract_json), `runClearedCount` recomputed exactly.
- Reconnect into any phase: `roomState` carries dimensionName/tier; the lobby branch of
  `sendSeatSnapshots` re-sends `dimensionOptions`; the overworld branch's `hexMapState`
  carries `gateways` — the HUD renders attuned/unattuned correctly with no replayed transient
  messages.
- Gateways cleared before v8 exist with no gateway row: standing on one post-deploy,
  `proposeTravel`'s retry attunes it (or reports GATEWAY_UNATTUNED) — no backfill needed.
- In-flight runs at deploy: `start_dimension_id` backfilled = `dimension_id` (correct — they
  never traveled); cleared rows re-keyed by the migration join.

---

## 5. Tunable constants (single table)

| Constant | Value | Lives in |
|---|---|---|
| `DISCOVERY_RADIUS` | 15 (existing; moves index.ts → room-machine.ts export) | server/room-machine.ts |
| Travel vote timeout | `VOTE_TIMEOUT_MS` (15s, reused) | server/room-machine.ts |
| Pool selection order | `ORDER BY d.id` (oldest first, flag #11) | server/gateways.ts `poolCandidateStmt` |
| Readiness predicate | `READY_SQL` (flag #3) | server/gateways.ts |
| Tier backfill mapping | §0.2 table (**ADJUST ME**) | db.ts v8 block |
| Destination tier | `fromTier + 1` (locked #8) | server/gateways.ts |
| Dev start override | `GAME_ALLOW_UNCHARTED_DIMENSIONS=1` | env (checked in index.ts) |
| `dimensions_traveled` title gate | Depthfarer @ 1 | shared/core/titles.ts |

---

## 6. Client (ui-kit THEME language throughout; no new colors)

### 6.1 main.ts wiring (composition root)

- `let gatewayMap: Record<string, GatewayInfo> = {};` — updated by the (reshaped)
  `conn.on("hexMapState", (msg) => { hexMapState = msg.hexMap; gatewayMap = msg.gateways; … })`
  and by `conn.on("gatewayUpdate", (msg) => { if (msg.gateway) gatewayMap[hexKey(msg.hex)] =
  msg.gateway; contractHud.refresh(); })`.
- `gatewayUpdate` toasts (the existing gold `pushToast` stack):
  attuned → `` `A gateway attunes — ${g.toName} (Tier ${g.toTier}) lies beyond.` ``;
  null → `"The gateway is unattuned — no new dimension is ready beyond it."` (flag #4's
  player-facing half).
- ContractHud (02's construction site, line ~350) constructor gains the gateway getter:
  `new ContractHud(conn, seat, () => hexMapState, () => gatewayMap)`.
- No `switchForPhase` changes: travel keeps phase `overworld`; the existing
  `roomState`-driven `loadDimensionSprites` reload (295-300) handles destination assets, and
  the next combat entry already awaits `dimensionReady`.

### 6.2 LobbyScreen — destination picker section

- Header context line (122) becomes data-driven:
  `` `Dimension <b style="color:${THEME.gold}">${room.dimensionName}</b> · Tier ${room.dimensionTier ?? "—"}` ``
  (second line unchanged).
- Constructor subscribes `conn.on("dimensionOptions", (msg) => { this.dimOptions = msg.options;
  this.render(); })` (mirror of 02's contractOffers subscription).
- New full-width section ABOVE 02's contract board (rule-separated, same 44px gutter):
  `heading("Destination", "section")` + hint text (`13px; color:${THEME.faint}`) — host:
  `Choose where the expedition begins`, others: `The host chooses the destination`.
- Option cards in a horizontal flex row (gap `THEME.gap`), one per `DimensionOption`, 02
  contract-card styling: mini-panel (`flex:1; min-width:150px; border:1px solid
  ${THEME.goldLine}; border-radius:10px; background:rgba(11,9,6,0.45); padding:14px 16px`),
  name (`700 14px ${FONT.cinzel}; color:${THEME.gold}`), tier chip under it (`11px;
  letter-spacing:.1em; color:${THEME.goldDeep}`): `TIER ${tier}`. Selected =
  `room.dimensionId === option.id`: `border-color:${THEME.gold}; box-shadow:0 0 14px -6px
  ${THEME.gold}` + the presetPlate-style `Chosen` badge. Host cards clickable → send
  `{ type: "chooseDimension", dimensionId }`; non-host inert. Overflow: `flex-wrap:wrap`
  (charted lists grow over time).
- Re-render wholesale per notify (existing discipline; no inputs in the section).

### 6.3 ContractHud — gateway block (extends 02 §6.2's retreat affordance in place)

Rendered iff `isRetreatHex(getHexIcon(playerPos, hexMap.icons))` (unchanged stance check),
replacing 02's bare Retreat button with a stacked block:

- Destination line (13px):
  attuned (`gatewayMap[hexKey(playerPos)]`) → `` `Gateway → ${toName} · Tier ${toTier}` `` in
  `THEME.gold`; unattuned → `Gateway unattuned — nothing lies beyond yet` in `THEME.faint`,
  italic (flag #4's persistent player-facing state).
- `btn("Descend…", "primary")` full-width, rendered iff attuned; click sends
  `{ type: "proposeTravel" }`. Sub-caption (`11px; color:${THEME.faint}`):
  `` `Travel deeper — the run continues at Tier ${toTier}` ``.
- 02's `Retreat…` ghost-danger button + its `Banks 50% of pending XP · forfeits the contract`
  caption, below the Descend button, unchanged.
- `refresh()` public method (main.ts calls it on `gatewayUpdate`); existing re-render triggers
  (SeatContext notify, `setHexMap`) unchanged.

### 6.4 VotePanel (02's generalized single class)

- Title by kind: `"travel"` → `"Descent proposed"`.
- Travel second line (12px, `#8a7a68` like 02's retreat line):
  `` `Travel the gateway to ${vote.travel!.toName} (Tier ${vote.travel!.toTier})` ``.
- Tally/countdown/buttons/clear behavior already kind-agnostic — no other edits.

### 6.5 MapScreen / HexMapRenderer

No required changes (input lock rides 02's `voteState`/`moveResolved` handling; travel lands
as a fresh `hexMapState`). OPTIONAL polish, explicitly deferrable: a small gold glyph ring on
hexes present in `gatewayMap`.

### 6.6 dev mock data

`client/dev/mock-data.ts` roomState fixtures gain `dimensionName`/`dimensionTier` (menu
preview typechecks against `RoomStatePayload`).

---

## 7. Migration / compat behavior for existing data

1. DB v7 → v8 on first boot (idempotent, §1.2). Backfills: tiers per §0.2 (**Ben-adjustable**),
   `runs.start_dimension_id = dimension_id`, `run_cleared_hexes` re-keyed via the runs join
   (orphaned cleared rows from erased runs are dropped — unreadable before, unreadable after).
2. Historical finalized runs: untouched semantics; `start_dimension_id` backfill is inert.
3. In-flight runs at deploy: reconstructed at their (single) dimension; no gateway rows exist
   yet, so every gateway HUD shows unattuned until first attunement (or travel-retry) — correct.
4. Pre-v8 cleared gateway hexes: attunable via the proposeTravel retry (§4.7) — no backfill.
5. Protocol 4 clients get `protocolMismatch` + refresh banner (existing UX).
6. The pool is EMPTY at ship (§0.2) — gateway clears broadcast the unattuned state until Ben
   approves generated dims. This is flag #4's designed loud path, not an error.
7. `dimensions` status values are NOT rewritten; incomplete legacy rows are excluded by
   `READY_SQL`. Recommend (manual, post-ship): demote 4/100/500/502/703.
8. Existing tests: migration-idempotency expectation 7 → 8 (+ v8 spot-checks);
   `coop-harness`/lifecycle tests get mechanical updates (roomState two new fields,
   hexMapState reshape, `createOpenSeats`/`buildPresetInventory`/`loadSeatInventory`/
   `markRunCleared`/`loadRunCleared` signatures). Dimension-0 rooms remain startable with no
   charted data (tier 0), so no test needs charting fixtures except the new ones.

---

## 8. Test plan (`bun test` from repo root; typecheck via `bun run typecheck`)

Patterns: unit DB tests set `GAME_DB_PATH=":memory:"` + `GAME_SKIP_SEED=1` before a dynamic
import (db.test.ts precedent); machine-level tests use a stub RoomIO (02's
run-outcomes.test.ts pattern); end-to-end uses `coop-harness.ts`.

**server/src/__tests__/db-migration-idempotency.test.ts** (edit)
- Expectation moves to `user_version === 8`; spot-check after both subprocess rounds:
  `dimensions.tier` + `runs.start_dimension_id` columns exist; `dimension_gateways` table
  exists with the UNIQUE index on `to_dimension_id`; `run_cleared_hexes` has `dimension_id`.
- Backfill correctness: pre-seed (round-0 subprocess DB is fresh, so do this in a separate
  case with a hand-built v7-shaped DB) a run at dimension 2 with cleared rows → post-migration
  rows carry `dimension_id = 2` and `start_dimension_id = 2`.

**server/src/__tests__/gateways.test.ts** (new, :memory:)
- Pool predicate: candidates require approved + background + ≥1 enemy + ≥1 item + tier NULL +
  not a destination (fixture rows exercising each exclusion, mirroring the §0.2 audit).
- `ensureGatewayAttuned`: first call links the LOWEST-id candidate, sets its tier to
  `fromTier + 1`, returns `firstAttunement: true`; second call at the same hex returns the
  SAME destination with `firstAttunement: false` and creates no second row; a different hex
  links the NEXT candidate; exhausted pool → `{ attuned: false, reason: "pool-empty" }` and no
  row; `fromTier: null` → `{ attuned: false, reason: "untiered-source" }` and no row.
- `UNIQUE (to_dimension_id)`: direct duplicate insert throws (constraint proof).
- `loadGatewaysForDimension` shape (hexKey map, destination name/tier joined).
- `startableDimensions`: tier-0 ready dims always present; charted deep dim appears only for
  an account with the `account_dimensions` row; tierless/unready dims never appear; union over
  two accounts; sort order (tier, id). `isStartableDimension` truth table.
- `commitTravel`: runs.dimension_id + party pos updated, start_dimension_id UNCHANGED,
  destination origin cleared row present, discovery disc seeded, no-op on a finalized run
  (`AND active = 1`); `countRunCombatCleared` excludes (0,0) rows across two dimensions.
- `getItemById` resolves across dimensions; `loadSeatInventory` rehydrates a bag containing a
  non-0-3, non-current-dimension item (the flag-#9 regression).

**server/src/__tests__/travel.test.ts** (new, machine-level, stub RoomIO)
- `proposeTravel` guards: off-gateway → INVALID_MOVE; in combat/lobby → BAD_PHASE; open vote →
  BAD_PHASE; spectator → NOT_YOUR_SEAT.
- Unattuned + empty pool → GATEWAY_UNATTUNED error, no vote, no gateway row; then add a pool
  candidate → the SAME proposeTravel attunes (retry proof), broadcasts `gatewayUpdate`, and
  proceeds.
- Single human on an attuned gateway → instant travel: room.dimensionId/name/tier updated,
  hexMap at destination origin, visitedThisRun = {origin}, `contract` PRESERVED,
  `runClearedCount` PRESERVED, pendingHex null, `dimension-entered` emitted once, roomState +
  hexMapState broadcast, durable runs.dimension_id updated.
- Two humans → `voteState{kind:"travel", travel: info, target: null}`; second seat yes →
  travel; no-majority → voteState null, still in the source dimension.
- Retreat/travel coexistence: with a retreat vote open, proposeTravel → BAD_PHASE (one vote
  per room); after travel, proposeRetreat at a destination gateway still works (02
  regression).
- `gatewayAttunementRecorder`: encounter-won at a gateway hex attunes + broadcasts
  gatewayUpdate; at a non-gateway hex does nothing; at an already-attuned hex does nothing;
  empty pool broadcasts `gateway: null`.
- Cumulative chart count: N wins in dim A + travel + 1 win in dim B → the encounter-won emit
  carries `clearedCount = N + 1` (chart-hexes contract progresses across travel — the §9
  amendment's behavioral proof).
- `resetToOrigin` after travel: new run at `startDimensionId`, runClearedCount 0, gateways
  reloaded for the start dimension.
- `reconstructRoomForRun` after travel: current dimension, cleared set scoped to it,
  runClearedCount recomputed, startDimensionId from the row.

**server/src/__tests__/coop-integration.test.ts additions** (harness, end-to-end)
- Lobby: both seats receive `dimensionOptions` (dimension-0/1 tier-0 entries present with
  names + tiers); non-host `chooseDimension` → NOT_HOST; host picks an uncharted deep dim →
  INVALID_INPUT; chart a deep dim for the joiner's account (direct
  `accounts.recordDimensionSeen`) → options re-broadcast on join includes it → host picks it →
  roomState carries new dimensionId/name/tier on BOTH sockets, `contractOffers` re-sent;
  startGame charts it for the host's account too (`account_dimensions` row appears).
- `createRoom{dimensionId: uncharted-deep}` → INVALID_INPUT; with
  `GAME_ALLOW_UNCHARTED_DIMENSIONS=1` in the harness env → allowed (dev-knob proof).
- Travel end-to-end: seed a pool candidate; start (2 humans) → move onto a gateway hex (icon
  override via the community icon table) → debugWin → both sockets get `gatewayUpdate` with a
  destination + `hexMapState.gateways` entry → proposeTravel → both get
  `voteState{kind:"travel"}` → yes → both get roomState with the destination dimensionId +
  hexMapState at origin; reconnect (fresh socket + reclaim) lands in the destination with
  gateways present.
- Wipe after travel (debugLose) → gameover; playAgain rematch room's roomState.dimensionId =
  the START dimension.

**Regression clause**: 02's contract/retreat/banking suites pass with mechanical updates only
(voteState `travel` field, roomState two new fields, hexMapState reshape). Seat reclaim, crash
recovery, host migration, discovery, HMAC, and 01's account suites are asserted unchanged.

---

## 9. Cross-feature changes (edits made to predecessor docs by this design)

Per the amendment rule, `docs/meta-loop/02-contracts.md` received three minimal edits (no
semantic redesign; each is the smallest diff that keeps 02 truthful once 04 lands):

1. **§2.2 `ContractHexEvent.clearedCount` doc comment** — feed changes from
   `room.visitedThisRun.size - 1` to `room.runClearedCount` (cumulative across dimension
   travel; origins excluded). Reason: travel resets `visitedThisRun` per dimension (flag #8);
   without this a chart-hexes contract would REGRESS on descent.
2. **§4.4 endCombat snippet** — the emit's `clearedCount:` line, same change, same reason.
3. **§3.3 `contractOffers` comment** — "rebroadcast never needed" amended: offers ARE re-sent
   when the lobby's dimension changes (`chooseDimension`, §4.5 here). Reason: 02's claim
   predated a mutable lobby dimension.

NOT changed (decisions 02 delegated to this feature, resolved without edits): the
activate-gateway contract keeps "activated ≡ cleared" (flag #7 — `applyContractEvent`
untouched); `isRetreatHex` keeps its 02 name and doubles as the travel stance predicate;
`RoomVote` gains the third kind exactly as 02 §9 anticipated. 02's `run_pending_xp` ledger and
`settleRun` are consumed as-is — travel deliberately never touches them.

---

## 10. Feature 3 / 5 seams this design commits to (binding on successors)

- **Starting tier (feature 3 manifest gate)**: `runs.start_dimension_id` → that dimension's
  `tier` is the run's starting tier. In the lobby, `roomState.dimensionTier` IS the starting
  tier (current ≡ start pre-launch) — the manifest UI gates on it client-side and the server
  re-validates via `getDimensionMeta(loadRun(runId).start_dimension_id).tier`. A NULL tier
  (dev-override run, flag #10) must be handled explicitly by 03 — suggested: gate manifests as
  tier 0 and label the run "Unplaced" — do not silently coerce.
- **Item tier (feature 3 codex snapshots)**: an item's effective tier =
  `dimensions.tier` of its `item.dimensionId` at acquisition time (getDimensionMeta lookup at
  drop/bank time; snapshot the resolved tier INTO the codex row — a dimension's tier is fixed
  at attunement and tier-0/backfilled dims never change, so snapshot-vs-live cannot drift).
  This resolves the recon-flagged 03/04 gap: ItemDefinition needs no new field.
- **Global item resolution** (`getItemById`, flag #9) is the resolution path 03's drops and
  manifested codex items ride — no dimension-scoped merge remains to work around.
- **Difficulty scaling (feature 5)**: `room.dimensionTier` (live on Room, null only for
  dev-override runs) + `hexDistance(hex, ORIGIN)` (02's shared helper) are the two inputs its
  budget formula consumes; both exist after this feature with zero further plumbing.
- **`dimension-entered`** is the bus event for arrival side effects (05's rest-node/theming
  hooks may subscribe); `hex-entered` remains unconsumed and reserved for 05's rest nodes.
- **Gateway graph queries**: `dimension_gateways` + `dimensions.tier` support future
  "multiverse map" UI (community tree render) read-only — no API committed here.
