# Multiplayer Co-op PVE — Final Architecture Spec (branch `multiplayer-coop`)

## 0. Summary & the one rule everything hangs on

We convert a single-seat, mode-switched game (pvp/duel/pve) into a single co-op PVE mode: a **Room** of 2–4 **seats** (each seat = one human or one bot, owning exactly one hero entity), a shared free **player phase**, an AI **enemy phase**, a shared hex overworld with vote-based movement, per-seat bags, and token-based reconnect/reclaim.

**The combat resolver in `shared/src/combat/*` stays pure, deterministic, RNG-free, and has zero module-level state. We do not change that.** The only `shared` data-model change to the serialized snapshot is one **optional plain string `controllerId` on `Entity`** (it round-trips for free because `serialization.ts` copies entities whole). All seat/ready/phase/vote/defend orchestration lives **server-side in `Room`** and travels in **separate, room-scoped messages** — never inside `GameState`.

`TeamId = "red" | "blue"` is unchanged and keeps its combat meaning: **`"red"` = the whole player party, `"blue"` = enemies.** Seat identity is a new axis (`controllerId`), orthogonal to team.

---

## 1. Resolved contradictions & high/critical findings (rulings)

These rulings are binding; the sections below implement them.

- **R1 — Where seat/ready/phase/defend state lives (CRITICAL, resolves the #1 cross-design contradiction).** It lives **only in `Room`** (server) and is broadcast in dedicated messages (`roomState` for lobby+roster, `coopStatus` for in-combat per-seat ready/phase/connection/pending-defends). **It is NOT a field on `GameState`.** We do **NOT** add `coop: CoopMeta` to `GameState`, and we do **NOT** add separate `phaseStatus`/`partyState`/`defendWaiting` messages on top — there is exactly one in-combat status message: `coopStatus`. Rationale: keeps the verified-pure resolver pure; avoids editing every `createGameState` call site; avoids the `serialization.ts` field-drop trap. The client reads phase from `coopStatus.phase` (authoritative) and friend/foe from `entity.teamId`, ownership from `entity.controllerId`.

- **R2 — `controllerId` only on `Entity` (HIGH/serialization).** Add `controllerId?: string` to `EntityCore`. It round-trips automatically (`serialization.ts` stores entities whole at lines 18/48). No `serialization.ts` change. No `GameState`-level field is added anywhere, so the field-by-field serializer is untouched.

- **R3 — `endTurn` stays in `PlayerAction` (HIGH).** `resolveEndTurn`, `ai-turn-runner.ts:170`, and 6+ resolver tests require it. We keep `{type:"endTurn"}` in the union and in `resolveAction`. We only stop **accepting it over the wire from clients** (router rejects it) — clients send `pass`/`unpass` instead. The server/AI issue `endTurn` internally as the phase-flip primitive.

- **R4 — One canonical wire protocol (CRITICAL).** All messages and DTOs live in **one** new file `shared/src/net/protocol.ts`, imported by client and server. SeatId format is **`"s0".."s3"`**. Message names are fixed in §3. `defendResult` carries `{ seatId, promptId, power }`. Nothing is implemented until this file exists (Phase 1).

- **R5 — Identity is server-authoritative (HIGH, seat-hijack).** The client persists a `clientId` (random UUID, localStorage). On `hello` the server mints/returns a **`sessionToken`** (HMAC or random secret) bound server-side to `clientId`+seat. Reclaim requires the matching `sessionToken` AND that the seat's current socket is dead/disconnected. **A reclaim of a seat whose socket is still live is rejected** (`SEAT_IN_USE`). The token never travels in the URL — only in the first `hello` message.

- **R6 — Duplicate tabs / same identity (HIGH).** Single owner-socket invariant: a seat has at most one live socket. A second live `hello`/`reclaim` for a token whose seat already has a live socket is **rejected with `SEAT_IN_USE`** (the new connection stays room-less and may explicitly force-takeover via `reclaimSeat{force:true}`, which closes the old socket and sends it `{type:"displaced"}`). No silent seat-steal.

- **R7 — Atomic phase transitions across `await` (CRITICAL).** The encounter build is async (`EncounterSession.createEncounter` awaits mask/collision loading). Before the first `await`: synchronously set `room.phase="combat"`, `room.building=true`, `room.vote=null`, snapshot **all** seat loadouts into an immutable `SeatBuildSpec[]`, and bump `room.generation`. After the `await`, re-validate the room still wants this build (`generation` unchanged, not disposed) before assigning `room.session`. Any room-scoped message arriving while `room.building` is true is rejected/queued. This kills the double-EncounterSession race, the equip-mid-build race, and the action-during-build race in one move.

- **R8 — Single phase-end latch (HIGH).** `Room.maybeEndPlayerPhase()` is the **only** site that issues the player→enemy `endTurn`. It is guarded: it no-ops unless `room.phase==="combat" && coopPhase==="player" && session.state.activeTeam==="red" && !room.phaseTransitioning`. It sets `phaseTransitioning=true` before the flip and clears it when the enemy phase later flips back. Disconnect-auto-ready, `pass`, `action`, and the bot-burst-done callback all route through this one evaluator — none call `endTurn` directly. The legacy per-action `shouldAutoEndTurn` auto-end block in `index.ts:422-427` is **deleted** (it would prematurely end the shared phase).

- **R9 — Disconnect mid-phase drives the seat once (HIGH, deadlock).** The bot burst runs once at `startPlayerPhase`. When a seat flips human→bot **after** the burst (mid-phase disconnect), the Room immediately calls `runHero(seatHeroId)` for that single seat and then marks it ready, then routes through `maybeEndPlayerPhase()`. A seat that becomes a bot never silently stalls the phase.

- **R10 — Reclaim vs ready / vs burst / vs phase boundary (HIGH, transition table).** Hard rules (no longer "optional"):
  - Reclaim only flips control + drops the brain **at a message boundary** AND only when no bot burst is synchronously executing (the burst is a sync loop, so it always is at a boundary) and not while `room.phaseTransitioning`.
  - On bot→human reclaim during an **open** player phase (`activeTeam==="red" && !phaseTransitioning`): clear `seat.ready` **iff** `!seat.actedThisPhase` AND the hero still has an affordable action. Always recompute `seat.exhausted`. If `seat.actedThisPhase` (the bot already consumed the turn) or `exhausted`, the human inherits the passed/exhausted seat and spectates until the next player phase.
  - If the phase already ended (enemy phase or transitioning), reclaim never clears ready; human spectates.
  - `seat.actedThisPhase` is a new per-seat flag, set true whenever any action resolves for that seat's hero (human or bot), reset in `startPlayerPhase`.

- **R11 — Defend round is the single per-target authority (HIGH).** A `DefendRound` on the Room owns each prompt's status (`pending | answered`). Bot/disconnected targets are **not** auto-resolved synchronously at round build; they get a server-authoritative per-round **timeout** (default 6000ms) that auto-fills neutral (multiplier 1.0). A `defendResult` for a non-`pending` target is rejected with an ack. On disconnect of a seat in the round: it stays `pending` (the timeout covers it) — we do not special-case it, removing the build-time-vs-disconnect race. On reclaim, only still-`pending` prompts are re-sent. `session.resolveDefend(...)` is called **exactly once**, guarded by a `round.resolved` boolean, when all prompts are non-`pending`. The runner's `pendingDefend` gains a `promptId`/round id so a stale `defendResult` is matched and dropped.

- **R12 — `heroBrains` is derived, never independently mutated (HIGH/MED, double-drive).** `heroBrains` is **rebuilt from seat controllers** at every `startPlayerPhase` and `startEnemyPhase` (`set` iff `controller.kind==="ai"`, else delete). The two stores (`seat.controller.kind` and `heroBrains` membership) can never drift. On reclaim of the currently-driven entity, abort its remaining queued `currentActions` in the runner.

- **R13 — DB split: GLOBAL community discovery + PER-RUN cleared — SUPERSEDED by §11 (Durable Persistence) and corrected by the discovery/cleared split.** DISCOVERY (the community fog-of-war) is **GLOBAL per dimension**, permanent, append-only, and shared by ALL runs/rooms — discovering a never-before-seen hex is a key moment. CLEARED-THIS-RUN (the party's combat progress this expedition) is **PER-RUN** and gates free-move vs combat. The earlier "run-scoped `explored_hexes`" wording was WRONG (it run-scoped discovery); v3 splits them: `discovered_hexes(dimension_id,q,r)` / `discovered_hex_icons(dimension_id,q,r)` (global) and `run_cleared_hexes(run_id,q,r)` (the durable `visitedThisRun`). Two concurrent rooms in the same dimension SHARE the community map but each re-fights its own path. Per-seat inventory and the run are durable across restart (see §11). We accept a one-time wipe of the old run-scoped exploration tables (documented in PR).

- **R14 — Host model is mutable (HIGH).** `Room.hostSeatId: SeatId | null` (mutable; the overworld design's `readonly hostToken` is rejected). `migrateHost()` runs on **every** human disconnect regardless of phase: host moves to the lowest-index connected human, or `null` if none. Host-gated messages (`startGame`, `reset`, `debugWin`) no-op with `NOT_HOST` when `hostSeatId===null` or sender isn't host. The idle reaper handles a host-less room.

- **R15 — Vote electorate frozen + server-authoritative (MED).** `MovementVote` snapshots the set of **connected human seatIds** at proposal time into `electorate`. Resolution math is over `electorate` only; clients never resolve locally (they render `voteState` and react to `moveResolved`). A mid-vote disconnect drops that ballot and recomputes against the frozen `electorate` (the disconnected seat simply never votes; timeout treats it as abstain). **Proposer disconnect cancels the vote.** Tie-break: proposer's vote wins (proposer auto-votes yes, so an even split → move). Single human → instant resolve on propose.

- **R16 — Player-bot burst is reconnect-safe by construction; friendly-fire defend handled (MED).** The burst is a synchronous `driveAiSteps` loop (no `await`), so reclaim can only land at its boundaries. If a red bot's attack would hit a **human-owned red** hero (friendly fire), the burst pauses on a real defend prompt; in that case we **release `aiPlayerBusy`** while awaiting the human `defendResult`, then resume, and `maybeEndPlayerPhase()` tolerates a not-yet-`done` burst. (Enemy bots target `"blue"` only; player bots' `promptsDefense` predicate prompts only for human-owned red targets.)

- **R17 — Reset/debugWin generation guard (MED).** `room.generation` is bumped on every session teardown/build. `driveAiSteps`, `resolveDefend`, vote resolve, and defend-round resolve all capture the generation at entry and no-op if `room.generation` changed (superseded session). `reset`/`debugWin` abort any open `DefendRound`.

- **R18 — Client snapshot ordering & no-op ack (HIGH, scalability/desync).** Add a monotonic guard in `CombatStore.handleState`: ignore any snapshot whose `state.actionCount < currentDisplay.actionCount` (use the already-present `actionCount`). Replace the global no-op-ack-clears-the-queue behavior: a rejected/no-op action for one seat is acked via a **targeted `actionRejected{seatId}`** message that unlocks only that seat's per-seat submit lock — it does **not** flush the shared animation queue or snap the board. Full `state` snapshots remain the authoritative board; the queue only collapses when the incoming `actionCount` is strictly ahead and nothing is mid-animation.

- **R19 — Idle reaper / timer teardown (MED).** `Room.dispose()` clears all room timers (reap, vote, defend), drops every seat's token binding, and removes the room+code in one synchronous block. Reclaim cancels a pending reap timer. On reconnect, a `tokenIndex` hit whose room is missing is treated as "no room" (fall to lobby), never dereferenced. Vote/defend resolvers no-op if `rooms.getByCode(code)` no longer returns this instance (the R17 generation/instance check).

- **R20 — Room codes (MED).** One format: **6 chars** from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I/O/0/1). `freshCode()` caps retries (e.g. 50) and returns `ROOM_CREATE_FAILED` on exhaustion. Reaped codes go into a short quarantine TTL longer than the idle window before reuse, so a stale invite resolves to `ROOM_NOT_FOUND` rather than a stranger's room. Per-token create rate-limit (simple in-memory counter).

- **R21 — Capacity / join state machine (MED).** Seats carry an explicit `state: "open" | "human-connected" | "human-disconnected" | "bot"`. Capacity = total seats (fixed at create, 2–4). Joinable = `state==="open"` only, lobby only. Post-Start there are no `open` seats. A new (unknown-token) join to a started room → `ALREADY_STARTED`, socket left room-less (no spectator concept — the test-design's "spectator" assertion is removed). Disconnected-human seats are reclaim-only and never appear as `open`. The check-then-flip is synchronous (build inventory into a local, commit synchronously — no `await` between check and flip).

- **R22 — Handshake (MED).** Token arrives only in the `hello` message; `?token=` is never read. `?dim=` stays as an asset-preload hint only. The router hard-rejects every gameplay/seat-scoped message with `BAD_PHASE`/`NOT_YOUR_SEAT` until `hello` has bound the socket.

- **R23 — Test runner (MED).** Standardize on `bun test`. Migrate the 6 vitest-style imports to `bun:test` (API-compatible). `shared/package.json` `test` → `bun test`; add root `"test": "bun test"`. `bun scripts/sim-battle.ts` stays a CI exit-0 smoke gate. Add `GAME_DB_PATH` env to `db.ts` (default `hex-discovery.sqlite`); harness sets `:memory:` before dynamic-importing the server.

- **R24 — `controllerId` stamped via post-build spread (LOW).** Set in `placeEncounterEntities` via spread (`{...entity, controllerId}`), matching the existing `playerAnimSet` pattern, so `makeEntity`'s many call sites are untouched. Enemies leave `controllerId` undefined.

- **R25 — Deletion sequencing (LOW).** `placePvpEntities`/`placePveEntities` are deleted in the **same commit** that removes the duel/pvp/pve branches of `EncounterSession.create` (their only importer). `buildScenarioMap`/`createCombatGrid` are KEPT (sim-battle + hero-arena depend on them). `FIGHTER_TEMPLATE` import in `encounter-session.ts` is dropped only if the duel roster was its sole user there (it is; other `FIGHTER_TEMPLATE` users are in hero-arena and untouched).

- **R26 — Loadout scope (MED, product).** v1 ships with **lobby loadout editing** (`InventoryScreen` in "loadout" mode for one's own seat pre-Start) so the PR is functionally complete. Equip is allowed only while `room.phase!=="combat"`. (If descoped, see Unresolved Decisions.)

- **R27 — Solo & boot (HIGH).** Solo = create a room (capacity ≥ 2), press Start with only the host present; server bot-fills seats `1..N-1`. Start is allowed with one human. The `index.ts` global-deletion + Room rewrite is **one atomic commit** (the file is monolithic; you cannot half-delete the globals and keep a green build).

- **R28 — AFK / defend timeouts (MED).** Server-authoritative: per-seat AFK auto-pass timer in the player phase (default 90s) so one idle human can't deadlock `maybeEndPlayerPhase()`; per-round defend timeout (R11). `protocolMismatch` close path gets a concrete client banner in `main.ts`. Reconnect grace before human→bot flip: **3s hold** to ride flaky connections (R28 grace timer; the seat shows `human-disconnected` immediately to peers, flips to `bot`-driven after 3s if no reconnect).

---

## 2. Seat + Room model (server)

### 2.1 Files
- `server/src/room.ts` (NEW): `Room`, `Seat`, types, lifecycle helpers, the combat phase machine, the vote machine, the defend-round machine, dispose().
- `server/src/room-registry.ts` (NEW): `RoomRegistry` + singleton `rooms`; code index + quarantine; `tokenIndex: Map<sessionToken, RoomCode>`.
- `server/src/index.ts` (REWRITE, one commit): WS handlers route into rooms.

### 2.2 Types
```ts
export type SeatId = "s0" | "s1" | "s2" | "s3";   // string at runtime, "s{index}"
export type RoomCode = string;                    // 6-char A-Z2-9
export type SessionToken = string;                // server-minted secret
export type CoopPhase = "player" | "enemy";

export type SeatState = "open" | "human-connected" | "human-disconnected" | "bot";

export interface Seat {
  readonly seatId: SeatId;                 // === entity.controllerId for this seat's hero
  readonly heroEntityId: EntityId;         // stable: `${seatId}-hero`, e.g. "s0-hero"; bound for the room's life
  state: SeatState;
  socket: ServerWebSocket<SocketData> | null;
  sessionToken: SessionToken | null;       // server-minted; owner identity for reclaim
  clientId: string | null;                 // localStorage UUID the token maps to (diagnostics)
  brain: HeroController | null;            // present iff state==="bot" (or disconnected-driving)
  inventory: InventoryState;               // per-seat bag (in-memory)
  animSet: AnimSet;
  displayName: string;
  // combat orchestration (player phase)
  ready: boolean;                          // passed this player phase
  exhausted: boolean;                      // recomputed: hero dead or no affordable action
  actedThisPhase: boolean;                 // any action resolved for this hero this phase
  disconnectGraceTimer: Timer | null;      // 3s hold before bot flip
  afkTimer: Timer | null;                  // auto-pass idle human
}

export type RoomPhase = "lobby" | "overworld" | "combat" | "gameover";

export interface Room {
  readonly code: RoomCode;
  hostSeatId: SeatId | null;               // mutable (R14)
  phase: RoomPhase;
  building: boolean;                       // true across the encounter-build await (R7)
  phaseTransitioning: boolean;             // latch for player->enemy flip (R8)
  generation: number;                      // bumped on session teardown/build (R17)
  coopPhase: CoopPhase;                    // mirrors activeTeam, server-side only
  aiPlayerBusy: boolean;                   // bot-burst window (R16)

  dimensionId: number;
  runId: number;
  hexMap: HexMapState;                     // shared; playerPos === party position
  visitedThisRun: Set<string>;
  pendingHex: HexCoord | null;

  capacity: number;                        // 2..4, fixed at create
  seats: Seat[];                           // length === capacity, index-stable

  session: EncounterSession | null;        // null off-combat
  defendRound: DefendRound | null;
  vote: MovementVote | null;

  reapTimer: Timer | null;
  lastActivityMs: number;
}
```

### 2.3 SocketData (slimmed)
```ts
interface SocketData {
  clientId: string;            // from hello
  sessionToken: SessionToken;  // minted at hello, bound server-side
  roomCode: RoomCode | null;
  seatId: SeatId | null;
}
```
At upgrade: `data = { clientId:"", sessionToken:"", roomCode:null, seatId:null }`. Identity is set in the `hello` handler, never from query params (R22).

### 2.4 What stays in the pure resolver vs the Room (explicit boundary)
- **Pure resolver (`shared/src/combat/*`) — UNCHANGED:** `resolveAction`, `resolveEndTurn` (red↔blue flip), `isActionLegal`, `startTurn`, `checkWinner`, damage/zones/effects, `shouldAutoEndTurn` (kept only as the regression shim for the `endTurn` action; never called in the live free-phase path). Reads only `teamId`, `dead`, `activeTeam`, energy, abilities, position, zones. **Never reads `controllerId`.**
- **Additive pure helper** in `ability-cost.ts`: `entityHasAffordableAction(e)`; reimplement `shouldAutoEndTurn` over it. Used by `Room.recomputeExhausted`.
- **Server-side Room — ALL orchestration:** seat→controller mapping, ready/pass/exhausted/actedThisPhase, the `player`/`enemy` phase machine, the single `endTurn` issuance, bot-seat driving, defend-round aggregation + timeout, vote machine, reconnect/host migration, per-seat inventory, generation/build/transition latches.

---

## 3. Wire protocol — `shared/src/net/protocol.ts` (single source of truth, R4)

`PROTOCOL_VERSION = 1`. Discriminated unions `ClientMessage` / `ServerMessage`. SeatId = `"s0".."s3"`.

### DTOs
```ts
export interface SeatInfo {
  seatId: SeatId; state: SeatState; isHost: boolean;
  displayName: string; heroEntityId: string | null;
  ready: boolean;                            // lobby: ready-to-start; combat: passed
  loadoutSummary?: { equippedIds: string[] };
}
export interface RoomStatePayload {
  protocolVersion: number; code: RoomCode; phase: RoomPhase;
  hostSeatId: SeatId | null; capacity: number;
  seats: SeatInfo[]; yourSeatId: SeatId | null;
  runId: number; dimensionId: number;
}
export interface SeatCombatStatus {
  seatId: SeatId; heroEntityId: EntityId; controller: "human" | "ai";
  connected: boolean; ready: boolean; exhausted: boolean; displayName: string;
}
export interface PendingDefendInfo { promptId: string; seatId: SeatId; targetEntityId: EntityId; answered: boolean; }
export interface CoopStatusPayload {                 // in-combat status, NOT in GameState (R1)
  phase: CoopPhase; seats: SeatCombatStatus[]; pendingDefends: PendingDefendInfo[];
}
export interface VoteStatePayload {
  proposalId: string; proposerSeatId: SeatId; target: HexCoord;
  votes: Record<SeatId, "yes" | "no">;             // cast human ballots only
  electorate: SeatId[];                            // frozen connected-human set
  deadlineMs: number;
}
export type ErrorCode =
  | "PROTOCOL_MISMATCH" | "ROOM_NOT_FOUND" | "ROOM_FULL" | "ALREADY_STARTED"
  | "NOT_HOST" | "NOT_YOUR_SEAT" | "SEAT_IN_USE" | "BAD_PHASE"
  | "INVALID_MOVE" | "NO_OPEN_PROPOSAL" | "ROOM_CREATE_FAILED" | "MALFORMED";
```

### Client → Server
1. `hello { protocolVersion, clientId, displayName? }`
2. `createRoom { capacity:2|3|4, dimensionId? }`
3. `joinRoom { code, displayName? }`
4. `reclaimSeat { code, seatId, force?:boolean }`
5. `leaveRoom {}`
6. `setReady { ready }`                         (lobby readiness)
7. `startGame {}`                               (host)
8. `proposeMove { target }`
9. `castVote { proposalId, vote:"yes"|"no" }`
10. `action { seatId, action: PlayerAction }`   (PlayerAction `endTurn` is rejected by router, R3)
11. `pass {}` / `unpass {}`
12. `defendResult { seatId, promptId, power }`
13. `equip { bagIndex }` / `unequip { equippedIndex }` / `updateAttachment { itemId, attachment }`  (seat resolved from socket)
14. `reset {}` (host) / `debugWin {}` (host, dev)

### Server → Client
1. `welcome { protocolVersion, sessionToken, reconnected?: { code, seatId } }`
2. `protocolMismatch { serverVersion, clientVersion }`  (then close)
3. `displaced {}`                               (your seat was force-taken-over; R6)
4. `roomState { room: RoomStatePayload }`       (lobby + roster + phase; broadcast on any roster/phase change)
5. `hexMapState { hexMap }`                     (shared; room-broadcast)
6. `voteState { vote: VoteStatePayload | null }`
7. `moveResolved { proposalId, accepted, target }`
8. `combatStart { encounterHex }`
9. `state { state: SerializedGameState, events }`  (snapshot carries `entity.controllerId`; NO coop block)
10. `coopStatus { coop: CoopStatusPayload }`    (in-combat per-seat status; sent on every transition; R1)
11. `defendPrompt { promptId, seatId, targetEntityId, attackerId, attackerPosition, aimDirection, ability }`
12. `actionRejected { seatId }`                 (per-seat unlock; replaces global no-op snap; R18)
13. `combatEnd { won }`                         (animation gate)
14. `gameOver { outcome:"victory"|"defeat" }`
15. `inventory { inventory }`                   (to the owning socket only)
16. `error { code, message, recoverable }`

### Deleted
`?mode=` URL + `GameMode`; `team` message; `hexMove`; client `action{type:"endTurn"}`; `hexCombatStart`/`hexCombatResult` (→ `combatStart`/`combatEnd`+`gameOver`).

---

## 4. Combat phase model (server-side Room machine)

`activeTeam` (resolver) is the source of truth for which side acts; `room.coopPhase` mirrors it for messaging. The free player phase sits on top.

### startPlayerPhase()
1. `coopPhase="player"` (activeTeam already "red" from `createGameState` or the enemy-phase flip-back).
2. Rebuild `heroBrains` from seat controllers (R12).
3. For each seat: `ready=false`, `actedThisPhase=false`, `recomputeExhausted(seat)`; arm `afkTimer` for connected humans.
4. `aiPlayerBusy=true`; collect bot seat hero ids in seat order; `session.startAiTurn({kind:"playerBots", entityIds})`; `driveAiSteps(room)` (sync; may pause only on friendly-fire defend, R16). On each driven action set `actedThisPhase=true` for that seat. On `done`, mark every bot seat `ready=true`; `aiPlayerBusy=false`.
5. `maybeEndPlayerPhase()`.

### Human action / pass / disconnect-auto-ready
- `action`: reject unless `phase==="combat" && coopPhase==="player" && !room.building && action.entityId===seat.heroEntityId && !aiPlayerBusy && !seat.ready`. Apply via `session.applyAction`; on `changed` set `seat.actedThisPhase=true`, re-arm afk timer, recompute exhausted, broadcast `state` + `coopStatus`; if `winner` → `endCombat`; else `maybeEndPlayerPhase()`. On no-op → `actionRejected{seatId}` to that socket only (R18).
- `pass`/`unpass`: set `seat.ready`; `unpass` only valid while phase open and `!exhausted`; broadcast `coopStatus`; `maybeEndPlayerPhase()`.
- Disconnect mid-phase → seat becomes bot after grace (R28); on flip, `runHero(seat.heroEntityId)`, set `ready=true`, broadcast, `maybeEndPlayerPhase()` (R9).

### maybeEndPlayerPhase() (the single latch, R8)
```
if !(phase==="combat" && coopPhase==="player" && session.state.activeTeam==="red" && !phaseTransitioning && !aiPlayerBusy) return;
if not every seat (ready || exhausted) return;
phaseTransitioning = true;
session.applyAction({type:"endTurn"});        // red -> blue (the ONLY player->enemy flip)
coopPhase = "enemy"; broadcast state + coopStatus;
startEnemyPhase();
```

### startEnemyPhase()
Rebuild heroBrains; `session.startAiTurn({kind:"enemyPhase", team:"blue"})`; `driveAiSteps(room)` (pauses on `defendPrompt` → DefendRound). When the enemy sweep's terminal `endTurn` flips blue→red, `phaseTransitioning=false`, `startPlayerPhase()`.

### driveAiSteps(room) — generation-guarded (R17)
Capture `gen=room.generation`. Loop `session.stepAi()`; on `events` broadcast `state`; on `defendPrompt` open/extend the `DefendRound` and return; on `done` continue/finish. No-op return if `room.generation!==gen` (superseded by reset/rebuild).

---

## 5. Defend routing (DefendRound, R11)

```ts
interface DefendRound {
  readonly generation: number;
  attackerId; attackerPosition; aimDirection; ability;
  targets: Array<{ promptId: string; entityId: EntityId; seatId: SeatId; status: "pending"|"answered"; power: number }>;
  resolved: boolean;
  timeout: Timer;                 // server-authoritative, ~6000ms
}
```
- On enemy `defendPrompt {targetIds}`: build one target row per `(seatId, entityId)`. For each, send `defendPrompt` to that seat's live socket if human-connected; bot/disconnected targets stay `pending` and rely on the timeout. Broadcast `coopStatus` (with `pendingDefends`) so others render "waiting on X".
- `defendResult {seatId, promptId, power}`: accept only if the matching target is `pending`; set `answered`, record power; else ack (drop).
- When all targets non-`pending` (answered or timed-out) and `!resolved` and `generation` matches: set `resolved=true`, build the per-entity power map, call `session.resolveDefend(map)` **once**, then resume `driveAiSteps`.
- Timeout fires: any still-`pending` target → power = neutral (1.0 multiplier), then resolve as above.
- Reset/debugWin abort the round (clear timeout, `resolved=true`, drop).

Player-phase friendly-fire (R16): if a player bot's attack prompts a human-owned red target, the same DefendRound is built but `aiPlayerBusy` is released while awaiting; resume re-enters the burst.

---

## 6. Overworld / shared run / vote (R13, R15)

### Movement vote
```ts
interface MovementVote {
  readonly proposalId: string;
  readonly proposerSeatId: SeatId;
  readonly target: HexCoord;
  readonly electorate: SeatId[];               // frozen connected-human seats at propose time
  ballots: Map<SeatId, "yes"|"no">;            // proposer pre-set "yes"
  deadline: number;                            // ~15s
  timer: Timer;
}
```
- `proposeMove`: valid only in `overworld`, no open vote, `isAdjacent` + visible target. Single human → resolve immediately. Else open vote, proposer auto-yes, broadcast `voteState`.
- `castVote`: record into `ballots` (only if seat ∈ electorate). Recompute.
- Resolution over `electorate` only (R15): YES when `yes > floor(|electorate|/2)`; tie (`yes===no`, even electorate) → YES (proposer). NO otherwise. Resolve when all electorate voted OR deadline; timeout treats non-voters as abstain (resolve on cast ballots, proposer breaks ties). Mid-vote disconnect drops that ballot; **proposer disconnect cancels** the vote.
- YES + visited hex → move party `playerPos`, broadcast `hexMapState`. YES + unexplored → **R7 atomic combat entry** (see §7). NO/cancel → clear vote, `voteState:null`.

### Combat entry (R7 atomic)
```
synchronously:
  room.phase="combat"; room.building=true; room.vote=null; room.pendingHex=target;
  room.generation++;
  const specs = room.seats.map(seatToBuildSpec);   // immutable snapshot of loadouts
const gen = room.generation;
const session = await EncounterSession.createEncounter({ seats: specs, hexType, hexCoord:target, runId, dimensionId });
if (room.generation !== gen || room.phase!=="combat") return;   // superseded; discard
room.session = session; room.building=false; room.coopPhase="player";
bind seat.heroEntityId already known (stable); set seat hero controllerId === seatId (done in builder);
broadcast combatStart + state + coopStatus;
startPlayerPhase();
```
Equip is rejected when `phase==="combat"`; because the flip is synchronous and pre-await, an equip arriving in the await gap is correctly rejected (R7).

### Combat end
On `winner`: `combatEnd{won}` broadcast (animation gate). If `won && pendingHex` → `exploreHex(room, pendingHex)` (global discovery + per-run cleared + party advance, atomic), `phase="overworld"`, broadcast `hexMapState`; if that was the **first-ever** discovery in the dimension, broadcast `hexDiscovered{coord}` (a celebratory KEY MOMENT the client banners). Else `resetToOrigin(room)` (new run — does NOT re-seed the global community map). If party wiped on a run-ending condition → `gameOver`. Bump `generation`, tear down `session`.

### DB (R13)
`db.ts`: `DB_PATH = process.env.GAME_DB_PATH ?? "hex-discovery.sqlite"`. Migration at `user_version < 3`: `ALTER runs ADD dimension_id/capacity/host_client_id/active/party_q/party_r/...`; DROP the old run-scoped `explored_hexes`/`explored_hex_icons`; CREATE `discovered_hexes(dimension_id,q,r PK)` + `discovered_hex_icons(dimension_id,q,r PK)` (GLOBAL community discovery) and `run_cleared_hexes(run_id,q,r PK)` (per-run cleared = durable `visitedThisRun`). Discovery fns key by **dimension**: `discoverHex(dimensionId,coord): boolean` (true iff first-ever), `loadDiscoveredHexes(dimensionId)`, `saveDiscoveredHexIcon`/`loadDiscoveredHexIcons(dimensionId)`, `seedDiscovery(dimensionId,radius)` (idempotent). Cleared fns key by **run**: `markRunCleared(runId,coord)`, `loadRunCleared(runId)`, `clearRunCleared(runId)`. `commitExplore(dimensionId, runId, coord, icon): boolean` does discovery + icon + run-cleared + party_q/r in one transaction and returns the first-ever flag. `startNewRun(dimensionId, hostClientId?): number`.

---

## 7. Identity / reconnect state machine (R5, R6, R14, R19)

### hello
- Validate `protocolVersion`; mismatch → `protocolMismatch` + close.
- Mint `sessionToken = hmac(serverSecret, clientId + nonce)` (or random + server map). Store `tokenIndex` lookups server-side.
- If `tokenIndex` maps this client's prior token to a live room with a matching seat:
  - seat socket dead/disconnected → auto-reclaim: rebind socket, `state="human-connected"`, drop brain, cancel grace/reap, `welcome{reconnected:{code,seatId}}`, push `roomState` + (if combat) latest `state` (events:`[]`) + `coopStatus`.
  - seat socket still live → `welcome` with no reconnect; the client stays room-less; an explicit `reclaimSeat{force:true}` is required (closes old socket, sends it `displaced`). Without force → `SEAT_IN_USE` on reclaim (R6).
- Else `welcome` with no reconnect; client shows lobby.

### disconnect (close)
- Lobby: free seat to `open` (or migrate host / dispose if empty).
- Overworld/combat: set `state="human-disconnected"` immediately (broadcast roomState/coopStatus so peers see "dropped"), arm 3s grace (R28). On grace expiry without reconnect: flip to `bot` (install Sovereign brain, R12 derivation will also enforce at next phase), and if mid open player phase, `runHero` + ready (R9). Always `migrateHost()` (R14). If zero connected humans → arm reap.
- If the disconnecting seat is in an open `DefendRound`, leave its prompts `pending` (timeout covers it, R11). If proposer of an open vote → cancel vote (R15).

### reclaimSeat
- Validate `sessionToken` ↔ seat (R5). Reject `SEAT_IN_USE` if live socket and `!force`. On success rebind as in hello-reclaim. Apply R10 ready/exhausted rules.

### dispose (R19)
`Room.dispose()` clears reap/vote/defend/per-seat timers, deletes every seat token from `tokenIndex`, removes room from registry, pushes code into quarantine TTL. Called once from `rooms.remove`.

---

## 8. Client model

### Net
- `client/src/net/connection.ts` → `RoomConnection`: drop `team`; persist `clientId` (`getPlayerToken()` in new `player-token.ts`); on open send `hello`; resolve `ready()` on `welcome`; store `sessionToken`; handle `protocolMismatch` (banner) and `displaced`. Typed `send(msg: ClientMessage)`.

### Seat context
- `client/src/state/seat-context.ts` (NEW): `mySeatId`, latest `RoomStatePayload`, latest `CoopStatusPayload`. Helpers: `myHeroEntityId()`, `isMyEntity(id)`, `mySeat()`, `isHost()`, `coopPhase()`, subscribable.

### combat-ui-state.ts (seat-aware; replaces hardcoded "red", R26 grep-gate)
- `myHeroEntity(state, seat)`: `state.entities.get(seat.myHeroEntityId())`.
- `isPlayerPhase(seat)`: `seat.coopPhase()==="player"` (from `coopStatus`, R1) and no winner.
- `canMyHeroAct(state, seat)`: player phase && my hero alive && `!mySeat.ready && !mySeat.exhausted`.
- `canUseAbility(state, seat, entityId, abilityId)`: gate on `e.controllerId === seat.mySeatId` (ownership) + affordability. **No first-red-entity fallback remains.**
- New `InteractionState`: `idle | abilitySelected | aiming | attackTiming | defending{promptId} | submitting{action} | watching`. `submitting` locks only re-entry of my own hero; renderer is never gated on it.

### client-state.ts
- Inject `SeatContext`; subscribe to store + seat. `submitAction` → `submitting` (per-hero, not global). `reconcileWithGameState` clears `submitting` on any snapshot (R18 ordering guard applied in store). Selection guard uses `controllerId===mySeatId` (was `teamId!=="red"`). `endTurn()` → `passTurn()` = `setReady`/`pass`. `autoSelectPlayer` → `autoSelectMyHero`. `defending` carries `promptId`.

### combat-store.ts
- `dispatch` adds `seatId`. `handleState` adds the monotonic `actionCount` guard (R18). Handle `actionRejected{seatId}` to clear only my submit lock (no queue flush). The no-op-clears-queue path is removed.

### Renderers / UI
- `ability-bar.ts`: read `state.entities.get(seat.myHeroEntityId())` (was first red). End-Turn button → Pass (moves to PartyHud).
- `entity-renderer.ts`: keep team color/facing; add a distinct "my hero" ring when `controllerId===mySeatId`.
- NEW `lobby-screen.ts`: create/join by code, roster, per-seat ready, loadout button (opens InventoryScreen in loadout mode, R26), host-only Start.
- NEW `party-hud.ts`: per-seat portraits/HP/ready/bot/disconnected, "waiting on X" banner from `coopStatus`, Pass/Ready button, passive "X is defending".
- NEW `vote-panel.ts`: render `voteState` (tally over `electorate`, deadline), yes/no buttons; react only to `moveResolved`.
- `map-screen.ts`: click adjacent hex → `proposeMove` (no optimistic move); party token animates on `moveResolved`; disable while a proposal is open.
- `inventory-screen.ts`: own bag only; loadout mode pre-Start; close target by phase.
- `main.ts`: drop `?mode`; build `RoomConnection` + token + `SeatContext` + one store; register lobby(first)/map/combat/inventory + PartyHud + VotePanel; `roomState` drives `switchTo`; `defendPrompt` gated by `seatId` (run timer only for my seat) + `promptId` idempotency; keep `?mode=replay` dev path.

### Stores
- DELETE `remote-game-store.ts` and `LocalGameStore` (in `game-store.ts`; keep the `GameStore` interface + `Listener`). KEEP `ReplayStore` (replay heroes have no `controllerId` → spectator HUD, no PartyHud).

---

## 9. Testing strategy (R23)

- Runner: `bun test`; migrate 6 vitest imports; root + shared scripts updated; sim-battle CI smoke gate.
- DB isolation: `GAME_DB_PATH=:memory:` + dynamic server import in the harness.
- New pure unit tests: `phase.test.ts` (phase-end latch, exhaustion, dead seat, idempotent pass), `movement-vote.test.ts` (frozen electorate, tie-break, single human, timeout, disconnect mid-vote, proposer cancel), `determinism.test.ts` (serialize→deserialize fixed point incl. `controllerId`, action stream stability), `ai-turn-runner.test.ts` (single player-bot drive, no defend prompt bot-vs-enemy, friendly-fire prompt, restartability), `inventory.test.ts` (per-seat isolation).
- Integration: `coop-harness.ts` + `coop-integration.test.ts` (Bun.serve ephemeral port, multi-client) covering create/join/start-with-bot/shared-phase/ready-pass/enemy-phase/routed-defend(+AoE)/disconnect→bot/reclaim/win; plus negative identity tests (R5/R6: live-seat reclaim rejected, force-takeover sends `displaced`).
- Regression: keep `TeamId=red|blue` resolver semantics; keep `endTurn` action; the 6 existing `turn-resolver`/energy/status tests stay green unchanged (R3).

---

## 10. How each high/critical finding is closed (index)
R1/§4,§3 (state carrier); R2/§2.4,§3 (controllerId only); R3/§3,§4 (endTurn kept, router-rejected); R4/§3 (one protocol file); R5/R6/§7 (server token, live-seat reject, displaced); R7/§6 (atomic build); R8/§4 (single latch); R9/§4 (drive-on-disconnect); R10/§7 (reclaim rules + actedThisPhase); R11/§5 (DefendRound authority + timeout); R12/§4 (heroBrains derived); R13/§6 (run-scoped DB); R14/§7 (mutable host); R15/§6 (frozen electorate); R16/§4,§5 (burst friendly-fire); R17/§4 (generation guard); R18/§8 (actionCount guard + per-seat reject); R19/§7 (dispose); R20/§2 (codes); R21/§2,§7 (seat-state machine); R22/§2.3 (handshake); R23/§9 (runner); R24/§6 (spread); R25/§6 (deletion order); R26/§8 (lobby loadout); R27/§6 (atomic index rewrite, solo); R28/§4 (timeouts/grace).


---

## 11. Durable persistence & run-resume (supersedes R13)

The run / per-seat inventory / overworld layer is **durable across server restarts**. The in-combat
`GameState`/`EncounterSession`/`DefendRound`/`MovementVote` stay transient; a mid-combat server
death resumes the party **at the overworld departure tile** (the encounter is simply re-entered).

Full design — rulings **R13(rev) + R29–R36**, the resume/reconstruction algorithm, token verification
after restart, every durable write point, schema DDL, and the 22 stress-test findings (9 high/critical,
all resolved) — lives in **docs/multiplayer/PERSISTENCE.md**.

Headline:
- New/altered tables: `runs` (ALTER: dimension_id, capacity, host_client_id, active, party_q/r,
  created_at, updated_at, completed_at, outcome), `explored_hexes` (recreate, run-scoped, + `cleared`),
  `explored_hex_icons`, `run_seats`, `run_seat_items`, `run_seat_attachments`.
- Identity: HMAC session token salted per seat (`GAME_TOKEN_SECRET`); **seat lookup by raw `client_id`**
  in v1 (HMAC at-rest hardening deferred). No secret rotation in v1.
- Anti-split-brain: a transient `Map<runId, Room>` with check-or-throw `registerRoomForRun` (R30);
  two near-simultaneous reconnects reconstruct exactly one Room.
- Resume lands at `overworld` on `runs.party_q/party_r`; `visitedThisRun` rebuilt from the `cleared` set.
- v1 calls on the 4 open items (secret/​lookup/​housekeeping/​icons) are recorded at the top of PERSISTENCE.md.
