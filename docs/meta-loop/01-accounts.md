# Feature 1 — Accounts & Community Foundation: Final Design

Status: FINAL — this is the design doc referenced by `docs/meta-loop/README.md:77`.
Synthesized from three competing designs + two judge reports; every line anchor below was
re-verified against the live source on 2026-07-01. Data-model-first: schema is authoritative;
protocol and UI derive from it. Implementers need only this document plus the master README.

Verified ground truth this design builds on:

- `server/src/db.ts` (802 lines) — single module-scoped bun:sqlite handle (line 23, not
  exported today), WAL, FKs declarative-only (pragma off — see comment at 91-92), guarded
  migrations gated on `PRAGMA user_version` (currently 5; the v5 block ends at line 214).
  Existing tables use INTEGER-ms timestamps and integer run ids; that stays.
- HMAC seat token (db.ts:601-625): `mintSessionToken(clientId, salt)`; salts durable on
  `run_seats.token_salt`; the client never persists it (connection.ts holds it in memory).
- `run_seats` (db.ts:139-156): PK (run_id, seat_index), CHECK bot⇒client_id NULL /
  human⇒NOT NULL, partial unique index `idx_run_seats_client_live` (one live seat per client).
- `server/src/index.ts` — hourly sweep at 103; `sendSeatSnapshots` 214; `handleHello` 231 with
  welcome send-sites at 266/272/283; `createRoomFor` 295 (seat upsert 365, welcome 373);
  `handleJoinRoom` 379 (`msg.displayName` read at 400, upsert 411, welcome 419);
  `handleReclaimSeat` 424 (welcome 462); `handleQuickMatch` 496 (displayName pass-through 500);
  `handleStartGame` 515; `handlePlayAgain` 582 (displayName pass-through 590); `routeMessage`
  685 (seat gate at 703); SocketData inits at 869 and 936; sync try/catch around routeMessage
  at 951-958; ws `close()` 961-968 with an early-return-if-unseated at 963.
- `server/src/room.ts` — `SocketData` 39; `Seat` 47; `createOpenSeats` 219.
- `server/src/room-machine.ts` — `seatInfo()` 107; `endCombat` 1063 (win branch 1078-1087,
  loss branch 1088-1098); `persistSeat` 1165; bot upsert in leave path ~1284; `connectSeat`
  1310; `reconstructRoomForRun` 1371.
- `shared/src/net/protocol.ts` — `PROTOCOL_VERSION` 14; `SeatInfo` 33; `RoomBrowserEntry` 89;
  `ErrorCode` 111; `ClientMessage` 132; `ServerMessage` 160.
- Client: `main.ts` composition root (`new RoomConnection(url)` at 136 — no displayName is
  passed; `makeToast` at 157 is pointer-events:none; `new VotePanel(conn, seat)` at 233 is the
  floating-panel precedent; screen registration 239-246; `route()` 283). `connection.ts`
  `sendHello` 75-77; welcome branch 94-103. `player-token.ts` owns localStorage identity
  (`coop.clientId`, `coop.lastSeat`). HomeScreen repopulates `browserList` in place
  (home-screen.ts:36/62/371-372 — the focus-preserving discipline); LobbyScreen re-renders full
  `innerHTML` per notify (lobby-screen.ts:72-76), card width 1140px at line 80, `seatRow` 162.

---

## 0. Flags & decisions (read first)

Carried forward for the orchestrator — all were surfaced by the design/judging round:

1. **Doc gap resolved**: `docs/meta-loop/01-accounts.md` did not exist; this file is it.
2. **Deliberate deviation — `profiles` stores `xp` only.** The README's inline field list
   mentions "level"; level is ALWAYS derived via the shared `levelForXp(xp)` — storing both
   invites drift.
3. **Decision — XP banks immediately** on each encounter win through the single `awardXp()`
   site. Feature 2 reroutes that one site into a pending-run pool with 50% banking on
   wipe/retreat (locked decisions 6/7). No schema rework needed then.
4. **Decision — friends require claimed accounts** (both directions → `CLAIM_REQUIRED`).
   Guests are unfindable (no username); the restriction nudges claiming. Trivial to relax.
5. **Decision — `login`/`logout`/`register` rejected while seated** (`AUTH_IN_ROOM`);
   `claimAccount` allowed anytime (upgrade-in-place, no identity switch). Keeps per-seat
   attribution frozen for the life of a seat.
6. **`PROTOCOL_VERSION` 2 → 3.** `hello` gains `authToken` and loses `displayName`;
   `joinRoom`/`quickMatch` lose `displayName`; `welcome` gains a required `auth`; `SeatInfo`
   grows. Stale clients get the existing `protocolMismatch` refresh banner. Both sides deploy
   together.
7. **OPEN DECISION D1 (ask Ben, do not adopt silently)** — one-live-seat is clientId-scoped
   today. A claimed account logged in on two devices (two clientIds) can hold two live seats
   in two runs and double-earn XP. The ready-made fix, if Ben wants it closed now: a partial
   unique index `idx_run_seats_account_live ON run_seats(account_id) WHERE account_id IS NOT
   NULL AND left_at IS NULL` (safe on the populated DB — every historical row has NULL) plus
   generalizing `abandonPriorSeatForClient` (db.ts:523) to `abandonPriorSeatsFor(clientId,
   accountId)` stamping both the client-keyed and account-keyed live seats, and pre-stamping
   in `connectSeat` before the if-NULL backfill (§4.6) so backfilled reclaims cannot trip the
   index. User-facing behavior change: logging in and creating a room on device B abandons
   device A's live run. **Default for this feature: NOT adopted; ship without the index.**
