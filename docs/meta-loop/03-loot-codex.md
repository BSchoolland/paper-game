# Feature 3 — Loot & Codex: Final Design

Status: FINAL — the design doc referenced by `docs/meta-loop/README.md:79`. Written 2026-07-01
against HEAD `47459b6` (feature 1 committed), with `docs/meta-loop/02-contracts.md` AND
`docs/meta-loop/04-portals.md` treated as binding, already-implemented contracts (build order is
1 → 2 → 4 → 3 → 5; this feature is implemented AFTER portals). Anchors into feature-2/4
artifacts use their names (`run-events.ts`, `settleRun`, `RoomVote`, `getItemById`,
`runs.start_dimension_id`, protocol v5); anchors into pre-feature-2 code use line numbers
verified at HEAD today — they shift once 02/04 land, the names do not.

Verified ground truth this design builds on:

- `server/src/db.ts` (918 lines at HEAD) — migrations gated on `PRAGMA user_version`; 02 adds
  v7, 04 adds v8, so this feature is **v9**, inserted directly after v8. `items` table
  (PK `(id, dimension_id)`), `saveItems` (880) collision check + `loadItems` (905);
  `run_seat_items`/`run_seat_attachments` store **IDs + ordering only** (`saveSeatInventory`
  674, `loadSeatInventory` 689 — 04 flag #9 re-points resolution to global `getItemById` and
  drops the dims-0-3 merge); `eraseClient` (540) per-run hard-delete loop; `finalizeRun` (503)
  first-writer-wins; `RunRow` gains `start_dimension_id` in v8 (the run's **starting tier**
  source, 04 §10).
