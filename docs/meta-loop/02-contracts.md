# Feature 2 — Contracts & Run Outcomes: Final Design

Status: FINAL — the design doc referenced by `docs/meta-loop/README.md:78`. Every line anchor
below was verified against the live source at HEAD (`47459b6`, feature 1 committed) on
2026-07-01. Data-model-first: schema is authoritative; protocol, server flows, and UI derive
from it. Implementers need only this document, the master README, and `01-accounts.md`.

Verified ground truth this design builds on:

- `server/src/db.ts` (919 lines) — `export const db` handle (25); migrations gated on
  `PRAGMA user_version`, currently **6** (v6 block 218-299). `RunOutcome` (430) already includes
  an unused `"victory"`. `finalizeRun(runId, outcome)` (503) is THE single idempotent run-end:
  first-writer-wins via `AND active = 1` in `markRunInactiveStmt` (458), stamps live seats, and
  returns `true` iff THIS call performed the transition. `deactivateStaleRuns` (519) and
  `abandonPriorSeatForClient` (639) route through it **inside db.ts** — any banking tied to run
  end must live where they can reach it. `RunRow` (432) has no contract columns.
  `eraseClient` (540) hard-deletes per-run rows. `profiles` (v6, 246) is created in db.ts, so
  db.ts-prepared statements may touch it without importing accounts.ts (no cycle).
- `server/src/room-machine.ts` — `roomStatePayload` (128), `broadcastRoomState` (176),
  `proposeMove` (872) / `castVote` (918) / `resolveMovementVote` (941) / `finalizeMove` (968) /
  `cancelVote` (984) over `room.vote: MovementVote` and shared `resolveVote`;
  `encounterTypeFor` (998) derives the hex icon; `endCombat` (1070) — win branch 1085-1097
  (exploreHex → phase overworld → `awardEncounterWin` → broadcasts), loss branch 1098-1109
  (`finalizeRun(runId,"defeat")` → `recordWipe` → `gameOver{outcome:"defeat"}`);
  `exploreHex` (1117); `resetToOrigin` (1135) finalizes + starts a new run at the same
  dimension; `connectSeat` (1325); `reconstructRoomForRun` (1399) rehydrates a Room at
  overworld from durable rows; `recoverActiveRuns` (1514) abandons crashed lobby runs.
- `server/src/index.ts` — hourly sweep 130-137 (`deactivateStaleRuns`, `purgeExpiredSessions`);
  `sendSeatSnapshots` (244); `createRoomFor` (356, Room literal 387-410); `handleJoinRoom`
  (459); `handleStartGame` (596, bot-fill then `recordDimensionsSeen` at 628);
  `handleReset` (637 — combat abort keeps the run; overworld/gameover →
  `resetToOrigin(room, io, "abandoned")`); `handlePlayAgain` (672); `handleDebugWin` (689) /
  `handleDebugLose` (705) force `session.state.winner` then `endCombat`; `routeMessage` (775),
  seat gate above line 848.
- `server/src/awards.ts` — `eligibleSeats(room)` (22): `accountId !== null` and state
  human-connected/disconnected; `awardEncounterWin` (34) calls `accounts.awardXp` (instant
  profile write — the site this feature reroutes), `bumpStat`, `evaluateTitles`, private
  `xpAward`/`titlesEarned`/`profile` pushes; `recordWipe` (55); `recordDimensionsSeen` (68).
- `server/src/accounts.ts` — `awardXp` (373), `bumpStat` (387), `getStats` (391),
  `evaluateTitles` (435), `loadProfilePayload` (318), `loadCardProfile` (343).
- `server/src/room.ts` — `SocketData` (40), `Seat` (52), `MovementVote` (100), `Room` (110),
  `createOpenSeats` (233).
- `shared/src/net/protocol.ts` — `PROTOCOL_VERSION = 3` (14); `RoomStatePayload` (51);
  `VoteStatePayload` (166) is move-specific (`target: HexCoord` required); `gameOver` types
  `outcome: "victory" | "defeat"` (282); `xpAward` (291) carries `{amount, xp, level, leveledUp}`;
  `AccountStatsPayload` (105).
- `shared/src/map/hex-map.ts` — `HEX_ICON_TYPES` (8-21) includes `gateway`, `gateway-city`,
  `great-ruins`, `great-treasure`, `boss`; `getHexIcon` (72) falls back to the DETERMINISTIC
  `pickIconForHex` (61) — icons for *undiscovered* hexes are computable server-side, which makes
  contract-target scanning possible with zero new state. No `hexDistance` exists yet.
- `shared/src/map/hex-config.ts` — spawn weights (total 229): boss 0.5, gateway 2,
  gateway-city 1, great-ruins 1.5, great-treasure 0.7.
- `shared/src/overworld/movement-vote.ts` — pure `resolveVote(ballots, electorate,
  {deadlinePassed})` (20): proposer auto-yes, accepted when `yes >= 1 && yes >= no`.
- `shared/src/core/progression.ts` — `XP_ENCOUNTER_WIN = 25`, `levelForXp`, `xpToReachLevel`,
  `expeditionSlots`.
- `shared/src/combat/reaction-bus.ts` — the registry pattern (typed `on()` registrations,
  synchronous dispatch, fail-loud) this feature's run-event bus mirrors at room scope.
- Client — `main.ts`: floating HUDs constructed once outside the ScreenManager
  (`new VotePanel(conn, seat)` at 350, ChatPanel/FriendsDock 351-352); screen registration
  358-365 (`new GameOverScreen(conn)` at 362); `xpAward` toast handler 211-213;
  `switchForPhase` (412); the `gameOver` message is currently informational only (comment at
  280-281 — the `gameover` roomState phase drives the screen). `renderer/vote-panel.ts` is
  hardcoded to "Move proposed". `screens/game-over-screen.ts` renders ONCE in its constructor,
  defeat-only. `screens/map-screen.ts` `onHexClick` (64). `screens/lobby-screen.ts` two-column
  body (129-140: roster rail 380px + preset picker). `screens/ui-kit.ts` THEME/FONT tokens,
  `boardBackdrop(scene: "home"|"lobby"|"gameover")` with a red gameover tint, `panelCard`,
  `eyebrow`, `heading`, `rule`, `btn`. `state/seat-context.ts` exposes `room`/`isHost()`.
- Tests — `server/src/__tests__/db-migration-idempotency.test.ts` asserts
  `user_version === 6` (**must be updated to 7 by this feature**); `coop-harness.ts` (real
  server, in-memory DB); `shared/src/__tests__/progression.test.ts`.

---

## 0. Flags & decisions (read first)

Orchestrator: items 1-4 are decisions this design makes where the master README is silent or
ambiguous; none contradict a locked decision.

1. **Decision — host-gated contract pick, visible to all** (the README's stated default
   posture). The host picks from a server-generated offer board in the lobby; every seat sees
   the live selection via `roomState.contract`. Alternative considered and NOT adopted: an
   any-seat propose+vote flow (movement-vote pattern) — more ceremony than a lobby needs, and
   the host already gates start. Trivial to add later since offers/selection are already
   broadcast.
2. **Decision — a run that reaches startGame without a host pick gets the default contract**
   `chart-hexes` (always available, no map dependency) rather than blocking start. "Exactly one
   contract per run" (locked #3) is therefore an invariant enforced at startGame, not a lobby
   gate. `resetToOrigin` runs (host Reset / play-again-in-place after a wipe) skip the lobby
   entirely, so the fresh run is also assigned the default `chart-hexes` contract.
3. **Decision — `abandoned` banks 50% of pending XP**, same as defeat/retreat. The locked
   decisions cover victory (100%, implied), retreat (50%), wipe (50%) but not abandonment
   (host Reset, stale sweep, prior-seat abandonment on quick-match). 0% would make a host
   Reset or a dropped connection strictly worse than dying, which invites grief; 50% keeps
   "finishing is always better" true. Single tunable map (§2.1) if Ben wants 0.