8. Chat history is in-memory per room (cap 100) — lost on crash/reap. Deliberate v1 scope.
9. Guest-account rows from devices that later log in are retained (tiny rows; they remain the
   device's fallback identity after logout). Retention sweep deliberately deferred.
10. **FALLBACK-adjacent, surfaced not silent**: an invalid/expired hello `authToken` downgrades
    to guest resolution WITH `authRejected` reported in `welcome.auth`, and the client opens
    the auth modal in login mode (guest identity intact underneath, dismissable). It is a
    specified protocol state, not a silent recovery. The one pre-existing scoped fallback in
    this area (dev-only `serverSecret()`, db.ts:602-609) is untouched.
11. **Accepted limitation**: a claimed device that loses ONLY its auth token while keeping
    `coop.clientId` (partial localStorage clear) silently resolves to a fresh guest — without
    a device-binding table the server cannot distinguish this from a fresh device. Full
    localStorage loss is indistinguishable from a new browser anyway. The claimed account is
    never at risk (password required); the user logs back in via the profile card.
12. `debugWin`/`debugLose` flow through `endCombat` and therefore award XP/stats — acceptable
    (host-gated dev hooks).

---

## 1. Data model & migration (v6)

### 1.1 Design rules

- New tables are Supabase-shaped: `TEXT` UUID PKs (`crypto.randomUUID()`), ISO-8601 `TEXT`
  timestamps (`new Date().toISOString()` — lexicographically sortable). Existing tables keep
  their integer conventions; do not "fix" them.
- FKs remain declarative-only (pragma off) — integrity is app-enforced in
  `server/src/accounts.ts` with loud throws.
- `profiles` stores `xp` only; level is always derived (flag #2).
- `account_stats` is key/value so later features add stats without migrations.
- `username` is stored **as the user typed it**; uniqueness is case-insensitive via a unique
  expression index on `lower(username)` (ports verbatim to Postgres).

### 1.2 DDL — new `user_version < 6` block in db.ts, inserted directly after the v5 block (line 214)

```ts
// v6: accounts & community foundation (docs/meta-loop/01-accounts.md).
{
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (user_version < 6) {
    const migrate = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS accounts (
        id              TEXT PRIMARY KEY,
        username        TEXT,                 -- as typed; NULL until claimed; ci-unique via index
        password_hash   TEXT,                 -- Bun.password argon2id; NULL for guests
        email           TEXT,
        is_guest        INTEGER NOT NULL DEFAULT 1,
        guest_client_id TEXT UNIQUE,          -- localStorage clientId that minted this guest; NULL once claimed
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        CHECK (is_guest IN (0,1)),
        CHECK (is_guest = 1 OR (username IS NOT NULL AND password_hash IS NOT NULL))
      )`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username_ci
        ON accounts(lower(username)) WHERE username IS NOT NULL`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_sessions (
        id           TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL,           -- -> accounts(id), app-enforced
        token_hash   TEXT NOT NULL UNIQUE,    -- sha256 hex of the bearer token (raw token never stored)
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL            -- sliding, 365d
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions(account_id)`);
      db.exec(`CREATE TABLE IF NOT EXISTS profiles (
        account_id        TEXT PRIMARY KEY,   -- 1:1 with accounts
        display_name      TEXT NOT NULL,
        xp                INTEGER NOT NULL DEFAULT 0,
        equipped_title_id TEXT,               -- -> titles(id), app-enforced against account_titles; NULL = none
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS friends (
        account_id TEXT NOT NULL,             -- requester (direction is meaningful while pending)
        friend_id  TEXT NOT NULL,
        status     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (account_id, friend_id),
        CHECK (status IN ('pending','accepted')),
        CHECK (account_id <> friend_id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id)`);
      db.exec(`CREATE TABLE IF NOT EXISTS titles (
        id          TEXT PRIMARY KEY,         -- slug, e.g. 'pathfinder'
        name        TEXT NOT NULL,
        description TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_titles (
        account_id TEXT NOT NULL,
        title_id   TEXT NOT NULL,
        earned_at  TEXT NOT NULL,
        PRIMARY KEY (account_id, title_id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_stats (
        account_id TEXT NOT NULL,
        stat       TEXT NOT NULL,             -- 'encounters_won' | 'hexes_charted' | 'dimensions_discovered' | 'wipes' (open set)
        value      INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, stat)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS account_dimensions (
        account_id    TEXT NOT NULL,
        dimension_id  INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        PRIMARY KEY (account_id, dimension_id)
      )`);
      try {
        db.exec("ALTER TABLE run_seats ADD COLUMN account_id TEXT");
      } catch (e) {
        if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_run_seats_account ON run_seats(account_id)`);
      db.exec(`PRAGMA user_version = 6`);
    });
    migrate();
  }
}
```

Idempotency against the populated `server/hex-discovery.sqlite` (real data: 854 runs, 149
run_seats): everything is `IF NOT EXISTS` / duplicate-column-guarded ALTER, gated once by
`user_version`. Fresh DBs flow v3→v4→v5→v6 unchanged. **Never edit the shipped v3–v5 blocks.**
If Ben approves D1 (flag #7), the account-live unique index lands as a v7 block, not here.

App-enforced invariants (throw loudly):
- `upsertRunSeat` with `controllerKind:"bot"` must receive `accountId: null` — mirror of the
  existing client_id CHECK, which SQLite cannot gain via ALTER. Throw if violated.
- `profiles.equipped_title_id` must exist in `account_titles` for that account (validated in
  `equipTitle`).
- `friends` rows: both accounts must exist and be claimed (validated at insert).

`account_dimensions` intentionally doubles as feature 4's "charted addresses per account"
source (run-start dimension picker) — not a throwaway.

### 1.3 Title seeds (boot-time, not migration)

`seedTitles()` in `accounts.ts`, called from `initSeeds()` (index.ts:84, same pattern as
`seedDimension*`; skipped under `GAME_SKIP_SEED=1`, tests call it directly). It upserts rows
from the **shared** `TITLES` catalog (§2.2):
`INSERT INTO titles ... ON CONFLICT(id) DO UPDATE SET name=excluded.name,
description=excluded.description, sort_order=excluded.sort_order` — copy edits reach existing
DBs without a migration.

### 1.4 db.ts surface changes

- `export const db` (the Database handle, currently private at line 23). Required so
  `accounts.ts` shares the connection — **load-bearing for tests**: two
  `new Database(":memory:")` are two separate databases. Migration DDL stays in db.ts (single
  migration owner); module-load order guarantees tables exist before `accounts.ts` prepares
  statements.
- `upsertRunSeat(runId, seatIndex, seat)` (db.ts:499) — `seat` gains
  `accountId: string | null`; the upsert adds `account_id` to the INSERT and
  `account_id = excluded.account_id` to the conflict clause. `RunSeatRow` gains
  `account_id: string | null`. Throws on bot+non-null accountId (§1.2).
- New `setSeatAccountIfNull(runId, seatIndex, accountId)`:
  `UPDATE run_seats SET account_id = ? WHERE run_id = ? AND seat_index = ? AND account_id IS NULL`.
  The IS NULL guard is load-bearing (§4.6): attribution is backfilled onto unattributed rows
  and **never overwritten** — a claimed account's in-flight run can never be silently
  redirected to a throwaway guest.
- Everything account-shaped lives in the new `accounts.ts`, not db.ts (the v6 DDL block is
  db.ts's only growth).
- `eraseClient` (db.ts:455) untouched. Account erasure is a distinct future concern
  (stats/titles/discovery persist by design, locked decision 7).

---

## 2. Shared modules

### 2.1 `shared/src/core/progression.ts` (new; export from `shared/src/index.ts`)

```ts
/** Tunable: flat XP per encounter win, v1 (feature 5 scales by difficulty). */
export const XP_ENCOUNTER_WIN = 25;

/** Total XP required to have reached `level` (level 1 = 0). Cost of n -> n+1 is 100*n. */
export function xpToReachLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new Error(`xpToReachLevel: bad level ${level}`);
  return 50 * level * (level - 1);
}

/** Inverse of xpToReachLevel. Closed-form guess + integer-exact adjustment (no FP boundary bugs). */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp < 0) throw new Error(`levelForXp: bad xp ${xp}`);
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2));
  while (xpToReachLevel(level + 1) <= xp) level++;
  while (level > 1 && xpToReachLevel(level) > xp) level--;
  return level;
}

/** Locked decision 5: manifest slots. Tunable constant lives here with the curve. */
export function expeditionSlots(level: number): number {
  return 2 + Math.floor(level / 5);
}
```

Milestones: level 2 @ 100 XP (4 wins), level 5 @ 1000 (+1 slot), level 10 @ 4500 (+2 slots).
**Account level grants zero combat stats by construction**: nothing under `shared/src/combat/`
or the encounter builder may import this module; the only consumers are slots (feature 3),
titles, and UI.

### 2.2 `shared/src/core/titles.ts` (new; export from `shared/src/index.ts`)

Shared so the client renders title names — and later progress ("18/25 hexes to Pathfinder") —
with zero fetches. The server evaluates and grants; DB `titles` rows seed from this array.

```ts
export interface TitleDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
  /** stat key from account_stats, or the pseudo-stat "level" (derived from xp). */
  readonly requirement: { readonly stat: string; readonly gte: number };
}

export const TITLES: readonly TitleDef[] = [
  { id: "greenhorn",   name: "Greenhorn",   description: "Win your first encounter.",  sortOrder: 0, requirement: { stat: "encounters_won", gte: 1 } },
  { id: "slayer",      name: "Slayer",      description: "Win 50 encounters.",         sortOrder: 1, requirement: { stat: "encounters_won", gte: 50 } },
  { id: "pathfinder",  name: "Pathfinder",  description: "Chart 25 hexes.",            sortOrder: 2, requirement: { stat: "hexes_charted", gte: 25 } },
  { id: "worldwalker", name: "Worldwalker", description: "Set foot in 3 dimensions.",  sortOrder: 3, requirement: { stat: "dimensions_discovered", gte: 3 } },
  { id: "veteran",     name: "Veteran",     description: "Reach level 5.",             sortOrder: 4, requirement: { stat: "level", gte: 5 } },
  { id: "unbroken",    name: "Unbroken",    description: "Survive 10 party wipes.",    sortOrder: 5, requirement: { stat: "wipes", gte: 10 } },
];

export function titleById(id: string): TitleDef {
  const t = TITLES.find((t) => t.id === id);
  if (!t) throw new Error(`titleById: unknown title "${id}"`);
  return t;
}

/** Pure earn check. `stats` = account_stats rows; level passed separately (derived from xp). */
export function earnedTitleIds(stats: Readonly<Record<string, number>>, level: number): string[] {
  const merged = { ...stats, level };
  return TITLES.filter((t) => (merged[t.requirement.stat] ?? 0) >= t.requirement.gte).map((t) => t.id);
}
```

---

## 3. Wire protocol (shared/src/net/protocol.ts)

`PROTOCOL_VERSION` bumps **2 → 3**.

Naming: the existing `SessionToken` (HMAC seat token) is untouched. The account bearer token
is `authToken` everywhere — never "session token" — to prevent conflation.

### 3.1 New DTOs

```ts
export type AccountId = string;

export interface AccountStatsPayload {
  readonly encountersWon: number;
  readonly hexesCharted: number;
  readonly dimensionsDiscovered: number;
  readonly wipes: number;
}

export interface ProfilePayload {
  readonly accountId: AccountId;
  readonly displayName: string;
  readonly isGuest: boolean;
  readonly username: string | null;        // public handle; email NEVER leaves the server
  readonly xp: number;
  readonly level: number;                  // levelForXp(xp), server-derived
  readonly equippedTitleId: string | null; // client resolves names via shared TITLES
  readonly titles: readonly string[];      // owned title ids
  readonly stats: AccountStatsPayload;
  readonly createdAt: string;              // ISO
}

export interface AuthStatePayload {
  readonly accountId: AccountId;
  readonly isGuest: boolean;
  readonly username: string | null;
  readonly authToken: string;              // bearer; client persists (localStorage "coop.authToken")
  readonly profile: ProfilePayload;
  /** Set iff a presented hello authToken failed — client opens the auth modal in login mode. */
  readonly authRejected?: "expired" | "invalid";
}

export interface FriendEntry {
  readonly accountId: AccountId;
  readonly displayName: string;
  readonly level: number;
  readonly equippedTitleId: string | null;
  readonly online: boolean;
  readonly roomCode: RoomCode | null;      // set iff friend is in a joinable lobby-phase room
}
export interface FriendRequestEntry {
  readonly accountId: AccountId;
  readonly displayName: string;
  readonly level: number;
  readonly sentAt: string;
}
export interface FriendsListPayload {
  readonly friends: readonly FriendEntry[];
  readonly incoming: readonly FriendRequestEntry[];
  readonly outgoing: readonly FriendRequestEntry[];
}

export interface ChatEntry {
  readonly seatId: SeatId;
  readonly displayName: string;
  readonly text: string;
  readonly t: number;                      // server Date.now() at accept
}
```

### 3.2 Changed messages

```ts
// hello: displayName REMOVED, authToken ADDED
| { type: "hello"; protocolVersion: number; clientId: ClientId; authToken?: string }

// joinRoom / quickMatch: displayName REMOVED (profiles are the single name source)
| { type: "joinRoom"; code: RoomCode }
| { type: "quickMatch"; dimensionId?: number }

// welcome: gains a REQUIRED auth field (atomic — no post-welcome ordering subtlety)
| { type: "welcome"; protocolVersion: number; sessionToken: SessionToken;
    auth: AuthStatePayload; reconnected?: { code: RoomCode; seatId: SeatId } }
```

`SeatInfo` (protocol.ts:33) gains (all null for open/bot seats; built from the in-memory seat
cache §5, never a DB read per broadcast):

```ts
  readonly accountId: AccountId | null;
  readonly level: number | null;
  readonly equippedTitleId: string | null;
```

`RoomBrowserEntry` unchanged — the "no identities to unseated sockets" constraint
(protocol.ts:84-96) holds.

### 3.3 ClientMessage additions (union at protocol.ts:132)

```ts
  | { type: "claimAccount"; username: string; password: string; email?: string }
  | { type: "register"; username: string; password: string; email?: string }
  | { type: "login"; username: string; password: string }
  | { type: "logout" }
  | { type: "getProfile"; accountId?: AccountId }        // omitted = own
  | { type: "setDisplayName"; name: string }
  | { type: "equipTitle"; titleId: string | null }
  | { type: "getFriends" }
  | { type: "friendRequest"; username: string }
  | { type: "friendAccept"; accountId: AccountId }
  | { type: "friendDecline"; accountId: AccountId }      // decline incoming OR cancel own outgoing
  | { type: "friendRemove"; accountId: AccountId }
  | { type: "friendInvite"; accountId: AccountId }       // seat-scoped: invite friend to my room
  | { type: "chatSend"; text: string }                   // seat-scoped
```

### 3.4 ServerMessage additions (union at protocol.ts:160)

```ts
  | { type: "authState"; auth: AuthStatePayload }        // pushed after post-connect auth mutations only
  | { type: "profile"; profile: ProfilePayload }         // getProfile response + own-profile pushes
  | { type: "friendsList"; friends: FriendsListPayload } // full snapshot: response + push on mutation/presence
  | { type: "roomInvite"; from: { accountId: AccountId; displayName: string }; code: RoomCode; dimensionId: number }
  | { type: "chat"; entry: ChatEntry }
  | { type: "chatHistory"; entries: readonly ChatEntry[] } // replayed in sendSeatSnapshots
  | { type: "xpAward"; amount: number; xp: number; level: number; leveledUp: boolean } // PRIVATE per-seat
  | { type: "titlesEarned"; titleIds: readonly string[] }  // PRIVATE, on any new grant
```

`xpAward`/`titlesEarned` are sent per awarded seat via `io.send(seat, ...)` — never broadcast
— so one player's XP totals are not leaked to the room. Other players see level changes via
the `roomState` SeatInfo refresh.

All new messages go through `io`/`sendTo` (wire-transport.ts), so envelope `seq` numbering and
the client's `checkSeq` guard hold automatically — including friend pushes to room-less
sockets (presence stores the raw `ws`; `sendTo` works on it). Never `ws.send` directly.

### 3.5 ErrorCode additions (protocol.ts:111)

```ts
  | "USERNAME_TAKEN" | "INVALID_CREDENTIALS" | "INVALID_INPUT" | "NOT_A_GUEST"
  | "CLAIM_REQUIRED" | "NO_SUCH_USER" | "AUTH_IN_ROOM" | "RATE_LIMITED"
```

All auth/social failures reuse the existing `{type:"error"}` message with these codes;
`recoverable: true`.

Validation rules (server, `accounts.ts`): username `^[A-Za-z0-9_]{3,20}$` stored as typed,
unique case-insensitively (login looks up by `lower(username)`); password 8–128 chars; display
name 1–24 chars trimmed; email loose `/.+@.+/` if provided; chat ≤ 300 chars trimmed non-empty.

---

## 4. Auth flow end-to-end

### 4.1 Acceptance journeys (the design must serve these; they head the test plan §8)

- **J1 fresh player**: opens game → hello (no token) → guest minted → Quick Match → fighting
  inside a minute, zero auth UI. HOME shows "Wanderer-3F2A · Guest · Lv 1 · Claim this account".
- **J2 returning guest claims**: claim modal → username/password → all guest XP/stats/titles
  carry over (same account row, upgraded in place).
- **J3 login on a new device**: fresh clientId auto-mints a throwaway guest; Log In switches
  the connection to the claimed account; token persists; later hellos restore it passwordless.
- **J4 two friends team up**: request by username → accept → presence dots → invite from a
  lobby → toast with Join → seated together.
- **J5 full lobby chatting**: chat relays lobby + overworld; roster shows name/level/title;
  a roomState re-render never blurs the chat input (floating panel, §6.4).
- **J6 deploy-day migration**: pre-feature player (possibly mid-run) → protocolMismatch banner
  → refresh → hello with no token → guest minted bound to the EXISTING clientId → live seat
  auto-reclaims via the untouched HMAC path → resumes mid-overworld with an account silently
  underneath and history backfilled.

### 4.2 Guest mint (first connect) & seamless localStorage migration

1. Client boot: `sendHello()` (connection.ts:75) attaches `authToken: getAuthToken() ??
   undefined` from localStorage key `coop.authToken` (new accessors in player-token.ts).
2. Server `handleHello` (index.ts:231), after the protocol check and `ws.data.clientId`
   assignment, before the durable-seat resume block, calls
   `resolveConnectionAccount(ws, msg)` (in `auth-handlers.ts`):
   - `authToken` present → sha256 it, look up `account_sessions`, check `expires_at`. Valid →
     touch `last_seen_at`, slide `expires_at` (+365d), account resolved (echo same token).
     Invalid/expired → note `authRejected: "invalid" | "expired"` and fall through to guest
     resolution (surfaced to the client, not silent — flag #10).
   - No/failed token → `SELECT * FROM accounts WHERE guest_client_id = ? AND is_guest = 1`.
     Hit → reuse (idempotent mint; also the recovery path if the client lost only its token).
     Miss → mint: account row (`is_guest=1`, `guest_client_id=clientId`), profile row
     (`display_name` = `Wanderer-<first 4 hex of account id, uppercase>`), then **backfill**
     `UPDATE run_seats SET account_id = ? WHERE client_id = ? AND account_id IS NULL` —
     pre-accounts history and any crash-recovered active run attribute to the new guest.
     The mint INSERT is wrapped in try/catch on the `guest_client_id` unique violation →
     re-select. This is uniqueness-race resolution (two racing sockets, same clientId), not a
     silent fallback — both resolve to one account.
   - Ensure a session row exists (mint one when resolved via the guest path: 32 random bytes
     hex, store sha256, TTL 365d sliding).
3. `ws.data.accountId = account.id`; `ws.data.authToken = rawToken` (memory-only stash so
   later welcomes can embed auth); `presence.register(accountId, ws)`; on a 0→1 transition
   push `friendsList` to online friends; for a claimed account, push `friendsList` to this
   socket right after the welcome.
4. The existing seat-resume logic runs **unchanged** (clientId-keyed, HMAC path intact). Seat
   attribution happens inside `connectSeat` (§4.6), not here.
5. Every `welcome` send-site gains `auth: buildAuthState(ws, authRejected?)` — the three in
   handleHello (index.ts:266/272/283) pass the resolution's `authRejected`; the three at seat
   bind (373/419/462) rebuild from `ws.data.accountId`/`ws.data.authToken` (throws loudly if
   hello never ran — cannot happen behind the "Say hello first" guards).

Existing localStorage-only users migrate with zero action: same `coop.clientId` →
deterministic guest account, history backfilled, the welcome's `auth` gives them a token the
client persists.

### 4.3 Claim (guest → named account)

`{type:"claimAccount"}` — allowed anytime, even mid-run (upgrade-in-place, no identity switch):
1. Guard: `ws.data.accountId` set; account `is_guest=1` else `NOT_A_GUEST`; validate
   username/password; `USERNAME_TAKEN` on ci-unique conflict (catch the constraint error).
2. `password_hash = await Bun.password.hash(password, { algorithm: "argon2id" })` (async — see
   §5 async-handler rule).
3. `UPDATE accounts SET username=?, password_hash=?, email=?, is_guest=0, guest_client_id=NULL,
   updated_at=?`. **Clearing `guest_client_id` is load-bearing**: it frees the unique binding
   so a later sessionless hello from this device mints a fresh guest instead of silently
   logging into the claimed account (that would be password-bypass).
4. Set `profiles.display_name` to the claimed username iff the profile still has its minted
   `Wanderer-....` default.
5. Existing session stays valid. Push `authState` (isGuest:false). If seated,
   `broadcastRoomState` (name may have changed) + refresh the seat's displayName + durable row.

### 4.4 Register / login / logout

`login` — **rejected with `AUTH_IN_ROOM` unless the socket is room-less**
(`ws.data.roomCode === null`). Same rule for `logout` and `register`; `claimAccount` exempt.
This keeps seat attribution (`run_seats.account_id`, XP targets) frozen for the life of a seat.
1. Look up by `lower(username)`; `await Bun.password.verify(password, hash)`; failures →
   `INVALID_CREDENTIALS` (same code for unknown user — no enumeration). Per-socket limiter:
   max 5 login/register/claim attempts per 60s → `RATE_LIMITED`.
2. Mint a new session row (multi-device: one row per device). Swap `ws.data.accountId` /
   `ws.data.authToken`; presence unregister(old)/register(new) with friend pushes for both;
   push `authState` with the new token (client overwrites localStorage) then `friendsList`.
3. The device's prior guest account remains in the DB, still bound via `guest_client_id` —
   after a later logout the device falls back to exactly that guest.

`register` is identical to login except it first creates a fresh claimed account (+profile) —
for users who want a new named account without upgrading the current guest.

`logout`: delete the presented session row, then run guest resolution for `ws.data.clientId`
(reuse-or-mint), swap accountId/token/presence, push `authState` (isGuest:true, new token).
An account is always present under the hood.

### 4.5 HMAC seat token coexistence

Two orthogonal credentials, by design:

| | HMAC seat token (existing, unchanged) | Account authToken (new) |
|---|---|---|
| Proves | this clientId may (re)claim a specific seat | this connection is account X |
| Storage | server: `run_seats.token_salt`; client: memory only | server: `account_sessions.token_hash`; client: localStorage |
| Lifetime | per seat-claim | 365d sliding |
| Used at | `reclaimSeat`, hello auto-reclaim | hello, auth mutations |

The seat-reclaim machinery (index.ts:245-277, 424-466; db.ts:601-625) is **not modified**.
`run_seats.account_id` is attribution only — never used for reclaim authorization in v1.
The one-live-seat rule stays clientId-scoped (open decision D1, flag #7).

Housekeeping: `purgeExpiredSessions()` (`DELETE FROM account_sessions WHERE expires_at < ?`)
added to the existing hourly sweep (index.ts:103).

### 4.6 Seat attribution (the never-overwrite rule)

- Fresh binds (`createRoomFor` host claim, `handleJoinRoom` open-seat claim, bot-fill, leave):
  full `upsertRunSeat` carries `accountId` (`ws.data.accountId` for humans, `null` for bots).
  `seat.accountId` and `seat.cardProfile` set from the account; `seat.displayName` set from
  the profile (delete index.ts:400).
- Reconnect/reclaim (`connectSeat`, room-machine.ts:1310 — covers hello auto-reclaim AND
  explicit `reclaimSeat`): append after the existing bind logic:
  `if (seat.accountId === null && socket.data.accountId) { seat.accountId =
  socket.data.accountId; setSeatAccountIfNull(room.runId, seat.seatIndex, seat.accountId); }`
  then refresh `seat.cardProfile` + `seat.displayName` from `seat.accountId`'s profile.
  Consequences, all intended:
  - J6 pre-accounts rows (NULL) backfill to the device's guest on first resume.
  - A seat already attributed to claimed account A is NEVER re-pointed at a throwaway guest
    when the token expired mid-run (`authRejected` path): `seat.accountId` stays A, XP keeps
    banking to A — attribution frozen at bind, and seat access was already clientId-gated by
    the HMAC token regardless of account auth.
- `leaveSeatPermanently` (upsert at ~room-machine.ts:1284) passes `accountId: null` and nulls
  `seat.accountId`/`seat.cardProfile` alongside clientId.
- `reconstructRoomForRun` (1371) rehydrates `seat.accountId = row?.account_id ?? null` and
  loads card profiles via one `loadCardProfile` per human seat (crash-recovery attribution
  survives).
- `persistSeat` (1165) passes `seat.accountId`.

---

## 5. Server module layout

New files (each a real seam):

| File | Contents |
|---|---|
| `server/src/accounts.ts` | All account-domain DB access on the shared `db` handle: guest mint/reuse (+run_seats backfill), claim/register/login credential logic (Bun.password), session mint/validate/revoke/purge, profiles (get/setDisplayName/equipTitle), `awardXp`, `bumpStat`, `recordDimensionSeen`, friends CRUD queries, `evaluateTitles` (uses shared `earnedTitleIds`; `INSERT OR IGNORE`, returns newly granted ids), `seedTitles`, `loadProfilePayload(accountId)`, `loadCardProfile(accountId)` → `{displayName, level, equippedTitleId}` |
| `server/src/presence.ts` | `Map<accountId, Set<ServerWebSocket<SocketData>>>`; `register/unregister` returning online-transition booleans; `isOnline`, `socketsFor`, `pushToAccount(accountId, msg)` via `sendTo` |
| `server/src/auth-handlers.ts` | `resolveConnectionAccount(ws, helloMsg)`, `buildAuthState(ws, authRejected?)`, `handleClaim/Register/Login/Logout` |
| `server/src/social-handlers.ts` | `handleGetProfile/SetDisplayName/EquipTitle`, friends handlers (+ `pushFriendsListTo(accountId)`, presence-delta pushes), `handleFriendInvite`, `handleChatSend` |
| `server/src/awards.ts` | `awardEncounterWin(room, io)`, `recordWipe(room, io)`, `recordDimensionsSeen(room)` — iterate eligible seats, call accounts.ts primitives, run `evaluateTitles`, refresh seat card caches, emit private `xpAward`/`titlesEarned`/`profile` pushes |

Edited files:

- `server/src/db.ts` — v6 block; `export const db`; `upsertRunSeat` + `RunSeatRow` +
  `setSeatAccountIfNull` (§1.4).
- `server/src/room.ts` — `SocketData` gains `accountId: string | null` and
  `authToken: string | null` (raw bearer, memory-only, for welcome embedding); `Seat` gains
  `accountId: string | null`, `cardProfile: { level: number; equippedTitleId: string | null } | null`
  (cached — `broadcastRoomState` fires constantly and must not hit the DB), and
  `chatTimestamps: number[]` (rate limit); `Room` gains `chatLog: ChatEntry[]`;
  `createOpenSeats` (219) initializes them.
- `server/src/room-machine.ts` — `seatInfo()` (107) emits `accountId`/`level`/
  `equippedTitleId` from the seat cache (nulls for open/bot); `endCombat` (1063): win branch
  calls `awardEncounterWin(room, io)` after `exploreHex` (1079) and **before**
  `broadcastRoomState` (1084) so the broadcast carries new levels; loss branch calls
  `recordWipe(room, io)` before its broadcast (1096). Awards run as separate synchronous
  transactions — they must not join the R13.2 `commitExplore` transaction, and introduce no
  awaits (R7 generation discipline untouched). `connectSeat` (1310) gains the §4.6 backfill;
  `persistSeat` (1165) passes accountId; `reconstructRoomForRun` (1371) rehydrates (§4.6);
  leave path passes `accountId: null`.
- `server/src/index.ts` — `handleHello` gains account resolution + presence + `auth` on its
  three welcome sites (§4.2); `createRoomFor`/`handleJoinRoom`/`handleReclaimSeat` welcomes
  gain `auth: buildAuthState(ws)`; `routeMessage` (685): connection-scoped cases
  (`claimAccount/register/login/logout/getProfile/setDisplayName/equipTitle/getFriends/
  friendRequest/friendAccept/friendDecline/friendRemove`) added ABOVE the seat gate (703),
  each guarded by "Say hello first" (`ws.data.clientId`); seat-scoped `chatSend`/`friendInvite`
  below it; `handleJoinRoom` deletes line 400 and sets `seat.displayName` from the profile;
  `handleQuickMatch` (500) and `handlePlayAgain` (590) drop the displayName pass-through
  (**all three sites change together** — otherwise a rematch resurrects stale names);
  `handleStartGame` bot-fill passes `accountId: null`, then calls `recordDimensionsSeen(room)`
  (INSERT OR IGNORE `account_dimensions`; first insert per account bumps
  `dimensions_discovered`); `sendSeatSnapshots` (214) additionally sends
  `{type:"chatHistory", entries: room.chatLog}`; SocketData inits (869, 936) add
  `accountId: null, authToken: null`; ws `close()` (961) calls `presence.unregister(ws)`
  (no-op when accountId is null — socket died pre-hello) **BEFORE** the
  early-return-if-unseated at 963, else room-less HOME sockets — the primary presence audience
  — never go offline; `initSeeds` calls `seedTitles()`; hourly sweep adds
  `purgeExpiredSessions()`.

**Async-handler rule (load-bearing)**: `Bun.password.hash/verify` are async, but `routeMessage`
and the ws `message()` try/catch (index.ts:951-958) are synchronous — a rejected promise would
escape as an unhandled rejection. Every async handler (claim/register/login) is invoked as
`void handleX(...)` and must catch internally: `console.error` server-side + `sendError(ws,...)`
to the client (fail loud both ways). After any `await`, abort if `ws.readyState !== 1`.

Chat relay rules (`handleChatSend`): allowed phases `lobby` and `overworld` only, else
`BAD_PHASE`; validate text (§3.5) else `INVALID_INPUT`; per-seat rate limit 5 msgs/10s via
`seat.chatTimestamps` else `RATE_LIMITED`; on accept push
`{seatId, displayName: seat.displayName, text, t: Date.now()}` into `room.chatLog` (cap 100,
drop oldest) and `io.broadcast({type:"chat", entry})`. In-memory only (flag #8).

Friends rules (`social-handlers.ts` over `accounts.ts` queries):
- Username-keyed requests; **both sides must be claimed** — guests get `CLAIM_REQUIRED`
  (sending) / are unfindable. `getFriends` from a guest returns empty lists (truthful, not an
  error).
- `friendRequest`: `NO_SUCH_USER`; self → `INVALID_INPUT`; existing accepted edge (either
  direction) → `INVALID_INPUT`; duplicate outgoing → `INVALID_INPUT`; an opposite-direction
  pending request **auto-accepts** (mutual intent).
- `friendAccept` only by the pending row's target; `friendDecline` deletes a pending row from
  either side; `friendRemove` deletes an accepted row matched in either direction.
- After every mutation: `pushFriendsListTo` both parties' live sockets. On presence 0↔1
  transitions: push to that account's online friends.
- `FriendEntry.roomCode`: scan `rooms` for a live seat with `seat.accountId === friend &&
  seat.socket`, report the code iff `phase === "lobby"`, room `listed`, and an open seat exists.
- `friendInvite`: sender must be seated, room `phase === "lobby"` with an open seat, target an
  accepted friend; send `roomInvite` to each of the target's live sockets.

---

## 6. XP / stats / titles wiring (where events already happen)

Eligible seat: `seat.accountId !== null && seat.state ∈ {human-connected, human-disconnected}`
(a permanent leaver is already `bot` with accountId nulled — leavers earn nothing; a briefly
dropped human still earns). Each participant receives the full flat award (no split).

| Event | Site | Writes per eligible seat |
|---|---|---|
| Encounter win | `endCombat` win branch (room-machine.ts:1078-1087) via `awardEncounterWin` | `awardXp(accountId, XP_ENCOUNTER_WIN)`; `bumpStat('encounters_won', 1)`; `bumpStat('hexes_charted', 1)` (a win on `pendingHex` IS the charting event — `exploreHex` just ran); `evaluateTitles`; refresh `seat.cardProfile`; private `io.send(seat, xpAward)` + `titlesEarned` (if any) + own `profile` push; then the branch's existing `broadcastRoomState` carries new levels |
| Party wipe | `endCombat` loss branch (1088-1098) via `recordWipe` | `bumpStat('wipes', 1)`; `evaluateTitles`; private `titlesEarned`/`profile` pushes |
| Expedition start | `handleStartGame` (index.ts:515) after bot-fill, via `recordDimensionsSeen` | `INSERT OR IGNORE account_dimensions`; on first insert `bumpStat('dimensions_discovered', 1)`; `evaluateTitles` |

All hooks are synchronous SQLite writes inside already-synchronous paths — no new awaits
inside the R7-guarded machine. `resetToOrigin`/retreat banking is feature 2's seam (flag #3).
Disconnected-human seats have `seat.socket === null`; the DB writes still happen, the private
pushes are simply skipped.

---

## 7. Client

### 7.1 Identity & net

- `player-token.ts`: add `getAuthToken(): string | null`, `setAuthToken(token: string)`,
  `clearAuthToken()` under key `coop.authToken`. `StoredSeat` untouched (separate mechanism —
  never conflate).
- `connection.ts`: delete the `displayName` constructor param (line 37; main.ts:136 never
  passed one). `sendHello()` attaches `authToken: getAuthToken() ?? undefined`. The `welcome`
  branch (94-103) additionally calls `setAuthToken(msg.auth.authToken)` (same pattern as
  `setStoredSeat`). The HMAC `_sessionToken` stays memory-only.
- `main.ts` (composition root, ~136-260): construct `AccountStore` + `ChatStore`; subscribe:
  - `on("welcome")` → `accountStore.setAuth(msg.auth)`; if `msg.auth.authRejected`, open the
    auth modal in login mode (dismissable — guest identity intact underneath) and surface an
    `errorNote` on the home profile card.
  - `on("authState")` → `setAuthToken(msg.auth.authToken)` + `accountStore.setAuth(msg.auth)`.
  - `on("profile")` → accountStore (own-profile pushes and getProfile responses).
  - `on("friendsList")` → accountStore.
  - `on("chat")`/`on("chatHistory")` → chatStore (cleared when `roomState.code` changes or on
    `leftRoom`).
  - `on("xpAward")` → toast `+25 XP` (and `Level up!` when `leveledUp`).
  - `on("titlesEarned")` → toast per title, names resolved via shared `titleById`.
  - `on("roomInvite")` → clickable invite toast (new `inviteToast` helper — the existing
    `makeToast` at 157 is pointer-events:none) whose Join button sends `{type:"joinRoom", code}`.
  - One floating `ChatPanel` constructed once (next to `new VotePanel(conn, seat)` at 233).

### 7.2 Stores (SeatContext pattern — plain fields + subscribe/notify, no fallback defaults)

- `client/src/state/account-store.ts`: `auth: AuthStatePayload | null`,
  `profile: ProfilePayload | null` (own), `friends: FriendsListPayload | null`,
  `authRejected` notice; setters + `subscribe`.
- `client/src/state/chat-store.ts`: `entries: ChatEntry[]` (cap 100), `append`, `replaceAll`
  (chatHistory), `clear`, `subscribe`.

### 7.3 ui-kit additions (pure DOM helpers, THEME/FONT tokens only, no new colors)

- `textInput(placeholder)` — extracted styling from home's join-code input: dark
  `rgba(11,9,6,0.5)` fill, `1px solid THEME.goldLine` border, `THEME.parch` text, radius 8,
  focus → `THEME.gold` border.
- `errorNote(text)` — extraction of HomeScreen's danger-tinted `errorBox` for reuse.
- `levelChip(level)` — `LV ${level}` pill: `font:700 11px FONT.cinzel`, `THEME.gold`,
  `1px solid THEME.goldLine`, radius 5.
- `titleTag(titleId)` — resolves the name via shared `titleById`; italic `12px FONT.body`,
  `THEME.goldDeep`. Throws on unknown id (classArt's fail-loud precedent).
- `xpBar(pct)` — 6px track `rgba(11,9,6,0.5)` with `THEME.gold → THEME.goldDeep` gradient fill.

### 7.4 Screens & components

- **`client/src/screens/chat-panel.ts`** (new — the VotePanel precedent, replacing any docked
  lobby chat): a floating self-managed component constructed ONCE in main.ts
  (`new ChatPanel(conn, seat, chatStore)`), fixed bottom-left, 320px, bg `rgba(17,13,9,0.85)`,
  `THEME.goldLine` border. Visible iff `seat.room?.phase` is `"lobby"` or `"overworld"`
  (SeatContext subscription). Collapsible header bar (`FONT.cinzel`, `THEME.gold`) with an
  unread pip while collapsed; message list appended in place (sender `THEME.gold` 600, text
  `THEME.parch`, 13px `FONT.body`, auto-scroll pinned to bottom unless the user scrolled up);
  `textInput` + Send `btn`; Enter sends `chatSend`. Because the panel is its own DOM subtree
  outside every screen, LobbyScreen's full-innerHTML re-renders (lobby-screen.ts:72-76) can
  never blur it — the entire focus-capture/restore problem is designed away, and one component
  serves both phases.
- **`client/src/screens/auth-modal.ts`** (new, self-managed overlay — NOT a ScreenManager
  overlay; that single slot belongs to combat/inventory): fixed z-index 120 scrim
  `rgba(7,5,3,0.72)` over a 420px `panelCard()`; `eyebrow("Account")`; mode tabs Claim /
  Log in (+ Register reachable from Log in); `textInput`s for username/password(/email
  optional); primary `btn` submit; `errorNote` bound to auth error codes (`USERNAME_TAKEN`,
  `INVALID_CREDENTIALS`, `INVALID_INPUT`, `RATE_LIMITED`, `AUTH_IN_ROOM`, `NOT_A_GUEST`) while
  open; closes on matching `authState` success, Escape, or scrim click. Exposes `open(mode)`.
- **`client/src/screens/profile-card.ts`** (component): avatar circle (lobby avatar styling),
  display name (16px 600 `THEME.parch`, click-to-edit → `setDisplayName`), `levelChip` +
  `titleTag` (click opens a titles popover listing owned titles from the profile → `equipTitle`),
  `xpBar` fed by shared progression (`xp - xpToReachLevel(level)` over
  `xpToReachLevel(level+1) - xpToReachLevel(level)`), stats row (13px `THEME.muted`), and
  either a gold "Claim this account" `btn(...,"primary")` + "log in instead" link (guest) or
  `@username` + Log out ghost button. Built once; updates in place on AccountStore notify.
- **`client/src/screens/friends-panel.ts`** (component): heading("Friends","section") +
  `rule()`; add-by-username row (`textInput` + small `btn`) living OUTSIDE the repopulated
  list node; list repopulated in place (browserList discipline — the input never blurs on a
  friendsList push): row = presence dot (filled `THEME.green` + glow online / hollow
  `THEME.faint` offline), name + `levelChip` + `titleTag`, right-side action — "Join" (friend
  in joinable room) or "Invite" (own room has an open lobby seat); incoming requests pinned on
  top with Accept(primary)/Decline(danger); outgoing with Cancel. Guest state: body replaced
  by "Claim your account to add friends" + claim button.
- **HomeScreen** (edit): profile-card mounted at the top of `leftColumn()` (138); right rail
  (332-354) becomes two stacked sections — Open Rooms (`browserList`, unchanged incl. poll)
  then `rule()` + friends-panel. Both persistent elements survive `render()` exactly the way
  `browserList` does today. `authRejected` renders an `errorNote` above the profile card.
- **LobbyScreen** (edit — deliberately minimal; chat is the floating panel, so no layout
  change): `seatRow` (162) nameRow gains `levelChip(s.level)` when non-null; sub-line becomes
  `titleTag(s.equippedTitleId)` + presetName. Card width stays 1140px.
- **GameOverScreen**: untouched (victory variant is feature 2).

Guest friction check: no gate anywhere — `route()`'s room-null → home logic (main.ts:283) is
untouched; auth UI is purely additive on HOME.

---

## 8. Supabase migration story

- Every new table maps 1:1: TEXT UUID PK → `uuid`, ISO TEXT → `timestamptz`, INTEGER 0/1 →
  `boolean`. No AUTOINCREMENT in the new surface. CHECKs and the `lower(username)` unique
  expression index port verbatim (or swap to `citext`); declarative FKs become real.
- Auth: `accounts` splits into Supabase `auth.users` + a public profiles-style table. Argon2id
  hashes: if GoTrue's import doesn't accept them, lazy-migrate (verify against the stored hash
  on first login post-migration, then set the password in Supabase Auth and null the local
  hash) — the optional `email` column exists for the reset-flow alternative. Guests map to
  Supabase anonymous sign-ins; `guest_client_id` remains an app-table column driving the same
  mint idempotency.
- `account_sessions` is deleted outright — Supabase JWTs replace it; the wire `authToken`
  becomes the Supabase access token (wire shape stable).
- RLS sketch: `profiles`/`titles`/`account_titles`/`account_stats` world-readable,
  owner/server-role-writable; `friends` visible where `auth.uid() IN (account_id, friend_id)`.
- All account queries are confined to `accounts.ts` — the Postgres swap touches one module
  plus db.ts.
- Legacy integer-keyed tables (`runs`, `run_seats`) migrate in a later push;
  `run_seats.account_id` (TEXT uuid) is already the correct foreign shape.

---

## 9. Test plan (bun test from repo root; typecheck via `bun run typecheck`)

Patterns honored: unit DB tests set `GAME_DB_PATH=":memory:"` + `GAME_SKIP_SEED=1` **before**
a dynamic import (db.test.ts precedent); integration uses `coop-harness.ts` (real server,
real ws, in-memory DB). The J1–J6 journeys (§4.1) are the acceptance scenarios the integration
suite must collectively cover.

**shared/src/__tests__/progression.test.ts**
- `xpToReachLevel(1) === 0`; known values (2→100, 5→1000, 10→4500); throws on level 0 /
  non-integer / negative xp.
- Property: for xp 0..50_000 (step 7), `levelForXp(xp)` equals a linear-scan reference; exact
  boundary behavior at every threshold ±1.
- `expeditionSlots`: 1→2, 4→2, 5→3, 9→3, 10→4 (locked formula).
- `earnedTitleIds` threshold edges (24 vs 25 hexes; level pseudo-stat at 4 vs 5); `titleById`
  throws on unknown id.

**server/src/__tests__/accounts.test.ts** (unit; calls `seedTitles()` explicitly)
- Guest mint idempotent per clientId; distinct clientIds → distinct accounts; mint backfills
  pre-existing `run_seats.account_id` (seed a NULL-account seat row first); simulated
  unique-race (insert conflict) resolves to one account.
- Claim: sets username preserving casing / clears `guest_client_id` / `is_guest=0`; second
  claim → NOT_A_GUEST; case-insensitive USERNAME_TAKEN ("Bob" vs "bob"); password roundtrip
  via `Bun.password.verify`.
- Sessions: validate happy path; expired rejected; revoked (logout) rejected; sliding expiry
  extends; `purgeExpiredSessions` deletes only expired; raw token never stored (only sha256).
- Logout→guest: same device re-resolves the SAME prior guest via `guest_client_id`; a claimed
  account is never resolved sessionlessly.
- Friends: request/accept/decline/remove/list both directions; reciprocal-pending auto-accept;
  self/duplicate rejected; guest sender → CLAIM_REQUIRED.
- Stats/XP/titles: `bumpStat` upsert math; `awardXp` totals; `evaluateTitles` grants
  `greenhorn` at encounters_won=1, `veteran` at level 5, and is idempotent; `equipTitle`
  rejects unowned.
- `upsertRunSeat` throws on bot + non-null accountId; `setSeatAccountIfNull` fills NULL and
  never overwrites a non-NULL account_id.

**server/src/__tests__/db-migration-idempotency.test.ts**
- Spawn `bun -e 'await import("<abs>/server/src/db.ts")'` twice via `Bun.spawn` against the
  same tmp-file `GAME_DB_PATH`; assert exit 0 both times and `user_version === 6` — proves the
  v6 block is re-runnable against a populated DB (module cache makes in-process re-import
  meaningless, hence subprocesses).

**server/src/__tests__/coop-integration.test.ts additions** (harness)
- hello (no token) → `welcome.auth` (guest, token); second connection with same clientId +
  that token → same accountId; same clientId, no token → same guest (J1/mint idempotence).
- Presenting a garbage token → `welcome.auth.authRejected === "invalid"` with a usable guest
  identity; a seat previously attributed to a claimed account keeps its account_id after an
  authRejected auto-reclaim (never-overwrite proof).
- `claimAccount` over ws → authState isGuest:false (J2); `login` while seated → `AUTH_IN_ROOM`;
  login from a second clientId → same account (J3), and a befriended observer receives a
  `friendsList` push with `online` flipped (presence).
- Lobby chat: `chatSend` broadcast to all seats; reconnect receives `chatHistory`; `chatSend`
  during combat → `BAD_PHASE`; 6th message in 10s → `RATE_LIMITED` (J5).
- XP end-to-end: create/join → start → move → `debugWin` → private `xpAward` amount 25 +
  `titlesEarned ["greenhorn"]`; next `roomState` SeatInfo carries level; `getProfile` shows
  xp+25 and encountersWon+1; `debugLose` (fresh run) → wipes+1.
- `friendInvite` → target's room-less socket receives `roomInvite` with the right code; Join
  seats them (J4).
- SeatInfo of bot-filled seats has null accountId/level/equippedTitleId.

**server/src/__tests__/coop-lifecycle.test.ts addition + regression clause**
- `reconstructRoomForRun` rehydrates `seat.accountId` from `run_seats.account_id`, and
  `connectSeat` backfills a NULL row on resume (J6).
- **Regression**: the existing coop-lifecycle/coop-integration suites must pass with only
  mechanical hello/joinRoom shape updates (displayName removal, welcome.auth presence) —
  HMAC seat reclaim, force-takeover, and crash-recovery behavior are asserted unchanged.