- Live DB (`server/hex-discovery.sqlite`) facts that shape this design:
  - Rarities present in every dimension pool: `common`/`uncommon`/`rare` ONLY. `epic` and
    `legendary` exist in the `ItemRarity` type (`shared/src/core/items.ts:30`) but have zero
    content — drop weights must handle absent rarity buckets deterministically.
  - **One legacy item-id collision exists: `short-sword` is owned by BOTH dimension 0 and
    dimension 501** (501 predates `saveItems`' collision check). This violates 04's
    global-uniqueness premise for `getItemById` AND this feature's `codex_firsts` PK — fixed by
    a dedup added to 04's v8 migration (§9 Cross-feature changes).
  - Dimension 0's pool contains a dev item `abilitytest` — excluded from drops by a tunable set.
  - Item types across all pools: overwhelmingly `weapon`, a few `shield`/`consumable`/
    `accessory` — all four types drop and bank; only consumables are manifest-excluded.
- `shared/src/core/items.ts` — `ItemDefinition` = Weapon|Shield|Consumable|Accessory; fields
  `id, name, description, rarity, sprite, dimensionId, slotCost, abilities?`. **No `tier`
  field, and none is added** (04 §10: an item's tier derives from its dimension; codex rows
  snapshot it).
- `shared/src/core/inventory.ts` — `BAG_SIZE = 16` (3); `InventoryState` carries FULL
  `ItemDefinition` objects (so wire DTOs carrying full items are precedented by the existing
  `inventory` message); `createInventory`, `equipFromBag`, `canEquip` pure transforms.
- `shared/src/core/presets.ts` — `StarterPreset` (bag ≤ 2 + equipped 2 items);
  `DEFAULT_PRESET_ID`. `shared/src/core/progression.ts` — `expeditionSlots(level) =
  2 + floor(level/5)` (28) — locked #5's K, already shipped.
- `server/src/room.ts` — `Seat` (52: `inventory`, `presetId`, `accountId`, `cardProfile`);
  `Room` (110); `buildPresetInventory` (196 — 04 drops its `dimensionId` param);
  `createOpenSeats` (233).
- `server/src/index.ts` — inventory handlers 721-769 (`applyInventoryChange` 724: write-before-
  ack, `saveSeatInventory` → `sendInventory` → `broadcastRoomState`); `handleChoosePreset`
  (734); connection-scoped account block in `routeMessage` (796-833) — the dispatch home for
  `getCodex`; seat-gated switch below 848 — the home for `claimLoot`/`chooseManifest`.
- `server/src/awards.ts` → 02 renames to `run-recorders.ts`; `eligibleSeats` (22) is the
  attribution gate every recorder reuses. `run-events.ts` (02 §4.1) static REGISTRY + 02 §9:
  “Loot drops: feature 3 subscribes to `encounter-won`”; “Banking hook: the `run-ended` event —
  feature 3 registers codex banking here (bank on victory AND retreat; skip on
  defeat/abandoned)”. Both seams are consumed exactly as committed.
- `server/src/accounts.ts` — `bumpStat` (387), `getStats` (391), `evaluateTitles` (435),
  `loadProfilePayload` (318, open key/value stats mapping), `loadCardProfile` (343, gives the
  server-authoritative `level` for the K check), `AccountError` (14).
- `shared/src/net/protocol.ts` — at HEAD `PROTOCOL_VERSION = 3`; after 02 (+1) and 04 (+1) it
  is **5**; this feature bumps to **6**. `SeatInfo` (34), `RoomStatePayload` (51),
  `VoteStatePayload` (after 04: `kind: "move" | "retreat" | "travel"`, `target`, `travel`),
  `AccountStatsPayload` (105, after 02/04: + `contractsCompleted`, `dimensionsTraveled`),
  `inventory` message (283) already ships full `InventoryState` on the wire.
- `shared/src/core/titles.ts` — TITLES seeds sortOrder 0-5 at HEAD; 02 adds `sealbearer` (6),
  04 adds `depthfarer` (7); this feature adds **8 and 9**. Boot-time `seedTitles()` upsert
  propagates without a migration.
- 04 §10 seams consumed verbatim: starting tier = `getDimensionMeta(runs.start_dimension_id)
  .tier`, surfaced in the lobby as `roomState.dimensionTier` (current ≡ start pre-launch);
  item tier = `dimensions.tier` of `item.dimensionId` **snapshotted into the codex row at bank
  time**; NULL-tier (dev-override) runs handled explicitly, never silently coerced;
  `getItemById` is the global resolution path drops/manifests ride.
- Client — `main.ts`: floating HUDs constructed once outside the ScreenManager (`new
  VotePanel(conn, seat)` 350, ChatPanel bottom-left `left:16px;bottom:16px`, FriendsPanel
  top-right `right:16px;top:16px`, 02's ContractHud top-right `top:52px;right:10px`; PartyHud
  is top-left but combat-only — the top-left overworld slot is free); screen registration
  358-365; `conn.on("inventory")` 371; `xpBanked`/`getLastBank` holder pattern (02 §6.5).
  `screens/ui-kit.ts` — THEME/FONT tokens, `itemIcon(id)` (336) hardcodes
  `/sprites/items/${id}.webp` (dimension-0-shaped; NOT usable for cross-dimension items);
  `renderer/item-sprites.ts` `itemSpriteUrl({sprite, dimensionId})` is the single canonical
  item-art path builder (`sprites/items/dimension-<id>/<sprite>.webp`). KNOWN CONTENT GAP:
  recent generated dims (501, 705, …) shipped `.png` sprites while `itemSpriteUrl` builds
  `.webp` — pre-existing; loot/codex UI must tolerate missing art (§6.1) rather than throw.
  `screens/home-screen.ts` — panelCard with a two-column grid (153-168), `render()` full
  re-render + `rerenderIfVisible()` on store notify; `screens/lobby-screen.ts` — full-innerHTML
  re-render per notify; after 02/04 its body stacks Destination → Contract sections;
  `screens/game-over-screen.ts` — after 02 it is outcome-driven with a `getLastBank` injection.
- Tests — `db-migration-idempotency.test.ts` (04 moves the expectation to 8 — this feature
  moves it to **9**); `coop-harness.ts`; 02's `run-outcomes.test.ts` / 04's `travel.test.ts`
  machine-level stub-RoomIO pattern.

---

## 0. Flags & decisions (read first)

Orchestrator: items 1-5 are the load-bearing calls Ben should eyeball; 6-14 are smaller. None
contradict a locked decision; #1 interprets locked #4's "items carried" — flag it prominently.

1. **DECISION — codex banking scope = designs ACQUIRED this run (the drop ledger), not
   everything in seat inventories.** Locked #4 says victory "banks the designs of items
   carried"; locked #7 says a wipe loses "run items/**designs found this run**" — the
   found-this-run framing is the operative one, and this design banks exactly the run's
   `run_loot` rows (assigned AND unclaimed) for every eligible account. Deliberately NOT
   banked: starter-preset items (always available to everyone — banking them would pollute the
   shelf and hand out nonsense "first recovered" provenance for freebie kit) and TEAMMATES'
   manifested designs (banking those would be passive design-gifting between accounts, which
   the master doc explicitly defers). A literal "everything carried" reading is one line to
   adopt later (scan seat inventories instead of `run_loot` in §4.4). **Ben: confirm.**
2. **DECISION — unclaimed-at-run-end (the task's open question):** at settle the party pool
   evaporates — unclaimed items enter no inventory and cease to exist as items. Their DESIGNS
   were still found by the party this run, so on `victory`/`retreat` they bank into the codex
   exactly like assigned drops (design-level extraction; physical possession is irrelevant to
   knowledge). On `defeat`/`abandoned` nothing banks (locked #7). `run_loot` rows are kept
   after the run as an audit trail (the `run_pending_xp` precedent), deleted by `eraseClient`.
3. **DECISION — claim = the existing room vote, kind `"loot"`, self-claim only.** Locked #12
   names the movement-vote pattern; 02/04 already generalized `RoomVote` (`move`/`retreat`/
   `travel`) and this feature adds the fourth kind. A seat clicks Claim on a pool item → a
   room vote opens ("`<name>` claims `<item>`"), proposer auto-yes, `resolveVote` semantics
   (silence = consent: `yes >= 1 && yes >= no` at deadline), 15s `VOTE_TIMEOUT_MS`, single
   connected human resolves instantly — all identical mechanics to retreat/travel. v1 scope:
   you claim for yourself; "assign to seat X" is a trivial later extension (add a target seat
   to the message + vote payload). One open vote per room serializes contested claims; a
   rejected claim leaves the item in the pool for a counter-claim.
4. **DECISION — codex tier is a DENORMALIZED snapshot column (`codex_entries.tier`), resolved
   at bank time via `getDimensionMeta(item.dimensionId).tier`** (the derive-vs-denormalize
   question the task poses). Justification: (a) 04 §10 already committed to snapshot-at-bank
   ("snapshot the resolved tier INTO the codex row") and is binding; (b) a tier is fixed at
   attunement and never reassigned, so snapshot-vs-live cannot drift — the snapshot just
   removes a JOIN from every manifest-gate check and codex fetch; (c) codex rows are permanent
   provenance and must stay valid even if a dimension row is later culled/regenerated by the
   generator pipeline; (d) it lets the column be `NOT NULL` because untiered sources are
   excluded at bank time (flag #5).
5. **DECISION — drops from an UNTIERED dimension never bank.** A dev-override run
   (`GAME_ALLOW_UNCHARTED_DIMENSIONS=1`, 04 flag #5/#10) can fight inside a `tier IS NULL`
   dimension; banking those designs would mint permanent codex entries and global
   first-recovery credits for content that is not yet placed in the multiverse (and whose item
   ids could still be regenerated). The banking recorder skips them loudly:
   `console.error("[codex] skipped N designs from untiered dimension(s) …")` + a
   `skippedUntiered` count in the private `codexBanked` push. The manifest gate for a NULL
   starting tier follows 04 §10's suggestion: treat as tier 0 (only tier-0 designs
   manifestable), label the run "Unplaced" in the lobby UI. Neither is silent.
6. **DECISION — first-recovery credit** (locked #4: one named discoverer per design, globally
   unique, permanent): the account the item was **assigned to**, when that account is among
   the accounts banking at this settle; else the **host** seat's account (unclaimed items are
   a party find — the host stands for the party); else the lowest-seat-index banking account
   (host seat may be unattributed after migration edge cases). Deterministic, resolved
   per-design inside the banking loop. `INSERT OR IGNORE` on `codex_firsts(item_id)` makes the
   race across simultaneous settles in two rooms first-writer-wins.
7. **DECISION — duplicates.** The same design may drop repeatedly in one run (two swords arm
   two players — physical items are useful; design dedup happens only at the codex). A
   manifest may NOT contain the same design twice in v1 (materializing N copies from one
   design is an economy question the master doc defers with duplicate-salvage). Rejected with
   `INVALID_INPUT`.
8. **DECISION — drop persistence is snapshot-based.** `run_loot.item_json` stores the full
   `ItemDefinition` at drop time. Pool rehydration (crash recovery), claim materialization,
   and codex banking all read the snapshot — a mid-run generator rewrite of a dimension's pool
   can never mutate or orphan loot already dropped. Seat-inventory rehydration
   (`loadSeatInventory`) keeps storing IDs but extends resolution: `getItemById` (items table)
   → this run's `run_loot` snapshot → any `codex_entries` snapshot (identical per design by
   construction — this is what makes a MANIFESTED design resolvable even if its source
   dimension's pool was regenerated). These are canonical data sources consulted in a fixed
   order, not fallbacks; an id found nowhere keeps the existing loud `console.warn` + skip.
9. **DECISION — drops roll INSIDE the encounter-won emit** (02 §9's committed seam), after the
   gateway recorder. The roll uses a pure shared `rollDrops(pool, icon, rand)` with injected
   RNG (`Math.random` in prod, seeded in tests). Drops rolled by the run's FINAL winning
   encounter (the one that completes the contract) land unassigned and bank at settle —
   consistent with flag #2, no special case.
10. **FALLBACK (surfaced per convention): empty-pool skip.** If `loadItems(room.dimensionId)`
    is empty (impossible for READY dims — the 04 predicate requires ≥ 1 item — but reachable
    by dev-override runs inside incomplete dims, e.g. 502), the loot recorder logs
    `console.error("[loot] dimension <id> has no item pool — no drops")` and rolls nothing
    instead of throwing mid-`endCombat`. This is the only fallback this feature introduces.
11. **DECISION — manifested designs materialize into the BAG, not auto-equipped.** The player
    equips them in the loadout editor before Start (equip rules unchanged; `canEquip` slot
    math applies). Capacity is safe by construction: preset bag ≤ 2 + K ≤ 10 (level 40) ≤ 16
    (`BAG_SIZE`); `buildSeatLoadout` still throws on overflow (invariant, not a check).
    Known pre-existing quirk, unchanged: an equipped item with no authored `AttachmentData`
    renders invisibly on the character rig (true today for any mid-run-dropped item a player
    equips); combat abilities work regardless (`getItemAbilities` reads `equipped` only).
12. **DECISION — `resetToOrigin` re-applies seat manifests; rematch lobbies re-pick.** A host
    Reset / wipe-reset-in-place skips the lobby (02 flag #2 precedent: it also self-assigns
    the default contract), so each seat's in-memory `manifestIds` are re-validated against the
    start dimension's tier and re-materialized into the fresh starter bag — designs are
    permanent knowledge; re-manifesting is free. Play-Again goes through a fresh rematch LOBBY
    (existing flow) where players re-pick by hand. Crash-recovered rooms rehydrate
    `manifestIds = []` (manifests are lobby state; after start they are just bag items — a
    subsequent Reset on a recovered room yields plain starter kits, noted, acceptable).
13. **DECISION — the loot pool rides `RoomStatePayload`.** It is run-scoped truth that must
    survive reconnects (`sendSeatSnapshots`' existing roomState send covers it for free), it
    is small (a handful of entries at a time; claims drain it), and every mutation site
    already broadcasts roomState. A transient `lootFound` broadcast exists purely for the
    drop-moment toast. Full `ItemDefinition`s on the wire are precedented by the `inventory`
    message.
14. Small calls: pool entries are keyed by `run_loot.id` (rowid — stable claim handle; rows
    are only ever deleted by `eraseClient`, so no id reuse within a live run). Consumables
    drop, claim, and bank normally; they are excluded ONLY from manifests (locked #5) — the
    codex shelf shows them with a "Run-scoped" tag. Loot claims award no XP. Banking bumps two
    new stats (`designs_recovered`, `firsts_recovered`) and seeds two titles (§2.3). Guests
    bank normally (every seat has an account since feature 1). The same account on two seats
    dedups at the codex PK. `debugWin` exercises the whole pipeline (drops → claim → settle →
    bank), same as it does contracts/XP.

FALLBACK: exactly one, flag #10. (The image-onerror glyph in §6.1 is a display-only
degradation for missing art files, surfaced here for completeness.)

---

## 1. Data model & migration (v9)

### 1.1 Design rules

- `run_loot` is run-scoped: INTEGER ids, INTEGER-ms timestamps (matches `run_seat_items`/
  `run_pending_xp`); account references TEXT uuid; FKs declarative only (pragma off).
- `codex_entries` / `codex_firsts` are ACCOUNT-scoped and permanent: Supabase-shaped per 01
  §1.1 — TEXT uuid account refs, ISO-8601 TEXT timestamps. They are NOT per-run data:
  `eraseClient` does not touch them (same lifecycle as `profiles`/`account_stats`).
- `codex_entries` stores the full `item_json` snapshot PER ACCOUNT ROW (master README's
  explicit shape). The duplication across accounts is deliberate: rows are small, reads are
  account-scoped, and a per-account snapshot keeps erasure/export of one account
  self-contained. `codex_firsts` stores provenance only (the snapshot lives in the discoverer's
  entry row and every other holder's).
- Design-level dedup = the `(account_id, item_id)` PK + `INSERT OR IGNORE`. Global
  first-recovery uniqueness = the `codex_firsts.item_id` PK + `INSERT OR IGNORE`.
- `run_loot` assignment is first-writer-wins via `AND assigned_seat_index IS NULL` (the
  `finalizeRun` discipline applied to claims).

### 1.2 DDL — new `user_version < 9` block in db.ts, inserted directly after the v8 block

```ts
// v9: loot & codex (docs/meta-loop/03-loot-codex.md).
// run_loot: the run's drop ledger + shared party pool (assigned_seat_index NULL = still in the
// pool). item_json snapshots the ItemDefinition at drop time so loot outlives pool rewrites.
// codex_entries: per-account banked designs (full snapshot + tier resolved at bank time).
// codex_firsts: global first-recovery provenance — one row per design, ever, across all accounts.
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 9) {
    const migrate = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS run_loot (
        id                  INTEGER PRIMARY KEY,
        run_id              INTEGER NOT NULL,
        item_id             TEXT NOT NULL,
        dimension_id        INTEGER NOT NULL,   -- the item's native dimension (item.dimensionId)
        item_json           TEXT NOT NULL,      -- ItemDefinition snapshot at drop time
        source_q            INTEGER NOT NULL,
        source_r            INTEGER NOT NULL,
        source_icon         TEXT,               -- hex icon at drop time (richness provenance)
        dropped_at          INTEGER NOT NULL,   -- ms epoch (run-table convention)
        assigned_seat_index INTEGER,            -- NULL = unclaimed (in the party pool)
        assigned_account_id TEXT,
        assigned_at         INTEGER,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_run_loot_run ON run_loot (run_id)");
      db.exec(`CREATE TABLE IF NOT EXISTS codex_entries (
        account_id   TEXT NOT NULL,
        item_id      TEXT NOT NULL,
        dimension_id INTEGER NOT NULL,
        tier         INTEGER NOT NULL,          -- snapshot at bank time (flag #4)
        item_json    TEXT NOT NULL,
        acquired_at  TEXT NOT NULL,             -- ISO-8601 (account-table convention, 01 §1.1)
        PRIMARY KEY (account_id, item_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_codex_entries_item ON codex_entries (item_id)");
      db.exec(`CREATE TABLE IF NOT EXISTS codex_firsts (
        item_id      TEXT PRIMARY KEY,
        dimension_id INTEGER NOT NULL,
        account_id   TEXT NOT NULL,             -- the discoverer (flag #6)
        recovered_at TEXT NOT NULL,             -- ISO-8601
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )`);
      db.exec(`PRAGMA user_version = 9`);
    });
    migrate();
  }
}
```

Idempotent against the populated DB (`IF NOT EXISTS` everywhere, gated once by `user_version`,
one transaction). Fresh DBs flow v3→…→v9. Never edit the shipped v3-v8 blocks. No backfill:
loot/codex history begins at deploy.

### 1.3 db.ts surface changes

**Drop ledger + pool:**

```ts
export interface RunLootRow {
  id: number; run_id: number; item_id: string; dimension_id: number; item_json: string;
  source_q: number; source_r: number; source_icon: string | null; dropped_at: number;
  assigned_seat_index: number | null; assigned_account_id: string | null; assigned_at: number | null;
}

const insertRunLootStmt = db.prepare(
  `INSERT INTO run_loot (run_id, item_id, dimension_id, item_json, source_q, source_r, source_icon, dropped_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const unassignedLootStmt = db.prepare(
  "SELECT * FROM run_loot WHERE run_id = ? AND assigned_seat_index IS NULL ORDER BY id");
const allLootForRunStmt = db.prepare("SELECT * FROM run_loot WHERE run_id = ? ORDER BY id");
// First-writer-wins claim (mirrors finalizeRun's AND active = 1 discipline).
const assignLootStmt = db.prepare(
  `UPDATE run_loot SET assigned_seat_index = ?, assigned_account_id = ?, assigned_at = ?
   WHERE id = ? AND run_id = ? AND assigned_seat_index IS NULL`);
const lootSnapshotForRunStmt = db.prepare(
  "SELECT item_json FROM run_loot WHERE run_id = ? AND item_id = ? LIMIT 1");

/** Insert one drop; returns its lootId (rowid). */
export function insertRunLoot(runId: number, item: ItemDefinition, source: HexCoord,
    icon: HexIconType | null): number {
  const info = insertRunLootStmt.run(runId, item.id, item.dimensionId, JSON.stringify(item),
    source.q, source.r, icon, Date.now());
  return Number(info.lastInsertRowid);
}
export function loadUnassignedLoot(runId: number): RunLootRow[];
export function loadRunLoot(runId: number): RunLootRow[];

/**
 * Claim commit (write-point discipline of commitExplore): mark the drop assigned AND persist the
 * claimant's new bag in ONE transaction — a crash can never assign an item without the bag row
 * (or vice versa). Returns false when another path already assigned it (stale vote resolve).
 */
export function commitLootAssignment(runId: number, lootId: number, seatIndex: number,
    accountId: string | null, inv: InventoryState): boolean {
  let claimed = false;
  const tx = db.transaction(() => {
    claimed = assignLootStmt.run(seatIndex, accountId, Date.now(), lootId, runId).changes > 0;
    if (claimed) saveSeatInventory(runId, seatIndex, inv); // nested tx = savepoint (bun:sqlite)
  });
  tx();
  return claimed;
}
```

**Codex:**

```ts
export interface CodexEntryRow {
  account_id: string; item_id: string; dimension_id: number; tier: number;
  item_json: string; acquired_at: string;
}
export interface CodexFirstRow {
  item_id: string; dimension_id: number; account_id: string; recovered_at: string;
}

const insertCodexEntryStmt = db.prepare(
  `INSERT OR IGNORE INTO codex_entries (account_id, item_id, dimension_id, tier, item_json, acquired_at)
   VALUES (?, ?, ?, ?, ?, ?)`);
const insertCodexFirstStmt = db.prepare(
  `INSERT OR IGNORE INTO codex_firsts (item_id, dimension_id, account_id, recovered_at)
   VALUES (?, ?, ?, ?)`);
const codexForAccountStmt = db.prepare(
  "SELECT * FROM codex_entries WHERE account_id = ? ORDER BY acquired_at DESC, item_id");
const codexEntryStmt = db.prepare(
  "SELECT * FROM codex_entries WHERE account_id = ? AND item_id = ?");
const codexFirstStmt = db.prepare("SELECT * FROM codex_firsts WHERE item_id = ?");
const codexSnapshotStmt = db.prepare(
  "SELECT item_json FROM codex_entries WHERE item_id = ? LIMIT 1"); // identical per design

/** True iff the row was newly inserted (dedup-aware — drives the codexBanked push contents). */
export function bankCodexEntry(accountId: string, item: ItemDefinition, tier: number): boolean {
  return insertCodexEntryStmt.run(accountId, item.id, item.dimensionId, tier,
    JSON.stringify(item), new Date().toISOString()).changes > 0;
}
/** True iff this call recorded the global first (INSERT OR IGNORE first-writer-wins). */
export function recordCodexFirst(item: ItemDefinition, accountId: string): boolean {
  return insertCodexFirstStmt.run(item.id, item.dimensionId, accountId,
    new Date().toISOString()).changes > 0;
}
export function loadCodex(accountId: string): CodexEntryRow[];
export function loadCodexEntry(accountId: string, itemId: string): CodexEntryRow | null;
export function loadCodexFirst(itemId: string): CodexFirstRow | null;
```

**Item resolution (extends 04's `getItemById` path — flag #8):**

```ts
/**
 * Resolve an item id for a run's seat rows: live pool -> this run's drop snapshot -> the design
 * archive. Canonical sources in fixed order; null only for a genuinely unknown id.
 */
export function resolveItemForRun(runId: number, itemId: string): ItemDefinition | null {
  const live = getItemById(itemId);                       // 04 §1.3
  if (live) return live;
  const drop = lootSnapshotForRunStmt.get(runId, itemId) as { item_json: string } | null;
  if (drop) return JSON.parse(drop.item_json) as ItemDefinition;
  const design = codexSnapshotStmt.get(itemId) as { item_json: string } | null;
  if (design) return JSON.parse(design.item_json) as ItemDefinition;
  return null;
}
```

`loadSeatInventory(runId, seatIndex)` (post-04 signature) swaps its per-row `getItemById(id)`
call for `resolveItemForRun(runId, id)`; the existing unknown-id `console.warn` + skip is
otherwise unchanged.

**`eraseClient` (540)** — add `delLootForRunStmt` (`DELETE FROM run_loot WHERE run_id = ?`) to
the per-run loop. `codex_entries`/`codex_firsts` are account data and are NOT deleted (design
provenance is permanent; matches profiles/stats lifecycle).

---

## 2. Shared modules

### 2.1 `shared/src/core/loot.ts` (new; export from `shared/src/index.ts` next to progression)

Pure data + pure functions; server rolls, client renders labels from the same constants.

```ts
import type { HexIconType } from "../map/hex-map.js";
import type { ItemDefinition, ItemRarity } from "./items.js";

/** Drop-richness class per hex icon (locked #12 + master: treasure hexes drop more/better). */
export type LootRichness = "standard" | "elite" | "treasure" | "grand" | "apex";

export const LOOT_RICHNESS_BY_ICON: Readonly<Record<HexIconType, LootRichness>> = {
  town: "standard", city: "standard", gateway: "standard", "gateway-city": "standard",
  "enemy-camp": "standard",
  ruins: "elite", "elite-encounter": "elite",
  treasure: "treasure",
  "great-ruins": "grand", "great-treasure": "grand",
  boss: "apex", calamity: "apex",
};

/** A plain hex (no icon) fights like an enemy-camp and drops like one. */
export function richnessForIcon(icon: HexIconType | null): LootRichness {
  return icon === null ? "standard" : LOOT_RICHNESS_BY_ICON[icon];
}

export interface DropProfile {
  /** Probability the encounter drops at all (rolled once). */
  readonly dropChance: number;
  /** Independent item rolls when it does. */
  readonly count: number;
  readonly rarityWeights: Readonly<Record<ItemRarity, number>>;
}

/** THE tunable table. epic/legendary weights are 0 until such content exists (live pools carry
 *  common/uncommon/rare only); the fallback walk below handles sparse pools either way. */
export const DROP_PROFILES: Readonly<Record<LootRichness, DropProfile>> = {
  standard: { dropChance: 0.6, count: 1, rarityWeights: { common: 70, uncommon: 25, rare: 5,  epic: 0, legendary: 0 } },
  elite:    { dropChance: 1.0, count: 1, rarityWeights: { common: 45, uncommon: 40, rare: 15, epic: 0, legendary: 0 } },
  treasure: { dropChance: 1.0, count: 2, rarityWeights: { common: 40, uncommon: 40, rare: 20, epic: 0, legendary: 0 } },
  grand:    { dropChance: 1.0, count: 3, rarityWeights: { common: 15, uncommon: 45, rare: 40, epic: 0, legendary: 0 } },
  apex:     { dropChance: 1.0, count: 2, rarityWeights: { common: 10, uncommon: 40, rare: 50, epic: 0, legendary: 0 } },
};

export const RARITY_ORDER: readonly ItemRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Dev/test items that must never drop (present in live pools). */
export const LOOT_EXCLUDED_ITEM_IDS: ReadonlySet<string> = new Set(["abilitytest"]);

/**
 * Roll an encounter's drops from a dimension pool. Pure: all randomness through `rand`
 * (() => number in [0,1)). Rolled rarity with an empty bucket walks DOWN RARITY_ORDER to the
 * nearest present rarity, then UP — deterministic, never empty-handed while the pool has items.
 * Duplicate designs across rolls are allowed (flag #7). Empty pool -> [].
 */
export function rollDrops(
  pool: readonly ItemDefinition[],
  icon: HexIconType | null,
  rand: () => number,
): ItemDefinition[] {
  const profile = DROP_PROFILES[richnessForIcon(icon)];
  const eligible = pool.filter((i) => !LOOT_EXCLUDED_ITEM_IDS.has(i.id));
  if (eligible.length === 0) return [];
  if (rand() >= profile.dropChance) return [];
  const byRarity = new Map<ItemRarity, ItemDefinition[]>();
  for (const item of eligible) {
    (byRarity.get(item.rarity) ?? byRarity.set(item.rarity, []).get(item.rarity)!).push(item);
  }
  const totalWeight = RARITY_ORDER.reduce((s, r) => s + profile.rarityWeights[r], 0);
  const drops: ItemDefinition[] = [];
  for (let n = 0; n < profile.count; n++) {
    let roll = rand() * totalWeight;
    let rolled: ItemRarity = "common";
    for (const r of RARITY_ORDER) {
      roll -= profile.rarityWeights[r];
      if (roll < 0) { rolled = r; break; }
    }
    const bucket = nearestPresentRarity(byRarity, rolled);   // down-then-up walk, file-local
    const items = byRarity.get(bucket)!;
    drops.push(items[Math.floor(rand() * items.length)]!);
  }
  return drops;
}

/** Locked #5's manifest gate, shared so lobby UI and server validation cannot drift. */
export function isManifestable(item: ItemDefinition, designTier: number, startingTier: number): boolean {
  return item.type !== "consumable" && designTier <= startingTier;
}

/** 04 §10's NULL-tier rule for dev-override runs: gate manifests as tier 0. */
export function effectiveStartingTier(dimensionTier: number | null): number {
  return dimensionTier ?? 0;
}
```

(`nearestPresentRarity`: from the rolled rarity's index, scan indices `i-1, i-2, …, 0`, then
`i+1, …` — return the first rarity with a non-empty bucket; the empty-pool case was excluded
above.)

### 2.2 `shared/src/core/titles.ts` (edit — two seeds; boot `seedTitles()` upsert propagates)

```ts
  { id: "archivist",   name: "Archivist",   description: "Bank 10 item designs into your codex.",
    sortOrder: 8, requirement: { stat: "designs_recovered", gte: 10 } },
  { id: "trailblazer", name: "Trailblazer", description: "Be the first in the multiverse to recover a design.",
    sortOrder: 9, requirement: { stat: "firsts_recovered", gte: 1 } },
```

(sortOrder 8/9 assume 02 shipped `sealbearer` at 6 and 04 shipped `depthfarer` at 7.)

---

## 3. Wire protocol (shared/src/net/protocol.ts)

`PROTOCOL_VERSION` bumps **5 → 6** (02 took 3→4, 04 took 4→5; a same-day deploy shows one
refresh banner).

### 3.1 New/changed DTOs

```ts
/** One drop in the shared party pool. Full ItemDefinition (the `inventory` message precedent)
 *  so the client renders name/sprite/rarity with zero lookups. */
export interface LootPoolEntry {
  readonly lootId: number;                 // run_loot.id — the claim handle
  readonly item: ItemDefinition;
  readonly sourceIcon: HexIconType | null; // richness provenance for the tooltip
}

/** One banked design, with provenance resolved server-side (dimension + discoverer names). */
export interface CodexEntryPayload {
  readonly item: ItemDefinition;
  readonly dimensionId: number;            // the design's native dimension
  readonly dimensionName: string;
  readonly tier: number;
  readonly acquiredAt: string;             // ISO — when THIS account banked it
  readonly first: {
    readonly accountId: AccountId;
    readonly displayName: string;
    readonly at: string;                   // ISO
    readonly mine: boolean;                // discoverer === the requesting account
  };
}

export type VoteKind = "move" | "retreat" | "travel" | "loot";

// VoteStatePayload (post-04 shape) gains the claim payload (null unless kind === "loot"):
export interface VoteStatePayload {
  readonly proposalId: string;
  readonly kind: VoteKind;
  readonly proposerSeatId: SeatId;         // for kind "loot" the proposer IS the claimant
  readonly target: HexCoord | null;        // move-only
  readonly travel: GatewayInfo | null;     // travel-only
  readonly loot: LootPoolEntry | null;     // loot-only — drives the VotePanel claim line
  readonly votes: Partial<Record<SeatId, VoteChoice>>;
  readonly electorate: readonly SeatId[];
  readonly deadlineMs: number;
}

// RoomStatePayload (post-04 shape) gains the pool (flag #13):
export interface RoomStatePayload {
  // ...existing (incl. 02's contract/outcome, 04's dimensionName/dimensionTier)...
  /** Unclaimed party drops, oldest first. Always [] outside a started run. */
  readonly lootPool: readonly LootPoolEntry[];
}

// SeatInfo (34) gains lobby manifest transparency (reconnect-safe roster truth):
export interface SeatInfo {
  // ...existing...
  /** Codex designs this seat will materialize at start. [] when none/bot/open. */
  readonly manifestIds: readonly string[];
}

// AccountStatsPayload (post-02/04 shape) gains:
  readonly designsRecovered: number;
  readonly firstsRecovered: number;
```

### 3.2 ClientMessage additions (union at 206)

```ts
  // Seat-scoped, overworld-only: propose claiming a pool item for YOUR seat (opens a loot vote).
  | { type: "claimLoot"; lootId: number }
  // Seat-scoped, lobby-only: set this seat's manifest picks (full replacement, may be []).
  | { type: "chooseManifest"; itemIds: readonly string[] }
  // Connection-scoped (no seat required): fetch your codex for the shelf / manifest picker.
  | { type: "getCodex" }
```

(`castVote` is reused unchanged for loot ballots — one open vote per room, matched by
`proposalId`, exactly as retreat/travel.)

### 3.3 ServerMessage additions/changes (union at 250)

```ts
  // Broadcast at drop time — toast/celebration only; pool truth rides roomState (flag #13).
  | { type: "lootFound"; drops: readonly LootPoolEntry[] }

  // getCodex response (PRIVATE): the requesting account's full codex, acquired_at DESC.
  | { type: "codex"; entries: readonly CodexEntryPayload[] }

  // Run-end settlement push (PRIVATE per-seat, next to 02's xpBanked): what JUST entered your
  // codex at this settle. entries = newly-banked only (dedup already applied); firstItemIds ⊆
  // entries' ids = designs whose global first-recovery credit went to YOU; skippedUntiered
  // surfaces flag #5's loud skip.
  | { type: "codexBanked"; entries: readonly CodexEntryPayload[];
      firstItemIds: readonly string[]; skippedUntiered: number }
```

`ErrorCode` is unchanged: `claimLoot` failures reuse `BAD_PHASE` (not overworld / vote already
open) / `NOT_YOUR_SEAT` (spectator) / `INVALID_INPUT` ("That item is no longer available",
"Your bag is full"); `chooseManifest` failures reuse `BAD_PHASE` / `INVALID_INPUT` ("Too many
designs (max K)", "Not in your codex", "Consumable designs cannot be manifested", "That design's
tier exceeds this expedition", "Duplicate design"). All new sends go through `io`/`sendTo`
(envelope `seq` discipline). `codex` and `codexBanked` are per-socket/per-seat PRIVATE sends.

---

## 4. Server flows

### 4.1 Room/Seat state additions (room.ts, both construction sites + reconstruction)

```ts
// Room:
  lootPool: LootPoolEntry[];               // unclaimed drops, mirrors run_loot WHERE unassigned

// Seat:
  manifestIds: string[];                   // lobby picks (validated); [] until chosen
```

Init: `createRoomFor` / `createOpenSeats` — `lootPool = []`, `manifestIds = []`.
`reconstructRoomForRun` — `lootPool = loadUnassignedLoot(runId).map(rowToPoolEntry)`
(`rowToPoolEntry` parses `item_json`), `manifestIds = []` (flag #12).
`resetToOrigin` — `room.lootPool = []` (fresh run) + the manifest re-apply in §4.6.

`roomStatePayload` (room-machine.ts:128) adds `lootPool: room.lootPool`; `seatInfo()` adds
`manifestIds: [...seat.manifestIds]`.

### 4.2 Loot drop recorder (server/src/loot.ts, new domain module)

02's static REGISTRY (as amended by 04) gains one `encounter-won` line and one `run-ended`
line; final order is load-bearing and greppable in one place:

```ts
const REGISTRY: readonly RunEventRegistration[] = [
  on("run-started", recordRunStarted),
  on("encounter-won", recordEncounterWon),        // 02: XP accrual + stats/titles
  on("encounter-won", contractProgressRecorder),  // 02: contract progress
  on("encounter-won", gatewayAttunementRecorder), // 04: gateway attunement
  on("encounter-won", lootDropRecorder),          // 03: drops (independent of the three above)
  on("run-ended", recordRunSettled),              // 02: XP banking pushes
  on("run-ended", codexBankingRecorder),          // 03: THE banking hook (02 §9)
  on("dimension-entered", recordDimensionEntered),// 04
];
```

```ts
/** encounter-won subscriber: roll the dimension pool, persist drops, grow the party pool.
 *  Pure recorder (02 §4.1 discipline): persists + pushes, never touches phase/vote/session. */
export function lootDropRecorder(room: Room, io: RoomIO,
    ev: Extract<RunEvent, { type: "encounter-won" }>): void {
  const pool = Object.values(loadItems(room.dimensionId));
  if (pool.length === 0) {
    // FALLBACK (flag #10): dev-override runs can enter incomplete dims; READY dims never hit this.
    console.error(`[loot] dimension ${room.dimensionId} has no item pool — no drops`);
    return;
  }
  const drops = rollDrops(pool, ev.icon, Math.random);
  if (drops.length === 0) return;
  const entries: LootPoolEntry[] = drops.map((item) => ({
    lootId: insertRunLoot(ev.runId, item, ev.hex, ev.icon),
    item,
    sourceIcon: ev.icon,
  }));
  room.lootPool = [...room.lootPool, ...entries];
  io.broadcast(room, { type: "lootFound", drops: entries });
}
```

Timing: synchronous SQLite inside the already-synchronous emit; `endCombat`'s win branch
broadcasts roomState right after the emits, so the pool rides the same broadcast that returns
the party to the overworld. On the contract-completing final win, `settleRun`'s roomState
broadcast carries the pool instead; those drops stay unclaimed and bank at settle (flag #9).

### 4.3 Claim vote (room-machine.ts) — fourth `RoomVote` kind

```ts
export type RoomVote =
  | (RoomVoteBase & { readonly kind: "move"; readonly target: HexCoord })
  | (RoomVoteBase & { readonly kind: "retreat" })
  | (RoomVoteBase & { readonly kind: "travel"; readonly gateway: GatewayInfo })
  | (RoomVoteBase & { readonly kind: "loot"; readonly entry: LootPoolEntry });
```

`voteStatePayload` emits `loot: vote.kind === "loot" ? vote.entry : null` (and `target`/
`travel` null for loot, mirroring the other kinds).

**`proposeLootClaim(room, io, seat, lootId)`** — sibling of `proposeRetreat`/`proposeTravel`,
same guard ladder and copy discipline:

```ts
//   phase !== "overworld"            -> BAD_PHASE     "Not in overworld"
//   room.vote                        -> BAD_PHASE     "A vote is already open"
//   seat.state !== "human-connected" -> NOT_YOUR_SEAT "Spectators cannot propose"
//   entry = room.lootPool.find(e => e.lootId === lootId)
//     undefined                      -> INVALID_INPUT "That item is no longer available"
//   seat.inventory.bag.indexOf(null) === -1
//                                    -> INVALID_INPUT "Your bag is full"
// Single connected human -> io.broadcast(room, { type: "voteState", vote: null });
//                           assignLoot(room, io, seat, entry);        (instant, retreat precedent)
// Else open { kind: "loot", entry, ... } with VOTE_TIMEOUT_MS, proposer auto-yes,
// voteState broadcast — identical mechanics to retreat/travel.
```

`resolveOpenVote`'s decided branch gains:

```ts
} else if (vote.kind === "loot") {
  if (resolution.accepted) {
    const claimant = seatById(room, vote.proposerSeatId);
    if (claimant) assignLoot(room, io, claimant, vote.entry);
  } // rejected: voteState null already broadcast; the item stays in the pool
}
```

(`cancelVote` needs no change — its `moveResolved` broadcast is already move-only per 02.)

**`assignLoot(room, io, seat, entry)`** — the single claim-commit path:

```ts
function assignLoot(room: Room, io: RoomIO, seat: Seat, entry: LootPoolEntry): void {
  // Re-check at resolve time (bag may have changed mid-vote via the loadout editor).
  const free = seat.inventory.bag.indexOf(null);
  if (free === -1 || seat.state === "open" || seat.state === "bot") {
    io.send(seat, { type: "error", code: "INVALID_INPUT",
      message: "Claim failed — no free bag slot", recoverable: true });
    return;                                    // item stays in the pool
  }
  const bag = [...seat.inventory.bag];
  bag[free] = entry.item;
  const nextInv = { ...seat.inventory, bag };
  const claimed = commitLootAssignment(room.runId, entry.lootId, seat.seatIndex,
    seat.accountId, nextInv);                  // one durable tx (§1.3)
  if (!claimed) return;                        // already assigned by a racing path — no-op
  seat.inventory = nextInv;
  room.lootPool = room.lootPool.filter((e) => e.lootId !== entry.lootId);
  sendInventory(room, io, seat);               // private ack (existing helper, room-machine:196)
  broadcastRoomState(room, io);                // pool shrank + loadoutSummary changed
}
```

Claims award no XP and emit no run event (nothing subscribes to assignment; the durable row is
the audit).

### 4.4 Codex banking recorder (server/src/codex.ts, new domain module)

Registered on `run-ended` AFTER `recordRunSettled` (§4.2 registry). The run-ended emit is
already gated on `finalizeRun`'s first-writer-wins `changed` boolean (02 §4.4), so banking runs
exactly once per run. Victory/retreat only happen through `settleRun` (in-room), so the
recorder always has a Room + io for pushes; `abandoned` paths without a Room never bank by
definition (locked #7).

```ts
export function codexBankingRecorder(room: Room, io: RoomIO,
    ev: Extract<RunEvent, { type: "run-ended" }>): void {
  if (ev.outcome !== "victory" && ev.outcome !== "retreat") return;   // locked #6/#7

  // Designs found this run (flag #1): dedup the ledger by item id, keep the first row per
  // design (its assigned_account_id feeds first-recovery credit, flag #6).
  const byDesign = new Map<string, RunLootRow>();
  for (const row of loadRunLoot(ev.runId)) {
    if (!byDesign.has(row.item_id)) byDesign.set(row.item_id, row);
  }
  if (byDesign.size === 0) return;

  const bankSeats = eligibleSeats(room);                              // 02's attribution gate
  if (bankSeats.length === 0) return;
  const bankAccounts = bankSeats.map((s) => s.accountId!);
  const hostAccount = room.hostSeatId
    ? seatById(room, room.hostSeatId)?.accountId ?? null : null;

  let skippedUntiered = 0;
  const skippedDims = new Set<number>();
  const newEntries = new Map<string, CodexEntryPayload[]>();          // accountId -> pushes
  const firstCredits = new Map<string, string[]>();                   // accountId -> itemIds

  for (const row of byDesign.values()) {
    const meta = getDimensionMeta(row.dimension_id);                  // 04 §1.3
    if (!meta) throw new Error(`codex: dimension ${row.dimension_id} missing for design ${row.item_id}`);
    if (meta.tier === null) { skippedUntiered++; skippedDims.add(row.dimension_id); continue; } // flag #5
    const item = JSON.parse(row.item_json) as ItemDefinition;

    // Global first (flag #6): assignee if banking now, else host if banking, else first banker.
    const discoverer =
      (row.assigned_account_id && bankAccounts.includes(row.assigned_account_id))
        ? row.assigned_account_id
        : (hostAccount && bankAccounts.includes(hostAccount)) ? hostAccount : bankAccounts[0]!;
    const isFirst = recordCodexFirst(item, discoverer);
    if (isFirst) {
      bumpStat(discoverer, "firsts_recovered", 1);
      (firstCredits.get(discoverer) ?? firstCredits.set(discoverer, []).get(discoverer)!)
        .push(item.id);
    }

    for (const accountId of bankAccounts) {
      if (!bankCodexEntry(accountId, item, meta.tier)) continue;      // dedup: already known
      bumpStat(accountId, "designs_recovered", 1);
      (newEntries.get(accountId) ?? newEntries.set(accountId, []).get(accountId)!)
        .push(codexEntryPayload(loadCodexEntry(accountId, item.id)!, accountId)); // §4.5 builder
    }
  }
  if (skippedUntiered > 0) {
    console.error(`[codex] skipped ${skippedUntiered} design(s) from untiered dimension(s) ` +
      `[${[...skippedDims].join(", ")}] — dev-override runs bank nothing from unplaced dims`);
  }

  for (const seat of bankSeats) {
    const accountId = seat.accountId!;
    io.send(seat, {
      type: "codexBanked",
      entries: newEntries.get(accountId) ?? [],
      firstItemIds: firstCredits.get(accountId) ?? [],
      skippedUntiered,
    });
    const newTitles = evaluateTitles(accountId);                      // archivist/trailblazer
    refreshCardProfile(seat, accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}
```

Ordering note: `recordRunSettled` (XP pushes) runs first so the game-over screen's toasts read
XP-then-codex; the two recorders share no state. Crash window: a crash between `finalizeRun`
and this recorder loses that run's banking (same window 02 accepted for its settlement
*pushes*; XP banking itself is in-transaction because db-internal finalize paths need it —
codex banking never runs on those paths, so recorder placement costs only this negligible
window). `accounts.ts` — `loadProfilePayload`'s stats mapping adds `designsRecovered` /
`firstsRecovered` (open key set, no schema change).

### 4.5 Codex fetch (server/src/codex.ts + index.ts)

```ts
/** Payload builder shared by getCodex and the banking pushes. */
export function codexEntryPayload(row: CodexEntryRow, requesterId: string): CodexEntryPayload {
  const first = loadCodexFirst(row.item_id);
  if (!first) throw new Error(`codex: missing codex_firsts row for ${row.item_id}`); // bank writes both
  const meta = getDimensionMeta(row.dimension_id);
  if (!meta) throw new Error(`codex: dimension ${row.dimension_id} missing`);
  return {
    item: JSON.parse(row.item_json) as ItemDefinition,
    dimensionId: row.dimension_id,
    dimensionName: meta.name,
    tier: row.tier,
    acquiredAt: row.acquired_at,
    first: {
      accountId: first.account_id,
      displayName: loadCardProfile(first.account_id).displayName,
      at: first.recovered_at,
      mine: first.account_id === requesterId,
    },
  };
}

export function handleGetCodex(ws: ServerWebSocket<SocketData>): void {
  const accountId = ws.data.accountId;
  if (!accountId) return sendError(ws, "BAD_PHASE", "Say hello first");
  const entries = loadCodex(accountId).map((r) => codexEntryPayload(r, accountId));
  sendTo(ws, { type: "codex", entries });
}
```

`routeMessage`: `case "getCodex":` joins the connection-scoped account block (index.ts:796-833)
— usable from the home screen with no seat.

### 4.6 Manifest (index.ts + room.ts)

**`room.ts` — `buildSeatLoadout` (new; sits beside `buildPresetInventory`):**

```ts
/** Starter preset + materialized codex designs into the first free bag slots (flag #11). */
export function buildSeatLoadout(presetId: string, manifest: readonly ItemDefinition[]): InventoryState {
  const inv = buildPresetInventory(presetId);          // post-04 signature (global resolution)
  const bag = [...inv.bag];
  for (const item of manifest) {
    const free = bag.indexOf(null);
    if (free === -1) throw new Error("buildSeatLoadout: bag overflow"); // impossible: ≤2 preset + K ≤ 10 < 16
    bag[free] = item;
  }
  return { ...inv, bag };
}
```

**`handleChooseManifest(room, seat, ws, itemIds)`** — seat-scoped block next to
`handleChoosePreset` (index.ts:734):

```ts
if (room.phase !== "lobby") return sendError(ws, "BAD_PHASE", "Manifests are chosen in the lobby");
if (!seat.accountId) return sendError(ws, "INVALID_INPUT", "No account bound to this seat");
if (new Set(itemIds).size !== itemIds.length)
  return sendError(ws, "INVALID_INPUT", "Duplicate design");                       // flag #7
const level = loadCardProfile(seat.accountId).level;                               // server-derived
const slots = expeditionSlots(level);
if (itemIds.length > slots)
  return sendError(ws, "INVALID_INPUT", `Too many designs (max ${slots})`);
const startingTier = effectiveStartingTier(room.dimensionTier);   // lobby: current ≡ start (04 §10)
const manifest: ItemDefinition[] = [];
for (const id of itemIds) {
  const entry = loadCodexEntry(seat.accountId, id);
  if (!entry) return sendError(ws, "INVALID_INPUT", "Not in your codex");
  const item = JSON.parse(entry.item_json) as ItemDefinition;
  if (item.type === "consumable")
    return sendError(ws, "INVALID_INPUT", "Consumable designs cannot be manifested"); // locked #5
  if (!isManifestable(item, entry.tier, startingTier))
    return sendError(ws, "INVALID_INPUT", "That design's tier exceeds this expedition");
  manifest.push(item);
}
seat.manifestIds = [...itemIds];
seat.inventory = buildSeatLoadout(seat.presetId ?? DEFAULT_PRESET_ID, manifest);
applyInventoryChange(room, seat);            // existing helper: persist -> inventory ack -> roomState
```

**`handleChoosePreset` (734)** — one-line change: `seat.inventory =
buildSeatLoadout(presetId, manifestItemsFor(seat))` instead of the bare preset build, so a
preset re-pick keeps the seat's manifests (`manifestItemsFor(seat)` re-parses the seat's
`manifestIds` via `loadCodexEntry` — ids were validated at choose time; a missing row here is
an invariant break → throw).

**04's `handleChooseDimension` hook** — after its contract re-derivation block, re-validate
manifests against the NEW tier (04 flag #12's contract reset, applied to manifests):

```ts
const newTier = effectiveStartingTier(room.dimensionTier);
for (const s of room.seats) {
  if (s.manifestIds.length === 0 || !s.accountId) continue;
  const kept = s.manifestIds.filter((id) => {
    const e = loadCodexEntry(s.accountId!, id)!;
    return isManifestable(JSON.parse(e.item_json) as ItemDefinition, e.tier, newTier);
  });
  if (kept.length !== s.manifestIds.length) {
    s.manifestIds = kept;
    s.inventory = buildSeatLoadout(s.presetId ?? DEFAULT_PRESET_ID, manifestItemsFor(s));
    saveSeatInventory(room.runId, s.seatIndex, s.inventory);
    if (s.socket) sendInventory(room, io, s);
  }
}
// (the broadcastRoomState already in handleChooseDimension carries the shrunk manifestIds;
//  the LobbyScreen surfaces the drop — §6.3)
```

**`resetToOrigin` (room-machine.ts:1135)** — flag #12: the per-seat loop's inventory line
becomes

```ts
seat.manifestIds = seat.manifestIds.filter(/* same isManifestable re-check vs the start dim's tier */);
seat.inventory = buildSeatLoadout(DEFAULT_PRESET_ID, manifestItemsFor(seat));
```

plus `room.lootPool = []`. (`handlePlayAgain`'s rematch room is a fresh lobby — nothing to do.)

**routeMessage additions (seat-gated switch, below 848):**

```ts
case "claimLoot":
  return proposeLootClaim(room, io, seat, msg.lootId);
case "chooseManifest":
  return handleChooseManifest(room, seat, ws, msg.itemIds);
```

**startGame:** no new work — inventories (preset + manifest) were built and persisted at choose
time; bot-filled seats have `manifestIds = []`.

### 4.7 Crash / reconnect / sweep behavior

- Reconnect into overworld: `roomState.lootPool` restores the pool UI; an open loot vote rides
  the existing `voteState` snapshot send. Reconnect into the lobby: `SeatInfo.manifestIds`
  restores the picker selection; the client re-sends `getCodex` on lobby enter for the picker's
  design list.
- Crash recovery (`reconstructRoomForRun`): pool rehydrated from `run_loot` unassigned rows
  (snapshots — no items-table dependency); claimed items rehydrate through
  `loadSeatInventory` → `resolveItemForRun` (flag #8). `manifestIds` rehydrate empty (flag #12).
- Hourly sweep / `abandonPriorSeatForClient` / lobby-crash recovery: outcome `abandoned` — the
  banking recorder's outcome gate makes these non-events for the codex (and they run without a
  Room anyway).
- `eraseClient`: deletes the client's `run_loot` rows with the other per-run rows; codex tables
  untouched (§1.3).

---

## 5. Tunable constants (single table)

| Constant | Value | Lives in |
|---|---|---|
| `DROP_PROFILES.standard` | 60% × 1 drop; c70/u25/r5 | shared/core/loot.ts |
| `DROP_PROFILES.elite` (ruins, elite-encounter) | 100% × 1; c45/u40/r15 | shared/core/loot.ts |
| `DROP_PROFILES.treasure` (treasure) | 100% × 2; c40/u40/r20 | shared/core/loot.ts |
| `DROP_PROFILES.grand` (great-ruins, great-treasure) | 100% × 3; c15/u45/r40 | shared/core/loot.ts |
| `DROP_PROFILES.apex` (boss, calamity) | 100% × 2; c10/u40/r50 | shared/core/loot.ts |
| `LOOT_RICHNESS_BY_ICON` | table in §2.1 | shared/core/loot.ts |
| `LOOT_EXCLUDED_ITEM_IDS` | `{"abilitytest"}` | shared/core/loot.ts |
| Manifest slots K | `expeditionSlots(level)` = 2 + ⌊level/5⌋ (existing) | shared/core/progression.ts |
| Manifest tier gate | design tier ≤ `effectiveStartingTier(dimensionTier)` | shared/core/loot.ts |
| Claim vote timeout | `VOTE_TIMEOUT_MS` (15s, reused) | server/room-machine.ts |
| Bag capacity ceiling | `BAG_SIZE` 16 (existing, untouched) | shared/core/inventory.ts |
| Archivist / Trailblazer gates | 10 designs / 1 first | shared/core/titles.ts |

---

## 6. Client (ui-kit THEME language throughout; no new colors)

### 6.1 ui-kit.ts additions

- `RARITY_COLOR: Record<ItemRarity, string>` — `common: THEME.muted`, `uncommon: THEME.green`,
  `rare: THEME.gold`, `epic: THEME.danger`, `legendary: THEME.parchHi` (all existing tokens).
- `designChip(item: ItemDefinition, sizePx = 40): HTMLDivElement` — the cross-dimension sibling
  of `itemIcon` (which stays dimension-0-only for preset kit): same dark gold-keyline chip
  styling, but the image src comes from `itemSpriteUrl(item)`
  (`renderer/item-sprites.ts` — the single canonical path builder), border-color
  `RARITY_COLOR[item.rarity]` at 55% alpha, `title = item.name`. `img.onerror` → swap the img
  for a `◆` glyph in `RARITY_COLOR[item.rarity]` (display-only degradation for the known
  .png/.webp content gap — never a throw; the item name still shows via tooltip/labels).

### 6.2 `client/src/renderer/loot-panel.ts` (new floating HUD)

VotePanel/ContractHud precedent: constructed ONCE in main.ts, `position: fixed; top: 52px;
left: 10px; z-index: 110; width: 264px` (top-left is free in overworld — PartyHud is
combat-only), `background: rgba(17,13,9,0.85); border: 1px solid ${THEME.goldLine};
border-radius: 8px; padding: 10px 12px`. Subscribes to SeatContext; visible iff
`seat.room?.phase === "overworld" && seat.room.lootPool.length > 0`. Contents:

- `eyebrow`-styled header (`font: 700 10px ${FONT.cinzel}; letter-spacing: .14em; color:
  ${THEME.goldDeep}`): `Party Spoils · ${lootPool.length}`.
- One row per `LootPoolEntry` (max-height 300px, `overflow-y: auto`): `designChip(item, 34)` +
  name (`13px ${FONT.body}; color: ${RARITY_COLOR[item.rarity]}`) + a small `Claim` ghost
  button (`font: 600 11px ${FONT.cinzel}; border: 1px solid ${THEME.goldLine}; color:
  ${THEME.gold}; border-radius: 6px; padding: 3px 10px`) → sends
  `{ type: "claimLoot", lootId }`. Claim buttons render disabled (`opacity:.5;
  cursor:default`) while `voteState` is non-null (one vote per room) or when the own bag is
  full (`bag.indexOf(null) === -1` from the mirrored inventory state) with a `Bag full` title.
- Re-renders in place on SeatContext notify (roomState carries the pool) — same discipline as
  ContractHud.

### 6.3 `client/src/renderer/vote-panel.ts` (02/04's generalized single class)

- Title by kind: `"loot"` → `"Claim proposed"`.
- Loot second line (12px, `#8a7a68`, the retreat/travel-line slot):
  `` `${proposerName} claims ${vote.loot!.item.name}` `` with the item name in
  `RARITY_COLOR[rarity]`; prepend `designChip(vote.loot!.item, 26)` inline.
- Tally/countdown/buttons/clear behavior already kind-agnostic — no other edits.

### 6.4 `client/src/screens/lobby-screen.ts` — manifest section

New full-width section BELOW 02's contract board (order: 04 Destination → 02 Contract → 03
Manifest), rule-separated, same 44px gutter:

- Constructor subscribes `conn.on("codex", (msg) => { this.codex = msg.entries;
  this.render(); })` and sends `{ type: "getCodex" }` in `enter()` (mirror of the
  contractOffers subscription).
- Header row: `heading("Manifest", "section")` + hint (`13px; color:${THEME.faint}`):
  `` `Bring up to ${slots} codex designs · tier ${startingTier} or below` `` where `slots =
  expeditionSlots(accountStore.profile.level)` (shared import; server re-validates) and
  `startingTier = effectiveStartingTier(room.dimensionTier)`. When `room.dimensionTier ===
  null` append ` · Unplaced expedition — tier 0 designs only` (flag #5 / 04 §10).
- Slot row: `slots` fixed 48px chip wells (`border:1px dashed ${THEME.goldLine};
  border-radius:8px`). Filled wells render `designChip(item, 40)` + an `✕` corner affordance —
  click removes the pick and re-sends the full list (`chooseManifest` is a full replacement).
  Empty wells are click targets that open the picker popover.
- Picker popover (ProfileCard `titlesPopover()` precedent, anchored under the slot row): a
  scrollable grid of the account's codex designs. Eligible (`isManifestable(item, tier,
  startingTier)` and not already picked) → clickable, `designChip` + name + `TIER n` chip
  (`11px; letter-spacing:.1em; color:${THEME.goldDeep}`). Ineligible → `opacity:.45`, inert,
  reason label (`Run-scoped` for consumables / `Tier too high`). Click sends `chooseManifest`
  with the new id list and closes.
- Roster rail: each seat row appends a compact `+N designs` chip (`11px;
  color:${THEME.goldDeep}`) when `seatInfo.manifestIds.length > 0` (transparency; no per-item
  render in v1).
- Dropped-picks notice: LobbyScreen keeps the previously rendered own `manifestIds`; when a
  re-render shows the server shrank them (dimension change re-validation, §4.6), render a
  one-line `errorNote("Some manifested designs exceed the new destination's tier and were
  returned.")` above the slot row until the next manifest interaction.
- No inputs in the section — the full-innerHTML re-render discipline holds.

### 6.5 `client/src/screens/home-screen.ts` — codex shelf

Full-width shelf under the existing two-column grid, inside the same `panelCard` (render()
appends it after `grid`, rule-separated):

- Header row: `eyebrow("Codex")` + count (`13px; color:${THEME.faint}`):
  `` `${entries.length} designs recovered` ``. Empty state (guests included): the row plus
  `` `No designs recovered yet — win an expedition to bank your first.` `` (`13px;
  color:${THEME.faint}; font-style:italic`).
- Shelf: horizontally scrollable flex row (`overflow-x:auto; gap:${THEME.gap};
  padding:12px 0`) of design cards, `acquired_at` DESC (server order). Card = 150px mini-plate
  (contract-card styling: `border:1px solid ${THEME.goldLine}; border-radius:10px;
  background:rgba(11,9,6,0.45); padding:12px`):
  - `designChip(item, 44)` centered; name under it (`700 13px ${FONT.cinzel};
    color:${RARITY_COLOR[rarity]}`); `TIER ${tier}` chip (`11px; letter-spacing:.1em;
    color:${THEME.goldDeep}`); consumables add a `Run-scoped` tag (`10px;
    color:${THEME.faint}`).
  - Provenance line (`11px/1.4 ${FONT.body}; color:${THEME.faint}`): `First recovered from
    ${dimensionName} by ${first.mine ? "you" : first.displayName}` — `first.mine` renders the
    "you" in `THEME.gold` with a subtle glow (`text-shadow:0 0 8px rgba(232,200,122,.4)`).
- Data flow: HomeScreen sends `{ type: "getCodex" }` in `enter()` and re-renders on the
  `codex` message routed to it from main.ts (same pattern as `setRooms` for `roomList`); a
  `codexBanked` push while home also triggers a re-fetch.

### 6.6 `client/src/screens/game-over-screen.ts` (extends 02's outcome variants)

Constructor gains a `getLastCodexBank: () => CodexBankedMsg | null` injection (next to 02's
`getLastBank`). Victory and retreat variants add a codex line under the XP line (14px):

- `entries.length > 0`: `` `${entries.length} design(s) entered into the codex` `` in
  `THEME.gold`; append `` ` · ${firstItemIds.length} world-first(s)` `` in `THEME.parchHi`
  when non-zero.
- `entries.length === 0 && skippedUntiered === 0`: `No new designs — the codex already knows
  these.` (`THEME.muted`) — only when the run had drops; omit entirely otherwise.
- `skippedUntiered > 0`: append `` `${skippedUntiered} design(s) not banked — unplaced
  dimension` `` in `THEME.danger` (flag #5 surfaced to the player).
- Defeat variant: unchanged (02's copy already implies loss; run items/designs are gone).

### 6.7 main.ts wiring (composition root)

- `let lastCodexBank: Extract<ServerMessage, {type:"codexBanked"}> | null = null;`
  `conn.on("codexBanked", (msg) => { lastCodexBank = msg; if (msg.entries.length > 0)
  pushToast(`Codex — ${msg.entries.length} new design(s) banked`); for (const _ of
  msg.firstItemIds) pushToast("✦ World first! Design recovered for the first time anywhere");
  })` — cleared on the same triggers as 02's `lastBank` (`leftRoom`, fresh-overworld
  roomState). Pass `() => lastCodexBank` to GameOverScreen.
- `new LootPanel(conn, seat)` constructed next to VotePanel/ContractHud (line ~350);
  `conn.on("lootFound", (msg) => { for (const d of msg.drops)
  pushToast(`Spoils — ${d.item.name}`); })`.
- Route `conn.on("codex", …)` to whichever surface asked last: simplest is a tiny
  `CodexStore` (AccountStore pattern: `entries`, `subscribe/notify`, `setEntries`) constructed
  in main.ts and passed to HomeScreen + LobbyScreen; both send `getCodex` on enter and render
  from the store (no message routing ambiguity).
- `client/dev/mock-data.ts` roomState fixtures gain `lootPool: []` and per-seat
  `manifestIds: []` (typecheck against the v6 payload).

---

## 7. Migration / compat behavior for existing data

1. DB v8 → v9 on first boot (idempotent, §1.2). No backfill; codex/loot history starts empty.
2. Historical finalized runs: no `run_loot` rows — a `run-ended` for them (impossible anyway —
   they are inactive) would bank nothing.
3. In-flight runs at deploy: `lootPool` rehydrates empty (no rows yet); their encounters start
   dropping immediately post-deploy; banking works at settle. Contract-less legacy runs (02
   flag #11) bank normally — banking keys off outcome, not contract.
4. Protocol 5 clients get `protocolMismatch` + refresh banner (existing UX).
5. The `short-sword` id collision is repaired by 04's amended v8 migration (§9) BEFORE any
   codex row can reference an ambiguous id; `codex_firsts.item_id` uniqueness is sound from
   the first bank.
6. `codex_entries.item_json` snapshots make codex rows immune to later items-table rewrites;
   `run_loot.item_json` does the same for in-flight pools (flag #8).
7. Existing tests: migration-idempotency expectation 8 → 9 (+ v9 spot-checks); coop
   suites get mechanical updates (roomState `lootPool`, SeatInfo `manifestIds`, voteState
   `loot`, protocol version). 02/04's contract/retreat/travel suites are asserted unchanged
   otherwise.
8. Missing item art for recent dims (.png vs .webp — §ground truth) degrades to the glyph chip
   (§6.1); recommend (manual, post-ship): normalize generated item sprites to `.webp` in the
   generator/pull pipeline. Out of scope here.

---

## 8. Test plan (`bun test` from repo root; typecheck via `bun run typecheck`)

Patterns: unit DB tests set `GAME_DB_PATH=":memory:"` + `GAME_SKIP_SEED=1` before a dynamic
import; machine-level tests use a stub RoomIO (02's run-outcomes.test.ts / 04's travel.test.ts
pattern); end-to-end uses `coop-harness.ts`.

**shared/src/__tests__/loot.test.ts** (new)
- `richnessForIcon`: full icon table + null → standard.
- `rollDrops` with a scripted `rand` sequence: standard rolls nothing when the first rand ≥
  0.6 and exactly one item when < 0.6; grand yields 3 items; weights honored (rand values
  chosen to land in each rarity band); same rand sequence twice → identical drops
  (determinism).
- Rarity fallback walk: pool with only-uncommon items + a rolled `rare` → uncommon (down);
  pool with only-rare + rolled `common` → rare (up); dim-1-shaped pool (c/u only, no rare)
  under `apex` weights never returns undefined.
- `LOOT_EXCLUDED_ITEM_IDS`: a pool of only `abilitytest` → `[]`; mixed pool never drops it.
- Duplicates allowed: two rolls, one-item pool → the same design twice.
- `isManifestable`: consumable always false; tier ≤/> gate; `effectiveStartingTier(null) === 0`.

**server/src/__tests__/codex-db.test.ts** (new, :memory:)
- v9 tables exist post-migration; `db-migration-idempotency.test.ts` expectation moves to
  `user_version === 9` + spot-checks `run_loot`/`codex_entries`/`codex_firsts` after both
  subprocess rounds.
- `insertRunLoot`/`loadUnassignedLoot`/`loadRunLoot` roundtrip incl. snapshot JSON.
- `commitLootAssignment`: assigns + persists bag atomically; second call for the same lootId
  returns false and leaves the first claimant's rows intact (first-writer-wins proof); a
  crash-shaped partial (assign without bag) is impossible — assert both rows or neither via a
  thrown mid-tx fault if cheap, else rely on the tx test above.
- `bankCodexEntry` dedup: second insert for (account, item) returns false, row unchanged;
  distinct accounts both insert. `recordCodexFirst`: only the first call true; row keeps the
  original discoverer.
- `resolveItemForRun` order: items-table hit wins; deleted-from-pool id resolves via run_loot
  snapshot; manifested id from a foreign run resolves via codex_entries; unknown id → null;
  `loadSeatInventory` rehydrates a bag containing a pool-deleted dropped item (the flag-#8
  regression).
- `eraseClient` removes `run_loot` rows; codex tables untouched.

**server/src/__tests__/loot-claim.test.ts** (new, machine-level, stub RoomIO)
- `lootDropRecorder`: encounter-won inserts rows + grows `room.lootPool` + broadcasts
  `lootFound`; empty-pool dimension → console.error path, no rows, no broadcast (flag #10);
  excluded ids never drop.
- `proposeLootClaim` guards: not-overworld → BAD_PHASE; open vote → BAD_PHASE; spectator →
  NOT_YOUR_SEAT; unknown/claimed lootId → INVALID_INPUT; full bag → INVALID_INPUT.
- Single human → instant assign: bag gains the item at the first free slot, pool shrinks,
  run_loot row assigned, `inventory` sent to claimant, roomState broadcast; two humans → vote
  `{kind:"loot", loot: entry}`; yes → assigned; no-majority → voteState null, item still in
  pool, claimable again.
- Bag fills mid-vote (equip/unequip churn) → resolve-time re-check sends the claim-failed
  error, item stays in pool.
- One vote per room: claim during an open retreat vote → BAD_PHASE (02/04 coexistence).
- Pool survives travel (04): drops in dim A remain claimable after `travelToDimension`;
  claimed item from dim A rehydrates in dim B (snapshot resolution).

**server/src/__tests__/codex-banking.test.ts** (new, machine-level, stub RoomIO)
- Victory with 2 drops (1 assigned to seat B, 1 unclaimed) + 2 eligible seats: BOTH accounts
  gain BOTH designs (unclaimed banks too — flag #2); firsts: assigned design credits seat B's
  account, unclaimed credits the host; `codexBanked` pushes carry the right per-account
  entries/firstItemIds; stats bumped; `trailblazer` granted.
- Retreat banks identically; defeat and abandoned bank NOTHING (rows remain, codex empty).
- Dedup: a design already in account A's codex → not in A's push, still in B's; second run
  dropping the same design → no new firsts, discoverer unchanged.
- Untiered dimension drops: skipped with `skippedUntiered` count + console.error; tiered
  designs in the same settle still bank (flag #5).
- Tier snapshot: bank a design whose dimension has tier 2 → `codex_entries.tier === 2`
  (from `getDimensionMeta`, not the item JSON).
- run-ended fires once (02's `changed` gate) → double-settle cannot double-bank
  (`INSERT OR IGNORE` belt-and-suspenders assertion).
- Same account holding two seats: one codex row, one push per seat (dedup at PK).

**server/src/__tests__/manifest.test.ts** (new, machine-level)
- `chooseManifest` guards: non-lobby → BAD_PHASE; > K → INVALID_INPUT (K derived from a
  profile xp fixture via `expeditionSlots(levelForXp(xp))`); not-in-codex / consumable /
  tier-too-high / duplicate ids → INVALID_INPUT with the §3.3 copy.
- Happy path: bag = preset bag + designs in first free slots; `run_seat_items` persisted;
  SeatInfo.manifestIds broadcast; re-`choosePreset` keeps manifests; `chooseManifest []`
  clears them.
- 04 `chooseDimension` to a lower tier drops now-ineligible picks, rebuilds + persists
  inventories, keeps eligible ones (§4.6).
- NULL-tier lobby (dev-override): only tier-0 designs pass (flag #5).
- `resetToOrigin` re-applies manifests into the fresh starter bag (flag #12);
  `reconstructRoomForRun` → manifestIds [].
- Manifested design resolves in a NEW run at a different dimension (codex-snapshot resolution
  through `loadSeatInventory` after a simulated items-table wipe of the source dim).

**server/src/__tests__/coop-integration.test.ts additions** (harness, end-to-end)
- Start → move → debugWin → both sockets get `lootFound` (when the seeded rand… drops are
  Math.random in prod: make the harness dimension's hex an icon with `dropChance 1` — override
  the target hex icon to `treasure` via the community icon table, guaranteeing ≥ 2 drops) and
  roomState.lootPool non-empty; claimant sends `claimLoot` → voteState `{kind:"loot"}` on both
  → yes → claimant's `inventory` message contains the item, pool empties on both sockets.
- Victory end-to-end (02's chart-hexes debugWin loop at a treasure-rich map): settle →
  private `codexBanked` with entries + first credit; `getCodex` from a FRESH home-screen
  socket for the same account returns the design with dimension name + "by you" provenance
  (`first.mine`).
- Rematch lobby: `getCodex` → `chooseManifest` one banked design → startGame → the design is
  in the seat's `inventory` bag; a tier-gated design in a tier-0 lobby → INVALID_INPUT.
- Wipe run with unclaimed + claimed drops → debugLose → NO codexBanked entries; `getCodex`
  unchanged (locked #7 proof).
- Reconnect into overworld mid-pool: fresh socket + reclaim → roomState.lootPool intact.

**Regression clause**: 01/02/04 suites pass with mechanical updates only (protocol 6, roomState
`lootPool`, SeatInfo `manifestIds`, voteState `loot` field). Seat reclaim, crash recovery, host
migration, discovery, HMAC, contracts, retreat, travel, and XP-banking behavior are asserted
unchanged.

---

## 9. Cross-feature changes (edits made to predecessor docs by this design)

Per the amendment rule, `docs/meta-loop/04-portals.md` received ONE minimal edit; 02 needed
none.

1. **04 §1.2 (v8 migration) — legacy item-id dedup added.** 04's `getItemById` and this
   feature's `codex_firsts(item_id)` PK both require globally-unique item ids. `saveItems` has
   enforced that for new writes since before HEAD, but the live DB predates the check by one
   row: **`short-sword` is owned by BOTH dimension 0 and dimension 501**. The v8 block now
   renames every duplicate-id row outside its lowest-dimension owner to the `d<dim>-<id>`
   convention `saveItems`' own error message prescribes (rewriting `item_json.id` and
   re-pointing `run_seat_items`/`run_seat_attachments` rows for runs at that dimension — a
   no-op on live data: zero runs exist at 501). Reason: without it, v8's global `WHERE id = ?`
   resolution is ambiguous for that id, and any codex row banked from it would be permanently
   ambiguous provenance. Fixing it in v8 (not v9) keeps 04's stated invariant true from the
   moment `getItemById` ships.

NOT changed: 02's `run-ended`/`encounter-won` seams are consumed exactly as committed (§4.2);
04's starting-tier and item-tier seams (§10) are consumed verbatim, including the NULL-tier
rules; `isRetreatHex`, `RoomVote`, and the vote machinery gain only the additive fourth kind 02
§9 anticipated ("the movement-vote pattern already exists").

---

## 10. Feature 5 seams this design commits to (binding on successors)

- **Drop scaling**: `rollDrops(pool, icon, rand)` takes the profile from
  `richnessForIcon(icon)` — feature 5 may layer tier/distance multipliers by wrapping the
  profile lookup (one call site in `lootDropRecorder`); the pure function and its tests stand.
- **Rest nodes (towns/cities)**: when 05 converts cleared towns to safe rest nodes, their
  re-visits are `hex-entered` (no combat, no `encounter-won`) — the loot recorder keys off
  `encounter-won` only, so rest nodes drop nothing without any 03 change.
- **Epic/legendary content**: `DROP_PROFILES` already carries the full `ItemRarity` domain
  with 0 weights; introducing higher-rarity items is a weights-table edit, no code.
- **Assign-to-other-seat claims**: add an optional target seat to `claimLoot` + the loot vote
  payload; `assignLoot` already takes the target seat as a parameter.
- **Duplicate manifesting / salvage economy** (master doc deferred): the `(account_id,
  item_id)` codex PK and flag #7's single-copy manifest rule are the two touch points.