4. **Decision — slay-boss targets ANY `boss`-icon hex; recover-relic targets ONE specific
   hex.** Locked #3 says "recover-relic (win a specific great-ruins/great-treasure hex)" —
   specific by definition. It does not say "specific" for slay-boss, and boss hexes are rare
   (weight 0.5/229 ≈ 0.2%): pinning one exact boss hex would frequently be a 20-hex march.
   Both offers still carry a nearest-target hint for the HUD. activate-gateway = clear any
   `gateway`/`gateway-city` hex (feature 4 gives activation real travel semantics; for this
   feature "activated" ≡ cleared).
5. **MUST-RECONCILE resolved (per the master doc): XP moves from instant-award to a per-run
   pending ledger.** `awards.ts:37`'s `awardXp(accountId, XP_ENCOUNTER_WIN)` call is replaced
   by `accruePendingXp(runId, accountId, amount)` (new, db.ts). `profiles.xp` is now written
   ONLY by `finalizeRun`'s banking step (and by `accounts.awardXp`, which remains as the
   accounts-domain primitive used by its unit tests — no src call sites after this change).
   Mid-run `xpAward` pushes become provisional (`pending` total, no level) — locked-decision
   UX allowance. Stats and titles keep committing instantly (locked #7: "stats/titles always
   persist").
6. **Banking lives inside `finalizeRun`'s transaction in db.ts** — deliberately NOT in
   accounts.ts. Two of the four finalize call sites (`deactivateStaleRuns`,
   `abandonPriorSeatForClient`) are inside db.ts with no Room and no accounts.ts access
   (importing accounts.ts from db.ts would be a cycle). Banking must be atomic with the
   first-writer-wins transition or a crash between them double-banks or loses XP. Cost: one
   `UPDATE profiles SET xp = xp + ?` statement prepared in db.ts, duplicating accounts.ts's
   write target — accepted and documented here. The multiplier math is a single shared helper
   (`bankedXp`, §2.1) used by both db.ts and the push-building recorder, so displayed and
   banked amounts cannot drift.
7. **Room-level run-event bus: ADOPTED** (README "strongly consider"). `server/src/run-events.ts`
   — typed events, synchronous dispatch, static registry (§4.1). Subscribers record/accrue/
   persist/push; they NEVER change `room.phase`, call `finalizeRun`, or await. Phase
   transitions stay in room-machine.ts, which *reads* state after emitting. The
   **feature-3 banking hook is the `run-ended` event**: emitted on every finalized outcome
   with `{runId, outcome, contract}`; feature 3 registers a codex-banking recorder against it
   (this feature ships the event + the XP-settlement recorder, so the seam is exercised, not
   dead).
8. **`gameOver`/`roomState` carry the outcome; the game-over screen is data-driven.** Today
   only a defeat screen exists and the `gameOver` message is informational. A reconnect into a
   `gameover`-phase room gets `roomState` but no `gameOver` message, so the outcome must ride
   `RoomStatePayload` (`outcome: RunOutcome | null`) — the screen reads SeatContext, not a
   transient message.
9. **Retreat needs no new resolution message.** VotePanel hides on `voteState: null` and
   MapScreen re-enables input on the same; an accepted retreat immediately lands
   `roomState{phase:"gameover"}`. `moveResolved` stays move-only (the map animates on it).
10. **`PROTOCOL_VERSION` 3 → 4.** `xpAward` reshapes, `voteState` gains `kind`,
    `roomState` gains `contract`/`outcome`, `gameOver` gains `"retreat"`, plus new messages.
    Stale clients get the existing protocolMismatch refresh banner. Both sides deploy together.
11. **Legacy in-flight runs (upgraded mid-run) have `contract_json = NULL`** → `room.contract
    = null`: no HUD, no victory path, retreat/wipe work normally (their pending ledger starts
    empty — nothing lost; their pre-upgrade XP was already banked instantly under v1 rules).
    Contract-less is a valid, handled state everywhere; only startGame/resetToOrigin guarantee
    non-null for NEW runs.
12. Offers are recomputed on demand from deterministic icon math + the community icon table —
    no `contract_offers` storage, no staleness. The same scan runs at offer-send and at
    choose-validation; determinism makes them agree.
13. `debugWin` completes contracts (it drives the real `endCombat`) — intended; it is the test
    lever for victory (chart-hexes N wins via F2) exactly as it is today for XP.

FALLBACK: none introduced by this feature. (`buildPresetInventory`'s existing unknown-preset
fallback and dev `serverSecret()` are pre-existing and untouched.)

---

## 1. Data model & migration (v7)

### 1.1 Design rules

- `runs` is a legacy integer-keyed table: its new column and the new run-scoped ledger table
  keep INTEGER ids and INTEGER-ms timestamps (matching `run_cleared_hexes`/`run_seat_items`),
  per 01-accounts §1.1 "existing tables keep their integer conventions". `account_id` stays
  TEXT uuid.
- Contract state is persisted as ONE JSON snapshot column (`runs.contract_json`) — it is tiny
  (< 200 bytes), 1:1 with the run, rewritten atomically on every progress change, and
  rehydrated verbatim on crash recovery. No separate `run_contracts` table: nothing queries
  contracts across runs in v1, and a JSON snapshot cannot drift from the shape the machine
  holds in memory.
- The pending-XP ledger is per (run, account) — accumulation handles the same account holding
  two seats in one run (possible across two devices; mirrors today's per-seat double award).
- Ledger rows are NEVER deleted at banking time. Idempotency comes from `finalizeRun`'s
  `changed` guard (banking runs only on the one-shot active→inactive transition), and the
  surviving rows are what the settlement recorder reads to build the private `xpBanked`
  pushes after finalize. `eraseClient` deletes them with the run's other rows.

### 1.2 DDL — new `user_version < 7` block in db.ts, inserted directly after the v6 block (line 299)

```ts
// v7: contracts & run outcomes (docs/meta-loop/02-contracts.md).
// runs.contract_json: the run's ContractState snapshot (shared/src/overworld/contracts.ts),
// NULL for legacy/pre-contract runs. run_pending_xp: the per-run pending-XP ledger, banked
// into profiles.xp by finalizeRun with the outcome multiplier (rows kept as audit).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 7) {
    const migrate = db.transaction(() => {
      try {
        db.exec("ALTER TABLE runs ADD COLUMN contract_json TEXT");
      } catch (e) {
        if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
      }
      db.exec(`CREATE TABLE IF NOT EXISTS run_pending_xp (
        run_id     INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        amount     INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, account_id),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )`);
      db.exec(`PRAGMA user_version = 7`);
    });
    migrate();
  }
}
```

Idempotent against the populated `server/hex-discovery.sqlite` (duplicate-column-guarded ALTER
+ `IF NOT EXISTS`, gated once by `user_version`). Fresh DBs flow v3→…→v7. Never edit the
shipped v3-v6 blocks. `run_pending_xp` needs no backfill: every existing row in `profiles.xp`
was banked under the old instant rules and stays put.

### 1.3 db.ts surface changes

- `RunOutcome` (430) moves to shared (§3.1) and gains `"retreat"`; db.ts re-imports it from
  `"shared"` (db.ts already imports shared types at line 5-6). `RunRow` gains
  `contract_json: string | null`.
- New prepared statements + functions:

```ts
// --- Contract snapshot (SSOT for crash recovery; AND active = 1 mirrors setRunPhase:
// a finalized run's contract is frozen). ---
const setRunContractStmt = db.prepare(
  "UPDATE runs SET contract_json = ?, updated_at = ? WHERE id = ? AND active = 1",
);
export function saveRunContract(runId: number, contract: ContractState): void {
  setRunContractStmt.run(JSON.stringify(contract), Date.now(), runId);
}

// --- Pending-XP ledger ---
const accruePendingXpStmt = db.prepare(
  `INSERT INTO run_pending_xp (run_id, account_id, amount, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(run_id, account_id) DO UPDATE SET
     amount = amount + excluded.amount, updated_at = excluded.updated_at`,
);
const pendingXpForRunStmt = db.prepare(
  "SELECT account_id, amount FROM run_pending_xp WHERE run_id = ?",
);
export interface PendingXpRow { account_id: string; amount: number }

/** Accrue provisional XP for one account on one run. Returns the new pending total. */
export function accruePendingXp(runId: number, accountId: string, amount: number): number {
  accruePendingXpStmt.run(runId, accountId, amount, Date.now());
  const row = db.prepare(
    "SELECT amount FROM run_pending_xp WHERE run_id = ? AND account_id = ?",
  ).get(runId, accountId) as { amount: number };
  return row.amount;
}
export function loadPendingXp(runId: number): PendingXpRow[] {
  return pendingXpForRunStmt.all(runId) as PendingXpRow[];
}

// --- Banking (inside finalizeRun; flag #6) ---
const bankXpStmt = db.prepare(
  "UPDATE profiles SET xp = xp + ?, updated_at = ? WHERE account_id = ?",
);
```

  (Prepare the single-row pending read once at module scope like every other statement; shown
  inline above for brevity.)
- `finalizeRun` (503) — same signature, same boolean return. Inside the existing transaction,
  after `changed = markRunInactiveStmt…` and inside `if (changed)`:

```ts
if (changed) {
  stampSeatsLeftStmt.run(now, runId);
  // Bank the pending-XP ledger with the outcome multiplier (locked decisions 6/7).
  // Rows are kept (audit + settlement pushes); the `changed` guard makes this once-ever.
  for (const row of pendingXpForRunStmt.all(runId) as PendingXpRow[]) {
    const banked = bankedXp(row.amount, outcome); // shared helper, §2.1
    if (banked > 0) bankXpStmt.run(banked, new Date().toISOString(), row.account_id);
  }
}
```

  (`profiles.updated_at` is ISO TEXT per the v6 schema — use `new Date().toISOString()`, not
  `now`.)
- `eraseClient` (540) — add `delPendingXpForRunStmt` (`DELETE FROM run_pending_xp WHERE
  run_id = ?`) to the per-run loop.
- `loadRun`/`RunRow` expose `contract_json`; nothing else in db.ts changes. The
  `deactivateStaleRuns` and `abandonPriorSeatForClient` paths get banking for free via
  `finalizeRun` (no pushes — no sockets exist there; profiles are simply correct on next
  fetch).

---

## 2. Shared modules

### 2.1 `shared/src/core/progression.ts` (edit)

```ts
import type { RunOutcome } from "../net/protocol.js";

/** Locked decisions 6/7 (+ flag #3 for abandoned): pending-XP bank multiplier by outcome. */
export const XP_BANK_MULTIPLIER: Readonly<Record<RunOutcome, number>> = {
  victory: 1,
  retreat: 0.5,
  defeat: 0.5,
  abandoned: 0.5,
};

/** The single banked-amount formula — used by db.finalizeRun AND the settlement pushes. */
export function bankedXp(pending: number, outcome: RunOutcome): number {
  return Math.floor(pending * XP_BANK_MULTIPLIER[outcome]);
}
```

`XP_ENCOUNTER_WIN = 25` is unchanged (it now feeds the ledger instead of profiles).

### 2.2 `shared/src/overworld/contracts.ts` (new; export from `shared/src/index.ts` after `movement-vote.js`)

Pure data + pure functions. The server evaluates and persists; the client resolves display
copy from the same catalog with zero fetches (TITLES precedent).

```ts
import type { HexCoord, HexIconType } from "../map/hex-map.js";
import { getHexIcon, hexKey, hexDistance } from "../map/hex-map.js";

export type ContractType = "slay-boss" | "recover-relic" | "activate-gateway" | "chart-hexes";

// --- Tunables ---
export const CHART_HEX_COUNT = 10;          // chart-hexes: hexes cleared this run (origin excluded)
export const CONTRACT_SCAN_MIN_RADIUS = 3;  // targets closer than this are too trivial
export const CONTRACT_SCAN_MAX_RADIUS = 14; // ~631 hexes; icons are deterministic so this is cheap

export interface ContractDef {
  readonly id: ContractType;
  readonly name: string;        // display, FONT.cinzel-sized copy
  readonly description: string;
  readonly xpReward: number;    // accrued to pending on completion, banked at 1.0 with victory
}

export const CONTRACTS: readonly ContractDef[] = [
  { id: "slay-boss",        name: "Slay the Tyrant",    description: "Defeat the dweller of a boss lair.",                xpReward: 150 },
  { id: "recover-relic",    name: "Recover the Relic",  description: "Win the marked great ruin or hoard.",               xpReward: 120 },
  { id: "activate-gateway", name: "Light the Gateway",  description: "Clear a gateway hex and kindle its portal.",        xpReward: 100 },
  { id: "chart-hexes",      name: "Chart the Wilds",    description: `Clear ${CHART_HEX_COUNT} hexes in a single expedition.`, xpReward: 80 },
];

export function contractById(id: ContractType): ContractDef {
  const c = CONTRACTS.find((c) => c.id === id);
  if (!c) throw new Error(`contractById: unknown contract "${id}"`);
  return c;
}

/** The run's live contract state — persisted verbatim (runs.contract_json) and sent on the wire. */
export interface ContractState {
  readonly type: ContractType;
  /** recover-relic: THE required hex. slay-boss/activate-gateway: nearest-match HUD hint. chart-hexes: null. */
  readonly targetHex: HexCoord | null;
  readonly progress: number;   // 0/1 for the three single-goal types; cleared count for chart-hexes
  readonly required: number;   // 1, or CHART_HEX_COUNT
  readonly completed: boolean;
}

export function createContractState(type: ContractType, targetHex: HexCoord | null): ContractState {
  if (type === "recover-relic" && targetHex === null) {
    throw new Error("recover-relic requires a target hex");
  }
  return {
    type,
    targetHex,
    progress: 0,
    required: type === "chart-hexes" ? CHART_HEX_COUNT : 1,
    completed: false,
  };
}

/** One cleared-hex step as the contract engine sees it (fed from the encounter-won run event). */
export interface ContractHexEvent {
  readonly hex: HexCoord;
  readonly icon: HexIconType | null;
  /** Hexes cleared this run so far, origins excluded — cumulative across dimension travel
   *  (room.runClearedCount; amended by 04-portals §4.1/§9, was room.visitedThisRun.size - 1). */
  readonly clearedCount: number;
}

const GATEWAY_ICONS: readonly HexIconType[] = ["gateway", "gateway-city"];

/** Pure progress step. Completed contracts are frozen (idempotent). */
export function applyContractEvent(state: ContractState, ev: ContractHexEvent): ContractState {
  if (state.completed) return state;
  switch (state.type) {
    case "slay-boss": {
      const done = ev.icon === "boss";
      return done ? { ...state, progress: 1, completed: true } : state;
    }
    case "recover-relic": {
      const t = state.targetHex!;
      const done = ev.hex.q === t.q && ev.hex.r === t.r;
      return done ? { ...state, progress: 1, completed: true } : state;
    }
    case "activate-gateway": {
      const done = ev.icon !== null && GATEWAY_ICONS.includes(ev.icon);
      return done ? { ...state, progress: 1, completed: true } : state;
    }
    case "chart-hexes": {
      const progress = Math.min(ev.clearedCount, state.required);
      return { ...state, progress, completed: progress >= state.required };
    }
  }
}

/** True iff the party may propose a retreat while standing on this hex (locked #6: a cleared
 *  gateway — party position is cleared by construction, so the icon test suffices). */
export function isRetreatHex(icon: HexIconType | null): boolean {
  return icon !== null && GATEWAY_ICONS.includes(icon);
}

/** Ring-scan for the nearest hex whose (deterministic or recorded) icon matches. Ties broken
 *  by scan order (deterministic: rings outward, fixed corner/edge walk). */
export function nearestHexWithIcon(
  icons: Record<string, HexIconType>,
  match: (icon: HexIconType) => boolean,
  opts: { minRadius?: number; maxRadius?: number } = {},
): HexCoord | null {
  const min = opts.minRadius ?? CONTRACT_SCAN_MIN_RADIUS;
  const max = opts.maxRadius ?? CONTRACT_SCAN_MAX_RADIUS;
  for (let radius = min; radius <= max; radius++) {
    for (const hex of hexRing(radius)) {          // standard axial ring walk, local helper
      const icon = getHexIcon(hex, icons);
      if (icon !== null && match(icon)) return hex;
    }
  }
  return null;
}

/** What the lobby board offers for a given map. chart-hexes is always available. */
export interface ContractOffer {
  readonly type: ContractType;
  readonly targetHex: HexCoord | null;
  readonly required: number;
}

export function buildContractOffers(icons: Record<string, HexIconType>): ContractOffer[] {
  const offers: ContractOffer[] = [];
  const boss = nearestHexWithIcon(icons, (i) => i === "boss");
  if (boss) offers.push({ type: "slay-boss", targetHex: boss, required: 1 });
  const relic = nearestHexWithIcon(icons, (i) => i === "great-ruins" || i === "great-treasure");
  if (relic) offers.push({ type: "recover-relic", targetHex: relic, required: 1 });
  const gate = nearestHexWithIcon(icons, (i) => GATEWAY_ICONS.includes(i));
  if (gate) offers.push({ type: "activate-gateway", targetHex: gate, required: 1 });
  offers.push({ type: "chart-hexes", targetHex: null, required: CHART_HEX_COUNT });
  return offers;
}

export const DEFAULT_CONTRACT_TYPE: ContractType = "chart-hexes";
```

Implementation notes: `hexRing(radius)` is a file-local generator (start at
`{q: -radius, r: 0}` — any fixed corner — walk the six edge directions `radius` steps each);
determinism is what lets offer-send and choose-validation agree (flag #12). The scan runs over
`room.hexMap.icons` (community-recorded overrides) + `pickIconForHex` fallback via
`getHexIcon`, so a target may be an *undiscovered* hex — that is the point (a quest into the
fog), and the HUD shows its coordinates as a bearing, not a map reveal.

### 2.3 `shared/src/map/hex-map.ts` (edit)

Add the missing axial distance (used by tests and, later, feature 4/5 scaling):

```ts
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
```

### 2.4 `shared/src/core/titles.ts` (edit)

One new seed (the boot-time `seedTitles()` upsert propagates it to existing DBs, 01 §1.3):

```ts
  { id: "sealbearer", name: "Sealbearer", description: "Fulfill your first contract.",
    sortOrder: 6, requirement: { stat: "contracts_completed", gte: 1 } },
```

---

## 3. Wire protocol (shared/src/net/protocol.ts)

`PROTOCOL_VERSION` bumps **3 → 4**.

### 3.1 New/changed DTOs

```ts
/** Durable run outcome — the value set of runs.outcome (db.ts re-imports this). */
export type RunOutcome = "victory" | "defeat" | "retreat" | "abandoned";

export type VoteKind = "move" | "retreat";

// VoteStatePayload (166) generalizes; `kind` discriminates, `target` is move-only:
export interface VoteStatePayload {
  readonly proposalId: string;
  readonly kind: VoteKind;
  readonly proposerSeatId: SeatId;
  readonly target: HexCoord | null;   // was required; null for retreat votes
  readonly votes: Partial<Record<SeatId, VoteChoice>>;
  readonly electorate: readonly SeatId[];
  readonly deadlineMs: number;
}

// RoomStatePayload (51) gains two fields (both null pre-feature semantics preserved):
export interface RoomStatePayload {
  // ...existing fields unchanged...
  /** The run's contract; null only for legacy pre-v7 runs and not-yet-assigned lobbies. */
  readonly contract: ContractState | null;   // import from ../overworld/contracts.js
  /** Set iff phase === "gameover" — drives the outcome-variant end screen on reconnect too. */
  readonly outcome: RunOutcome | null;
}

// AccountStatsPayload (105) gains:
  readonly contractsCompleted: number;
```

### 3.2 ClientMessage additions (union at 206)

```ts
  // Host-gated, lobby-only: pick the run's contract from the offer board.
  | { type: "chooseContract"; contractType: ContractType }
  // Seat-scoped, overworld-only, party standing on a gateway hex: open a retreat vote.
  | { type: "proposeRetreat" }
```

(`castVote` is reused unchanged for retreat ballots — one open vote per room, matched by
`proposalId`.)

### 3.3 ServerMessage additions/changes (union at 250)

```ts
  // Lobby offer board: sent to each seat landing in a lobby-phase room; re-sent only when the
  // lobby's dimension changes (04-portals chooseDimension) — offers are static per dimension
  // map (flag #12).
  | { type: "contractOffers"; offers: readonly ContractOffer[] }

  // gameOver (282) gains retreat ("abandoned" never reaches a broadcast — those rooms dissolve):
  | { type: "gameOver"; outcome: "victory" | "defeat" | "retreat" }

  // xpAward (291) RESHAPES — provisional accrual push (PRIVATE per-seat, as today):
  | { type: "xpAward"; amount: number; pending: number }

  // NEW — run-end settlement push (PRIVATE per-seat): what banked, with the new profile totals.
  | { type: "xpBanked"; pending: number; multiplier: number; banked: number;
      xp: number; level: number; leveledUp: boolean }
```

`ErrorCode` is unchanged: `chooseContract` failures reuse `NOT_HOST` / `BAD_PHASE` /
`INVALID_INPUT` (unknown or unavailable type); `proposeRetreat` failures reuse `BAD_PHASE` /
`NOT_YOUR_SEAT` / `INVALID_MOVE` (message "The party must stand on a cleared gateway to
retreat").

All new sends go through `io`/`sendTo` (envelope `seq` discipline, 01 §3.4). `xpAward`,
`xpBanked`, `titlesEarned`, `profile` remain per-seat private sends.

---

## 4. Server flows

### 4.1 `server/src/run-events.ts` (new) — the run-event bus

Room-scoped sibling of `shared/src/combat/reaction-bus.ts`: typed events, synchronous
dispatch, fail-loud (a throwing recorder propagates to the ws `message()` try/catch — never
swallowed). Handlers are *recorders*: they accrue/persist/push but MUST NOT change
`room.phase`, call `finalizeRun`, touch `room.vote`/`room.session`, or await (R7 discipline).
The machine reads state (e.g. `room.contract.completed`) after emitting and owns every
transition.

```ts
import type { HexCoord, HexIconType, RunOutcome, ContractState } from "shared";
import type { Room } from "./room.js";
import type { RoomIO } from "./room-machine.js";

export type RunEvent =
  | { type: "run-started"; runId: number; dimensionId: number }
  | { type: "encounter-won"; runId: number; hex: HexCoord; icon: HexIconType | null;
      firstEver: boolean; clearedCount: number }
  | { type: "hex-entered"; runId: number; hex: HexCoord; icon: HexIconType | null }
  /** THE banking hook (feature 3 seam): emitted exactly once per run, immediately after
   *  finalizeRun returns true, before the gameOver broadcast. runId is explicit because
   *  resetToOrigin re-keys room.runId right after emitting for the OLD run. */
  | { type: "run-ended"; runId: number; outcome: RunOutcome; contract: ContractState | null };

export type RunEventHandler<T extends RunEvent["type"] = RunEvent["type"]> = (
  room: Room, io: RoomIO, event: Extract<RunEvent, { type: T }>,
) => void;

export interface RunEventRegistration { readonly type: RunEvent["type"]; readonly handler: RunEventHandler }

export function on<T extends RunEvent["type"]>(type: T, handler: RunEventHandler<T>): RunEventRegistration {
  return { type, handler: handler as unknown as RunEventHandler };
}

// Static registry — THE integration point for features 3-5 (loot drops, codex banking,
// travel, rest nodes register here instead of inline-editing room-machine.ts).
// Order within an event type is execution order and is load-bearing (§4.3).
import { recordRunStarted, recordEncounterWon, recordRunSettled } from "./run-recorders.js";
import { contractProgressRecorder } from "./contract-engine.js";

const REGISTRY: readonly RunEventRegistration[] = [
  on("run-started", recordRunStarted),
  on("encounter-won", recordEncounterWon),      // 1) XP accrual + stats/titles
  on("encounter-won", contractProgressRecorder), // 2) contract progress (reads post-accrual world)
  on("run-ended", recordRunSettled),             // XP banking pushes; feature 3 appends codex banking
];

const HANDLERS: ReadonlyMap<RunEvent["type"], readonly RunEventHandler[]> = buildMap(REGISTRY);

export function emitRunEvent(room: Room, io: RoomIO, event: RunEvent): void {
  const handlers = HANDLERS.get(event.type);
  if (!handlers) return;
  for (const h of handlers) h(room, io, event);
}
```

(`buildMap` mirrors `createReactionBus`.) No dynamic install/uninstall — YAGNI, and the static
list makes "who runs on what" greppable.

### 4.2 `server/src/run-recorders.ts` (rework of awards.ts)

`awards.ts` is renamed/refactored into `run-recorders.ts` (its three exports become bus
handlers; `eligibleSeats` and `refreshCardProfile` carry over verbatim). Old direct call sites
in room-machine.ts/index.ts are deleted in favor of emits (§4.3-4.5).

```ts
/** run-started (was recordDimensionsSeen, awards.ts:68): unchanged writes. */
export function recordRunStarted(room: Room, io: RoomIO, ev: Extract<RunEvent, {type:"run-started"}>): void
  // per eligible seat: recordDimensionSeen(accountId, ev.dimensionId); evaluateTitles;
  // titlesEarned/profile pushes exactly as today.

/** encounter-won (was awardEncounterWin, awards.ts:34) — THE awards.ts change (flag #5): */
export function recordEncounterWon(room: Room, io: RoomIO, ev: Extract<RunEvent, {type:"encounter-won"}>): void {
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    const pending = accruePendingXp(ev.runId, accountId, XP_ENCOUNTER_WIN); // was awardXp(...)
    bumpStat(accountId, "encounters_won", 1);
    bumpStat(accountId, "hexes_charted", 1);
    const newTitles = evaluateTitles(accountId);
    refreshCardProfile(seat, accountId);
    io.send(seat, { type: "xpAward", amount: XP_ENCOUNTER_WIN, pending });
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

/** run-ended: settlement pushes (banking itself already happened inside finalizeRun). */
export function recordRunSettled(room: Room, io: RoomIO, ev: Extract<RunEvent, {type:"run-ended"}>): void {
  const rows = loadPendingXp(ev.runId);                       // rows survive banking (§1.1)
  const byAccount = new Map(rows.map((r) => [r.account_id, r.amount]));
  for (const seat of eligibleSeats(room)) {
    const accountId = seat.accountId!;
    if (ev.outcome === "defeat") bumpStat(accountId, "wipes", 1);          // was recordWipe
    if (ev.outcome === "victory") bumpStat(accountId, "contracts_completed", 1);
    const pending = byAccount.get(accountId) ?? 0;
    const banked = bankedXp(pending, ev.outcome);              // same shared formula as db.ts
    const profile = loadProfilePayload(accountId);             // post-banking totals
    const before = profile.xp - banked;
    io.send(seat, {
      type: "xpBanked", pending, multiplier: XP_BANK_MULTIPLIER[ev.outcome], banked,
      xp: profile.xp, level: profile.level,
      leveledUp: profile.level > levelForXp(before),
    });
    const newTitles = evaluateTitles(accountId);               // banking/contract stat may level/earn
    refreshCardProfile(seat, accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}
```

`accounts.ts` — add `contractsCompleted` to `loadProfilePayload`'s stats mapping (from
`getStats`'s open key set — no schema change; `account_stats` is key/value by design).
`awardXp` remains (accounts primitive + unit tests) with a doc comment noting src callers now
go through the ledger.

### 4.3 `server/src/contract-engine.ts` (new)

```ts
/** encounter-won subscriber #2: advance + persist contract progress. Pure recorder — the
 *  machine (endCombat) reads room.contract.completed after the emit and owns the transition. */
export function contractProgressRecorder(room: Room, io: RoomIO,
    ev: Extract<RunEvent, {type:"encounter-won"}>): void {
  if (!room.contract || room.contract.completed) return;
  const next = applyContractEvent(room.contract, { hex: ev.hex, icon: ev.icon, clearedCount: ev.clearedCount });
  if (next === room.contract) return;
  room.contract = next;
  saveRunContract(ev.runId, next);   // synchronous, tiny — same discipline as commitExplore adjacency
}

/** Assign + persist a contract on a run (chooseContract, startGame default, resetToOrigin). */
export function assignContract(room: Room, type: ContractType): void {
  const offers = buildContractOffers(room.hexMap.icons);
  const offer = offers.find((o) => o.type === type);
  if (!offer) throw new AccountError("INVALID_INPUT", "That contract is not available here");
  room.contract = createContractState(offer.type, offer.targetHex);
  saveRunContract(room.runId, room.contract);
}
```

(If reusing `AccountError` from accounts.ts feels off-domain, a local `ContractError` with the
same `{code, message}` shape is fine — the routeMessage error funnel only needs the code.)

Registration order (flag in §4.1): the XP recorder runs BEFORE the contract recorder so that
when the machine sees `completed` and settles victory, the just-won encounter's 25 XP is
already in the ledger and banks at 1.0.

### 4.4 room-machine.ts changes

**`Room` (room.ts:110) gains** `contract: ContractState | null` and `outcome: RunOutcome |
null` (both init `null` at the two construction sites: index.ts:387 literal and
`reconstructRoomForRun`'s literal at 1470 — the latter rehydrates
`contract: runRow.contract_json ? JSON.parse(runRow.contract_json) : null`). `MovementVote`
(room.ts:100) becomes:

```ts
interface RoomVoteBase {
  readonly proposalId: string;
  readonly proposerSeatId: SeatId;
  readonly electorate: SeatId[];
  ballots: Map<SeatId, "yes" | "no">;
  deadline: number;
  timer: Timer | null;
}
export type RoomVote =
  | (RoomVoteBase & { readonly kind: "move"; readonly target: HexCoord })
  | (RoomVoteBase & { readonly kind: "retreat" });
```

`room.vote: RoomVote | null`. One open vote per room, as today.

**`roomStatePayload` (128)** adds `contract: room.contract` and `outcome: room.outcome` —
reconnects into any phase (incl. gameover) get contract + outcome for free via
`sendSeatSnapshots`' existing roomState send.

**`endCombat` (1070) win branch** (replaces lines 1085-1097):

```ts
if (won && room.pendingHex) {
  const clearedHex = room.pendingHex;
  const icon = getHexIcon(clearedHex, room.hexMap.icons);   // BEFORE exploreHex is fine; icons are stable
  const firstEver = exploreHex(room, clearedHex);
  room.pendingHex = null;

  emitRunEvent(room, io, {
    type: "encounter-won", runId: room.runId, hex: clearedHex, icon, firstEver,
    clearedCount: room.runClearedCount,                      // origins excluded; cumulative across travel (04-portals §9)
  });

  if (room.contract?.completed) {
    settleRun(room, io, "victory");                          // §4.5 — short-circuit to gameover
    return;
  }
  room.phase = "overworld";
  setRunPhase(room.runId, "overworld");
  broadcastRoomState(room, io);                              // now carries contract progress
  broadcastHexMapState(room, io);
  if (firstEver) io.broadcast(room, { type: "hexDiscovered", coord: clearedHex });
} else {
  room.pendingHex = null;
  settleRun(room, io, "defeat");                             // replaces the inline defeat block
}
```

**New `settleRun(room, io, outcome: "victory" | "defeat" | "retreat")`** — the single in-room
run-end path (finalize + hook + broadcasts). `resetToOrigin`/abandon stay separate (they
continue the room on a fresh run; see below).

```ts
export function settleRun(room: Room, io: RoomIO, outcome: "victory" | "defeat" | "retreat"): void {
  if (outcome === "victory") {
    // Contract reward accrues to pending BEFORE finalize so it banks at the victory multiplier.
    const reward = contractById(room.contract!.type).xpReward;
    for (const seat of eligibleSeats(room)) accruePendingXp(room.runId, seat.accountId!, reward);
  }
  if (room.vote) cancelVote(room, io);                       // an open vote cannot outlive the run
  room.phase = "gameover";
  room.outcome = outcome;
  const changed = finalizeRun(room.runId, outcome);          // banks the ledger atomically (§1.3)
  // First-writer-wins discipline: the run-ended hook and its pushes fire only on the one real
  // transition (a lost race means another path already settled and emitted).
  if (changed) {
    emitRunEvent(room, io, { type: "run-ended", runId: room.runId, outcome, contract: room.contract });
  }
  broadcastRoomState(room, io);                              // phase gameover + outcome + contract
  io.broadcast(room, { type: "gameOver", outcome });
}
```

(`eligibleSeats` moves to run-recorders.ts and is exported; room-machine imports it — or
duplicate the 3-line filter locally; either is fine, pick the import.)

The old defeat block's `recordWipe` call is subsumed by `recordRunSettled` (wipes stat now
bumps inside the run-ended recorder). Delete the `awardEncounterWin`/`recordWipe` imports.

**`resetToOrigin` (1135)** — two edits:

```ts
const oldRunId = room.runId;
const oldContract = room.contract;
const changed = finalizeRun(oldRunId, outcome);              // existing call, now capture the bool
if (changed) {
  emitRunEvent(room, io, { type: "run-ended", runId: oldRunId, outcome, contract: oldContract });
}
// ...existing new-run setup (startNewRun, rekey, hexMap reseed)...
room.outcome = null;
assignContract(room, DEFAULT_CONTRACT_TYPE);                 // flag #2: no lobby on this path
```

(`outcome` param of `resetToOrigin` widens from `"defeat" | "abandoned"` to also accept — no
new callers; the signature can stay as-is.)

**`finalizeMove` (968)** — the pure-move branch emits `hex-entered` after the durable write:

```ts
room.hexMap = { ...room.hexMap, playerPos: target };
updateRunPartyPos(room.runId, target);
emitRunEvent(room, io, { type: "hex-entered", runId: room.runId, hex: target,
  icon: getHexIcon(target, room.hexMap.icons) });
broadcastHexMapState(room, io);
```

No v2 subscriber — the event exists because features 4 (gateway arrival) and 5 (rest nodes)
subscribe to it; it is exercised by the wire-visible... it is NOT wire-visible; it is exercised
by a unit test (§8) so it cannot rot.

**Retreat vote** — generalize the existing vote block (872-992) rather than duplicating it:

- `proposeMove` builds `{ kind: "move", target, ... }`; new `proposeRetreat(room, io, seat)`:
  - guards: `room.phase === "overworld"` else `BAD_PHASE`; `!room.vote` else `BAD_PHASE`
    ("A vote is already open"); `seat.state === "human-connected"` else `NOT_YOUR_SEAT`;
    `isRetreatHex(getHexIcon(room.hexMap.playerPos, room.hexMap.icons))` else `INVALID_MOVE`
    ("The party must stand on a cleared gateway to retreat").
  - single connected human → instant `settleRun(room, io, "retreat")` (movement-vote
    precedent: broadcast `voteState: null` first). Otherwise open `{ kind: "retreat", ... }`
    with the same `VOTE_TIMEOUT_MS`, proposer auto-yes, `voteState` broadcast (now carrying
    `kind`/`target: null`).
- `castVote` (918) unchanged (operates on `room.vote` generically).
- `resolveMovementVote` (941) renames to `resolveOpenVote`; the decided branch dispatches:

```ts
if (vote.kind === "move") {
  if (resolution.accepted) finalizeMove(room, io, proposalId, vote.target, true);
  else io.broadcast(room, { type: "moveResolved", proposalId, accepted: false, target: vote.target });
} else {
  // voteState:null (already broadcast above) hides the panel + re-enables map input (flag #9).
  if (resolution.accepted) settleRun(room, io, "retreat");
}
```

- `cancelVote` (984): the `moveResolved` broadcast becomes move-only (`if (vote.kind ===
  "move")`); the `voteState: null` broadcast stays unconditional.
- `voteStatePayload` (855) emits `kind` and `target: vote.kind === "move" ? vote.target : null`.

### 4.5 index.ts changes

- `routeMessage` seat-gated switch: add

```ts
case "chooseContract":
  return handleChooseContract(room, seat, ws, msg.contractType);
case "proposeRetreat":
  return proposeRetreat(room, io, seat);
```

- `handleChooseContract(room, seat, ws, contractType)` (host-gated block, next to
  `handleStartGame`): `NOT_HOST` unless `isHost`; `BAD_PHASE` unless `room.phase === "lobby"`;
  `assignContract(room, contractType)` (throws `INVALID_INPUT` for unknown/unavailable — the
  routeMessage AccountError funnel already converts thrown `{code}` errors to `sendError`;
  verify the funnel catches this path, else try/catch locally); then `broadcastRoomState(room,
  io)` (selection is on `roomState.contract`).
- `handleStartGame` (596): after bot-fill, replace the direct `recordDimensionsSeen(room, io)`
  call with `emitRunEvent(room, io, { type: "run-started", runId: room.runId, dimensionId:
  room.dimensionId })`, and before `room.phase = "overworld"` add the exactly-one-contract
  invariant (flag #2):

```ts
if (!room.contract) assignContract(room, DEFAULT_CONTRACT_TYPE);
```

- `sendSeatSnapshots` (244): after the roomState send add

```ts
if (room.phase === "lobby") {
  io.send(seat, { type: "contractOffers", offers: buildContractOffers(room.hexMap.icons) });
}
```

  and `createRoomFor` (after `broadcastRoomState` at 439) sends the same to the host socket
  (the host lands in the lobby without passing through sendSeatSnapshots).
- `handleDebugWin`/`handleDebugLose`: unchanged (they flow through endCombat and now exercise
  contracts/banking — flag #13).

### 4.6 Crash / reconnect / sweep behavior

- `reconstructRoomForRun` (1399): rehydrate `contract` from `runRow.contract_json` (verbatim
  JSON.parse; `null` stays null — flag #11), `outcome: null` (only active runs are
  reconstructed). Progress is consistent by construction: `contract_json` is written in the
  same synchronous block as `commitExplore`'s durable clear, so the snapshot can lag the
  cleared set by at most zero committed encounters.
- `recoverActiveRuns` (1514): the lobby-crash `finalizeRun(runId, "abandoned")` now banks
  whatever pending exists (a lobby run has none — harmless and uniform).
- Hourly sweep + `abandonPriorSeatForClient`: banking happens inside `finalizeRun` (flag #6);
  no Room, no pushes — profiles are simply correct next time the player looks.
- Reconnect into a gameover room: `roomState.outcome` + `contract` render the right end screen
  (flag #8). The private `xpBanked` push is NOT replayed (it fired at settle time); the screen
  degrades to omitting the personal banked line (§6.4).

---

## 5. Tunable constants (single table)

| Constant | Value | Lives in |
|---|---|---|
| `XP_ENCOUNTER_WIN` | 25 (unchanged) | shared/core/progression.ts |
| `XP_BANK_MULTIPLIER` | victory 1.0 / retreat 0.5 / defeat 0.5 / abandoned 0.5 | shared/core/progression.ts |
| `CONTRACTS[*].xpReward` | slay-boss 150 / recover-relic 120 / activate-gateway 100 / chart-hexes 80 | shared/overworld/contracts.ts |
| `CHART_HEX_COUNT` | 10 | shared/overworld/contracts.ts |
| `CONTRACT_SCAN_MIN_RADIUS` | 3 | shared/overworld/contracts.ts |
| `CONTRACT_SCAN_MAX_RADIUS` | 14 | shared/overworld/contracts.ts |
| `DEFAULT_CONTRACT_TYPE` | "chart-hexes" | shared/overworld/contracts.ts |
| Retreat vote timeout | `VOTE_TIMEOUT_MS` (15s, reused) | server/room-machine.ts |

---

## 6. Client

### 6.1 ui-kit.ts (edits, THEME tokens only — no new colors)

- `boardBackdrop` scene union gains `"victory"`: `MAP_SCENE.victory =
  "/sprites/maps/dimension-0/gateway-city-0.png"`; tint branch mirrors the gameover red with
  gold — `scene === "victory" ? ", rgba(64,48,10,.26)" : ""` (a warm `THEME.goldDeep`-family
  wash) alongside the existing red mix for `"gameover"`.
- New `progressBar(pct, opts?)` — generalization of `xpBar` (6px track `rgba(11,9,6,0.5)`,
  `THEME.gold → THEME.goldDeep` gradient fill) used by the contract HUD; keep `xpBar` as-is or
  have it delegate.

### 6.2 `client/src/renderer/contract-hud.ts` (new floating HUD)

VotePanel/PartyHud precedent: constructed ONCE in main.ts (alongside line 350), fixed
top-right under the Leave button (`top: 52px; right: 10px; z-index: 110`), width 240px,
`background: rgba(17,13,9,0.85)`, `1px solid ${THEME.goldLine}`, radius 8, padding 10px 14px.
Subscribes to SeatContext; visible iff `seat.room?.phase === "overworld" &&
seat.room.contract`. Contents:

- `eyebrow("Contract")`-styled label (`font: 700 10px ${FONT.cinzel}; letter-spacing: .14em;
  color: ${THEME.goldDeep}`), then the contract name (`font: 700 15px ${FONT.cinzel}; color:
  ${THEME.gold}`) resolved via shared `contractById(contract.type).name`.
- Progress line (`13px ${FONT.body}; color: ${THEME.parch}`):
  - chart-hexes: `Cleared ${progress}/${required}` + `progressBar(progress/required)`.
  - others: the def's description plus a bearing when `targetHex` is set — `Target: (q, r) —
    ${hexDistance(playerPos, targetHex)} hexes` (`12px; color: ${THEME.muted}`), fed by the
    `getHexMapState` getter passed from main.ts.
  - completed: `✓ Fulfilled` in `THEME.green` (only ever visible for one broadcast frame —
    victory settles immediately — but correct on any race).
- Retreat affordance: a full-width ghost `btn("Retreat…", "secondary")` (danger-tinted border:
  `border-color: ${THEME.dangerDeep}; color: ${THEME.danger}`) rendered iff
  `isRetreatHex(getHexIcon(playerPos, hexMap.icons))` (shared import). Click sends
  `{ type: "proposeRetreat" }`. Sub-caption under it (`11px; color: ${THEME.faint}`):
  `Banks 50% of pending XP · forfeits the contract`.
- Pending-XP chip at the bottom (`12px; color: ${THEME.muted}`): `Pending: ${pending} XP`,
  fed by a tiny `RunXpStore` (§6.5).

Re-renders in place on SeatContext notify and on `hexMapState` (main.ts calls a
`hud.setHexMap(state)` setter from its existing `conn.on("hexMapState")` handler).

### 6.3 `client/src/renderer/vote-panel.ts` (generalize, keep single class)

- Title derives from `vote.kind`: `"Move proposed"` / `"Retreat proposed"`; for retreat add a
  second line (`12px; color:#8a7a68`): `End the run at this gateway — bank 50% of pending XP`.
- Everything else (tally over `electorate`, countdown, yes/no buttons, `castVote` send) is
  already kind-agnostic. It continues to clear on `voteState: null` and `moveResolved`.

### 6.4 `client/src/screens/game-over-screen.ts` (outcome variants)

Constructor becomes `new GameOverScreen(conn, seat, getLastBank)` (main.ts:362 updated);
`render()` moves from the constructor into `enter()` (re-render per showing), switching on
`seat.room?.outcome ?? "defeat"`:

| | victory | retreat | defeat (existing, unchanged) |
|---|---|---|---|
| backdrop | `boardBackdrop("victory")` | `boardBackdrop("gameover")` | `boardBackdrop("gameover")` |
| eyebrow | `Victory` | `Withdrawal` | `Defeat` |
| heading (44px hero) | `Contract Fulfilled` | `The Party Withdraws` | `Your Warband Has Fallen` |
| hero art | existing `char1/sword-idle.webp` UNfiltered, gold glow: `drop-shadow(0 0 22px rgba(232,200,122,0.45))`, warm ember ellipse recolored `rgba(232,200,122,0.4)` | existing silhouette at `grayscale(0.5) brightness(0.75)` (dimmed, not dead) | existing desaturated ember silhouette |
| copy (15.5px, THEME.muted) | `The ${contractById(type).name} contract is fulfilled. Your deeds — and your designs — are entered into the codex.` (codex line future-proofs feature 3) | `You slip back through the gateway. Half a victory is still a march home.` | existing |
| contract line | `✓ ${name}` in `THEME.green`, 14px | `✗ ${name} — forfeit` in `THEME.danger` (only when contract non-null) | omitted |
| XP line | from `getLastBank()`: `Banked ${banked} XP` (+ ` — Level up!` when `leveledUp`), `14px; color: ${THEME.gold}`; omitted when null (reconnect, guest-less seat) | same (shows the 50% multiplier: `Banked ${banked} of ${pending} pending XP`) | same 50% line |
| actions | Play Again (primary) / Return Home (secondary) — unchanged all three | | |

### 6.5 main.ts wiring (composition root)

- `let lastBank: XpBankedMsg | null = null;` — `conn.on("xpBanked", (msg) => { lastBank = msg;
  pushToast(msg.leveledUp ? `Banked ${msg.banked} XP — Level up! Now LV ${msg.level}` :
  `Banked ${msg.banked} XP`); })`; cleared on `leftRoom` and whenever
  `roomState.phase === "overworld"` (fresh run via play-again/reset). Pass `() => lastBank`
  to GameOverScreen.
- `xpAward` toast handler (211) updates to the new shape: `pushToast(`+${msg.amount} XP —
  ${msg.pending} pending`)`.
- A tiny `RunXpStore` (or just a `{ pending }` holder + callback) updated from the same
  `xpAward`/`xpBanked` handlers feeds the ContractHud pending chip; reset on run change (same
  triggers as `lastBank`).
- Construct `new ContractHud(conn, seat, () => hexMapState)` next to VotePanel (350); call
  `contractHud.setHexMap(msg.hexMap)` inside the existing `conn.on("hexMapState")` (376).
- No `switchForPhase` changes — `gameover` already routes to GameOverScreen for all outcomes.

### 6.6 `client/src/screens/lobby-screen.ts` (contract board)

- Constructor subscribes `conn.on("contractOffers", (msg) => { this.offers = msg.offers;
  this.render(); })` (offers arrive once per seat-landing; stored on the screen).
- New full-width section between `body(room)` and `footer(room)`: `rule()` inside the 44px
  padding gutter, then a row — `heading("Contract", "section")` + hint text (`13px;
  color: ${THEME.faint}`): host sees `Choose the party's contract`, others `The host chooses
  the contract`.
- Offer cards in a horizontal flex row (gap `THEME.gap`): each a mini-panel (`flex:1;
  border:1px solid ${THEME.goldLine}; border-radius:10px; background:rgba(11,9,6,0.45);
  padding:14px 16px`) with the contract name (`700 14px ${FONT.cinzel}; color:${THEME.gold}`),
  description (`12px; color:${THEME.muted}`), and a reward chip (`+${xpReward} XP` — `11px;
  color:${THEME.goldDeep}`). recover-relic/slay-boss/activate-gateway cards append the target
  bearing `(q, r)` in `THEME.faint`.
- Selection = `room.contract?.type`: selected card gets `border-color:${THEME.gold};
  box-shadow:0 0 14px -6px ${THEME.gold}` + a `Chosen` badge (presetPlate's selected-badge
  styling). Host cards are `cursor:pointer` and click sends `{ type: "chooseContract",
  contractType }`; non-host cards are inert. No selection yet → a `Default: Chart the Wilds`
  note under the row (`11px; color:${THEME.faint}`) so flag #2 is visible, not surprising.
- LobbyScreen re-renders wholesale per notify (existing discipline); the board has no inputs,
  so no focus concerns.

---

## 7. Migration / compat behavior for existing data

1. DB v6 → v7 on first boot (idempotent; §1.2). No data backfill.
2. Historical finalized runs: `contract_json` NULL, no ledger rows — untouched semantics.
3. In-flight (active) runs at deploy: reconstructed with `contract: null` (flag #11) — no
   victory path, HUD hidden, retreat available, wipe/abandon bank a 0-or-later ledger.
   Players lose nothing (pre-deploy XP already on profiles).
4. Protocol 3 clients get `protocolMismatch` + refresh banner (existing UX).
5. `xpAward` shape change is inside the same protocol bump — no dual-shape handling.
6. `runs.outcome` gains the `"retreat"` string value — TEXT column, no DDL; any external
   readers of `runs.outcome` (none in src beyond RunRow consumers) must accept it.
7. Existing test suites: `db-migration-idempotency.test.ts` updated 6 → 7 (+ v7 spot-checks);
   coop-integration XP assertions updated from instant-award (`xpAward{xp,level}` /
   `getProfile` xp+25 after one win) to pending semantics (profile xp unchanged mid-run;
   `xpAward{pending}`; banked at settle). The 01-accounts regression clause holds otherwise:
   HMAC reclaim, force-takeover, crash-recovery assertions unchanged.

---

## 8. Test plan (`bun test` from repo root; typecheck via `bun run typecheck`)

Patterns honored: unit DB tests set `GAME_DB_PATH=":memory:"` + `GAME_SKIP_SEED=1` before a
dynamic import (db.test.ts precedent); integration uses `coop-harness.ts`. room-machine is
transport-pure (RoomIO-injected), so run-outcome flows also get direct machine-level tests
with a stub io — no harness needed for vote/settle logic.

**shared/src/__tests__/contracts.test.ts** (new)
- `applyContractEvent`: slay-boss completes only on icon "boss"; recover-relic only on the
  exact target hex (near-miss adjacent hex does not); activate-gateway on "gateway" AND
  "gateway-city"; chart-hexes progress tracks clearedCount, clamps at required, completes at
  `CHART_HEX_COUNT`; completed states are frozen (further events return the same object).
- `createContractState` throws on recover-relic without target; required values per type.
- `nearestHexWithIcon`: deterministic (same inputs → same hex, twice); respects
  minRadius (plant a matching icon override at radius 2 → not chosen); community `icons`
  overrides beat `pickIconForHex`; returns null when nothing within maxRadius (match on a
  never-occurring predicate).
- `buildContractOffers`: chart-hexes always present; other offers present iff a target exists.
- `isRetreatHex` truth table; `contractById` throws on unknown id.
- `hexDistance` known values + symmetry.
- progression: `bankedXp` — floor behavior (25 → 12 at 0.5), 1.0 identity, all four outcomes
  covered via `XP_BANK_MULTIPLIER` keys.

**server/src/__tests__/db.test.ts additions** (or a new pending-xp.test.ts)
- `accruePendingXp` upsert math (two accruals sum; distinct accounts separate; returns
  running total); `loadPendingXp` rows.
- `finalizeRun("victory")` banks 100% into `profiles.xp`; `"defeat"`/`"retreat"`/`"abandoned"`
  bank `floor(0.5x)`; ledger rows survive banking; second `finalizeRun` returns false and
  does NOT re-bank (profile xp unchanged) — the load-bearing idempotency proof.
- `saveRunContract` roundtrip via `loadRun().contract_json`; no-op on a finalized run
  (`AND active = 1`).
- `eraseClient` removes `run_pending_xp` rows for the client's runs.

**server/src/__tests__/db-migration-idempotency.test.ts** (edit)
- Expectation moves to `user_version === 7`; spot-check `run_pending_xp` table +
  `runs.contract_json` column exist after both subprocess rounds.

**server/src/__tests__/run-outcomes.test.ts** (new, machine-level with stub RoomIO)
- Build a Room literal (createOpenSeats + fabricated run via startNewRun) with a recording
  `RoomIO { send/broadcast push to arrays }`.
- Victory: assign chart-hexes with required 1 (or drive `CHART_HEX_COUNT` exploreHex/emit
  cycles), emit encounter-won via a stubbed endCombat path or call the recorders directly,
  then `settleRun(..., "victory")`: asserts run finalized with outcome victory, contract XP
  accrued pre-bank, `run-ended` emitted once, `gameOver{victory}` + roomState
  `{phase:"gameover", outcome:"victory"}` broadcast, private xpBanked math (pending includes
  reward, multiplier 1).
- Retreat vote: `proposeRetreat` rejected off-gateway (`INVALID_MOVE` error to seat) and
  during combat (`BAD_PHASE`); with `room.hexMap.icons[playerPosKey] = "gateway"` and two
  connected humans — propose → voteState `{kind:"retreat", target:null}` broadcast → second
  seat `castVote yes` → run finalized `"retreat"`, banked at 0.5; a `no` majority → voteState
  null, run still active, phase overworld.
- Single-human retreat resolves instantly (no vote opened).
- `cancelVote` on a retreat vote broadcasts voteState null and NO moveResolved.
- Contract recorder ordering: after an encounter-won emit that completes the contract, the
  ledger already contains that encounter's XP (registry-order proof).
- run-ended emit is gated on finalize (`settleRun` after a pre-finalized run emits nothing).
- `hex-entered`: the registry is static, so assert emission indirectly — construct the
  `RunEvent` union member in the test (type-level shape lock) and assert `finalizeMove` onto a
  visited hex still performs its durable write + broadcasts with `emitRunEvent` in the path
  (a throwing icon lookup would surface). Do NOT add a production spy seam solely for this;
  feature 4's first subscriber becomes its real behavioral test.

**server/src/__tests__/coop-integration.test.ts additions** (harness, end-to-end)
- Lobby: joiner receives `contractOffers` (chart-hexes always present); non-host
  `chooseContract` → `NOT_HOST`; host `chooseContract{"chart-hexes"}` → roomState.contract on
  BOTH sockets; startGame without a pick → roomState.contract defaults to chart-hexes.
- Pending XP end-to-end: start → move → debugWin → private `xpAward{amount:25, pending:25}`;
  `getProfile` xp UNCHANGED (the reconciliation proof); debugLose on a later run →
  `xpBanked{multiplier:0.5}` + profile xp increased by `floor(pending/2)` + wipes stat bump.
- Victory end-to-end: host picks chart-hexes; drive `CHART_HEX_COUNT` debugWins; final win →
  `gameOver{outcome:"victory"}`, roomState `{phase:"gameover", outcome:"victory",
  contract.completed:true}`, `xpBanked{multiplier:1}` where banked = 10 wins × 25 + 80 reward,
  `contracts_completed` stat = 1 and `titlesEarned ["sealbearer"]`, profile level reflects
  banked XP.
- Reconnect into gameover: fresh socket + reclaim → roomState carries outcome + contract
  (victory screen data without the transient gameOver message).
- Play Again after victory funnels to the rematch lobby exactly as after defeat (no
  regression in handlePlayAgain).

**Regression clause**: existing coop-lifecycle/coop-integration suites pass with mechanical
updates only (xpAward shape, protocol version, roomState two new fields, voteState `kind`).
Seat reclaim, crash recovery, host migration, and discovery behavior are asserted unchanged.

---

## 9. Feature 3-5 seams this design commits to (binding on successors)

- **Banking hook**: `run-events.ts` `run-ended` event (`{runId, outcome, contract}`) — feature
  3 registers codex banking here (bank designs on victory AND retreat per locked #6; skip on
  defeat/abandoned per locked #7). Registration = one line in the static REGISTRY.
- **Loot drops**: feature 3 subscribes to `encounter-won` (has hex + icon for
  treasure-richness) — no room-machine edits needed.
- **Gateway travel**: feature 4 layers "travel deeper" onto the same gateway-hex stance used
  by `proposeRetreat` (`isRetreatHex`), extends `RoomVote` with a third kind, and replaces
  this feature's "activated ≡ cleared" reading of activate-gateway with real activation —
  `applyContractEvent`'s gateway arm is the single place that definition lives.
- **Difficulty**: feature 5 replaces the flat `XP_ENCOUNTER_WIN` accrual amount inside
  `recordEncounterWon` (one call site) and may scale `CONTRACTS[*].xpReward`.
- `hex-entered` is emitted (unused) for features 4/5.
