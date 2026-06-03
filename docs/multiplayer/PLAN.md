All paths absolute under `/home/ben/Projects/turn-based-game`. Each phase ends green (`bun test` + `bun run typecheck` + `bun scripts/sim-battle.ts` exit 0). Type-check with `bun run typecheck` only (never bare `tsc`). The work is one PR on branch `multiplayer-coop`.

## Phase 0 — Test runner + DB testability foundation (no behavior change)
- `shared/package.json`: `"test": "vitest run"` → `"bun test"`.
- `package.json`: add `"test": "bun test"`.
- Migrate the 6 vitest-import test files to `import {...} from "bun:test"` (bodies unchanged): `shared/src/__tests__/{zones,combat,collision-grid,footprint,vec2,turn-resolver}.test.ts`.
- `server/src/db.ts`: `const DB_PATH = process.env.GAME_DB_PATH ?? "hex-discovery.sqlite"`; wrap module-load seed/`seedDiscovery(15)` calls (in `server/src/index.ts:37-42`) so a harness can gate them (extract `initSeeds()` callable; keep auto-call for normal boot).
- Verify: `bun test` runs all 10 files green; typecheck clean.

## Phase 1 — Shared foundation: protocol + controllerId + pure helper (no-regret; current game still runs)
- NEW `shared/src/net/protocol.ts`: all DTOs + `ClientMessage`/`ServerMessage` unions + `PROTOCOL_VERSION` + SeatId/RoomCode/CoopPhase/SeatState (R4). Barrel-export from `shared/src/index.ts`.
- `shared/src/core/types.ts`: add `readonly controllerId?: string` to `EntityCore` (R2). Leave `PlayerAction` (incl. `endTurn`) and `GameState` unchanged (R3, R1).
- `shared/src/combat/ability-cost.ts`: add `entityHasAffordableAction(e)`; reimplement `shouldAutoEndTurn` over it (pure, additive).
- NEW `shared/src/__tests__/determinism.test.ts`: serialize→deserialize fixed point incl. `controllerId`; assert `controllerId` round-trips (no serialization.ts edit needed).
- Verify: typecheck + `bun test` green; existing server/client still compile and run (controllerId is optional/unused so far).

## Phase 2 — Faction/seat accessors on client (replace hardcoded "red"; still single-seat-compatible)
- NEW `client/src/state/seat-context.ts` (mySeatId/room/coopStatus holder; in single-seat fallback returns sensible defaults).
- `client/src/state/combat-ui-state.ts`: introduce `myHeroEntity`/`isPlayerPhase`/`canMyHeroAct`/`canUseAbility(controllerId)`; keep thin back-compat that, when no seat context is set, still resolves the lone red hero so the current game keeps working until Phase 6.
- `client/src/renderer/ability-bar.ts:171`, `client/src/renderer/entity-renderer.ts:252`: route through accessors (grep-gate every `=== "red"` / `activeTeam` site; classify is-me vs is-player-phase vs friend-foe color, R26/R18 client grep-gate).
- Verify: typecheck + `bun test`; manual smoke `bun scripts/sim-battle.ts` exit 0; current single-player flow unaffected.

## Phase 3 — Server Room scaffold + registry + run-scoped DB (compiles alongside old globals)
- `server/src/db.ts`: `user_version` migration to run-scoped `explored_hexes`; ALTER `runs`; add `runId` to every exploration fn; `startNewRun(dimensionId, hostToken?)`, `markRunInactive`, quarantine-free (R13). Update existing `index.ts` callers to pass a runId (still single global run for now).
- NEW `server/src/room.ts`: `Room`/`Seat`/`SeatState` types, `SeatBuildSpec` assembly, `buildDefaultInventory` (moved from index.ts), code gen (R20), `sovereignFor(seat)` (reuse `makeSovereign`+weights), `dispose()` (R19), helper stubs for phase machine / vote / defend (filled in Phase 5).
- NEW `server/src/room-registry.ts`: `RoomRegistry` + `rooms` singleton + `tokenIndex` + code quarantine (R19/R20).
- `shared/src/encounter/entity-factory.ts`: unchanged (controllerId stamped via spread in Phase 4, R24).
- Verify: typecheck (new files compile, not yet wired); `bun test` green; old server still boots.

## Phase 4 — Per-seat encounter builder + per-room EncounterSession + generalized AiTurnRunner
- `server/src/encounter-builder.ts`: `placeEncounterEntities(encounter, grid, seats: SeatBuildSpec[])` — one red hero per seat, `controllerId` via post-build spread (R24), formation spawns via `findWalkablePosition`; enemies unchanged.
- `server/src/encounter-session.ts`: add `static createEncounter({seats, hexType, hexCoord, runId, dimensionId})` (the co-op path). Add `start({kind:"enemyPhase",team}|{kind:"playerBots",entityIds})`, `runHero(entityId)`, `promptsDefense` dep wiring. Keep `heroBrains`. KEEP old `create()` paths temporarily so the old `index.ts` still compiles. (Deletion of pvp/duel happens in Phase 6.)
- `server/src/ai-turn-runner.ts`: generalize `start` to `RunnerMode`; add `promptsDefense(targetId)` predicate; `finishQueue()` (enemyPhase→endTurn, playerBots→done); add `promptId` to `pendingDefend` (R11); allow aborting `currentActions` for a reclaimed entity (R12).
- NEW `server/src/__tests__/ai-turn-runner.test.ts`: single player-bot drive; no defend prompt bot-vs-enemy; friendly-fire prompt; restartability.
- Verify: typecheck; `bun test` green (new runner tests + unchanged resolver tests).

## Phase 5 — Room combat machine: phase/ready/pass, defend round, vote machine (pure-side phase tests)
- `server/src/room.ts`: implement `startPlayerPhase`/`startEnemyPhase`/`maybeEndPlayerPhase` (R8/R9/R12/R16), `recomputeExhausted`, `actedThisPhase`, `aiPlayerBusy`, `phaseTransitioning`, `generation`, `building` (R7/R17), `driveAiSteps(room)` generation-guarded.
- `server/src/room.ts`: `DefendRound` machine + server timeout (R11); vote `MovementVote` machine with frozen electorate + tie-break + proposer-cancel + timeout (R15); `migrateHost` (R14); reclaim ready/exhausted rules (R10); AFK + disconnect-grace timers (R28); `dispose` wiring (R19).
- NEW pure modules + tests so the rules are unit-testable without a server:
  - `shared/src/combat/phase.ts` (pure `isPlayerPhaseOver(seatStates)`, exhaustion helpers) + `shared/src/__tests__/phase.test.ts`.
  - `shared/src/overworld/movement-vote.ts` (pure `resolveVote(ballots, electorate, proposer)`) + `shared/src/__tests__/movement-vote.test.ts`.
  - The Room calls these pure functions for its decisions.
- Verify: typecheck; `bun test` green (phase + vote unit tests). Server not yet rewired (old globals still live).

## Phase 6 — ATOMIC index.ts rewrite: delete globals/pvp/duel, wire Rooms end-to-end (R27)
ONE commit (the file is monolithic):
- `server/src/index.ts`: delete `GameMode`/`session`/`players`/`aiTeam`/`gameMode`, the `?mode=` branch, `open()`-time team assign + "Game is full". Add `rooms`. `open()` sets blank SocketData (no identity from query, R22). `message()` routes by scope: connection (`hello`/`createRoom`/`joinRoom`/`reclaimSeat`), seat (`action`/`pass`/`unpass`/`defendResult`/`equip`/`unequip`/`updateAttachment`/`setReady`), room (`startGame`/`proposeMove`/`castVote`/`reset`/`debugWin`/`leaveRoom`). Implement identity/reclaim/host-migration/dispose (R5/R6/R14/R19). Implement atomic combat entry (R7) and combat end (`combatEnd`/`gameOver`). `broadcastToRoom`/`sendToSeat`/`broadcastState`/`broadcastCoopStatus` helpers. Delete legacy auto-end block (R8). `debugWin`/`reset` generation-abort (R17).
- `server/src/encounter-session.ts`: DELETE `SessionMode` + pvp/duel/pve branches of `create()`; drop `placePvpEntities`/`placePveEntities`/`FIGHTER_TEMPLATE` (duel-only) imports — same commit (R25). `createEncounter` becomes the sole path. Register player-bot brains.
- `shared/src/maps/scenarios.ts`: DELETE `placePvpEntities`/`placePveEntities`; KEEP `buildScenarioMap`/`createCombatGrid` (R25).
- NEW `server/src/__tests__/coop-harness.ts` + `coop-integration.test.ts` + `inventory.test.ts` (full lifecycle + negative identity tests, R5/R6).
- Verify: typecheck; `bun test` green (integration harness exercises the real server end-to-end); sim-battle exit 0.

## Phase 7 — Client: RoomConnection, lobby, party HUD, vote UI, per-seat input; delete dead stores
- `client/src/net/connection.ts` → `RoomConnection` (drop team, send `hello`, `welcome` ready, `protocolMismatch`/`displaced`, typed send). NEW `client/src/net/player-token.ts`.
- `client/src/state/combat-store.ts`: `dispatch` adds `seatId`; `handleState` `actionCount` monotonic guard; handle `actionRejected`; remove no-op-clears-queue (R18).
- `client/src/state/client-state.ts` + `combat-ui-state.ts`: finalize seat-aware (remove the Phase-2 lone-red fallback); per-seat `submitting`; `passTurn`/`setReady`; `defending{promptId}`; `autoSelectMyHero` (R26 grep-gate complete).
- DELETE `client/src/state/remote-game-store.ts`; remove `LocalGameStore` from `client/src/state/game-store.ts` (keep interface). KEEP `ReplayStore` (spectator HUD).
- NEW `client/src/screens/lobby-screen.ts`, `client/src/renderer/party-hud.ts`, `client/src/renderer/vote-panel.ts`. Rework `map-screen.ts` (propose/vote), `combat-screen.ts`, `inventory-screen.ts` (own bag, loadout mode), `ability-bar.ts` (Pass moves to PartyHud), `entity-renderer.ts` (my-hero ring), `input-manager.ts` (gate via `canMyHeroAct`).
- `client/src/main.ts`: drop `?mode`; build RoomConnection+token+SeatContext+one store; register lobby(first)/map/combat/inventory + PartyHud + VotePanel; `roomState` drives screens; `defendPrompt` gated by seatId+promptId; keep `?mode=replay`.
- Verify: typecheck; `bun test` green; manual `/run` two-tab walkthrough (create/join/start-with-bot/shared phase/ready/defend routing/disconnect→bot/reclaim/per-seat bag/vote/win).

## Phase 8 — Hardening, manual QA, PR finalize
- Wire AFK + 3s disconnect grace + defend timeout constants (R28); `protocolMismatch` banner in main.ts.
- Run full manual checklist (lobby, shared phase, defend AoE, disconnect/reclaim, per-player bag, vote tie-break + timeout, win→explore, no pvp/duel path, `?mode=replay` still works). Document the `explored_hexes` one-time wipe and in-memory inventory in the PR body.
- Verify: `bun test` + `bun run typecheck` + `bun scripts/sim-battle.ts` exit 0; open PR on `multiplayer-coop`.


---

## Durable-persistence plan deltas (overrides R13; full detail in PERSISTENCE.md)

### Phase 0 — Test runner + DB testability foundation
Add to scope: require GAME_TOKEN_SECRET env handling stub — server reads process.env.GAME_TOKEN_SECRET, fails fast in production if unset/<256 bits, falls back to a fixed dev secret otherwise (R29). Keep initSeeds() extraction but make it run-scoped-aware (seedDiscovery will take runId in Phase 3). No behavior change to single-global-run boot.

### Phase 3 — Server Room scaffold + registry + run-scoped DB
Expand the DB migration well beyond the original run_id+ALTER. user_version bumps to a single new version that (one transaction): (a) recreates explored_hexes(run_id,q,r,cleared INTEGER NOT NULL DEFAULT 0, PK(run_id,q,r)) — note the new `cleared` column (R13.2); (b) ALTERs runs to add dimension_id, capacity, host_client_id, active, party_q, party_r, created_at, updated_at, completed_at, outcome (R13 DDL); (c) CREATEs run_seats with the CHECK and the UNIQUE partial index idx_run_seats_client_live (R32) plus client_lookup column (R33); (d) CREATEs run_seat_items, run_seat_attachments, explored_hex_icons. Each ALTER in try/catch per the dimensions pattern. Test against :memory:. Add functions: startNewRun(dimensionId, hostClientId) (host_token→host_client_id rename, R14); markRunInactive(runId, outcome) that ALSO left_at-stamps all seats (R32); saveExploredHex(runId, coord, cleared) and loadExploredHexes(runId) returning BOTH visible map and cleared set (R13.2); findActiveSeatForClient(clientLookup) with deterministic ORDER BY (R32); upsertRunSeat / leftAtStampSeat / loadSeatInventory / saveSeatInventory (full DELETE+reINSERT) / saveSeatAttachments (R13.3); updateRunPartyPos(runId, q, r) single-statement (R35); setRunHost(runId, hostClientId) (write point 8); the prior-run-abandon-on-join transaction (R32); eraseClient(clientLookup) + a retention housekeeping function (R33). Add token_salt generation at bind and HMAC helpers + constant-time compare (R29). reconstructRoomForRun(runId) skeleton.

### Phase 3 — Server Room scaffold + registry + run-scoped DB
RoomRegistry gains a transient Map<runId, Room> with check-or-throw registerRoomForRun(runId, room) as the PRIMARY anti-split-brain guard (R30), plus the assertion that a reconstructed/new Room never reuses a code held by another live Room (R36). room.ts Room type adds runId mutability for run-swap re-keying, and Seat gains token_salt persistence handling. dispose() does NOT delete durable rows (R13.1).

### Phase 5 — Room combat machine: phase/ready/pass, defend round, vote machine
Add reconstruction liveness: a Room reconstructed with human-disconnected seats installs a transient sovereignFor(seat) brain from t0 so maybeEndPlayerPhase and the vote machine never wait on a never-present human (R31); reclaim-with-valid-token drops the bot brain and always wins over a pending bot-drive (R31). Arm the reap timer at reconstruction, cancel on first bind (R31). The vote machine's visited-hex YES path must call updateRunPartyPos synchronously in-handler before yielding (R35); the combat-entry path keeps no durable write (R7) — the departure tile is already durable.

### Phase 6 — ATOMIC index.ts rewrite
Wire all durable write points (R13.6): createRoom run-create transaction (with R32 prior-run cleanup), seat bind/join/bot-fill, equip/unequip/updateAttachment with R29 write-time identity re-check AND write-before-ack ordering (R34), exploreHex atomic party_q/r + cleared=1 (R13.2/R13.4), visited-hex move synchronous party_q/r (R35), victory/defeat/reset run-lifecycle transactions that left_at-stamp all seats (R13.5/R32) and re-key Map<runId,Room> on swap (R30). Implement the resume algorithm in the hello handler: findActiveSeatForClient → token verify with NO no-token branch for human seats + run-swap reconciliation (R29), reconstructRoomForRun idempotent via registerRoomForRun (R30), constant-time non-enumerating lobby response (R29). Force-takeover clears displaced socket.data.seatId before sending displaced (R29). Build visitedThisRun strictly from the cleared set (R13.2).

### Phase 7 — Client: RoomConnection, lobby, party HUD, vote UI
Client caches sessionToken across reloads (localStorage alongside clientId) and replays it in hello so a post-restart reconnect verifies (R29). On welcome carrying a different sessionToken (run-swap reconciliation), adopt the new token. Surface an 'encounter restarted' banner when resumed into overworld from a mid-combat crash (R13.1). map-screen renders the cleared vs explored distinction if it affects UI affordances (a visible-uncleared hex shows it will trigger combat).

### Phase 8 — Hardening, manual QA, PR finalize
Manual QA additions: kill+restart the server mid-overworld and assert resume (inventory + explored + cleared + party tile intact); kill mid-combat and assert resume-at-overworld on the departure tile with the encounter re-enterable; win then createRoom (no constraint crash, R32); two clients reconnect simultaneously (single Room, R30); defeat→new-run then reconnect with stale token (run-swap reconciliation, R29); abandoned-run reap (R31); GAME_TOKEN_SECRET unset in prod fails fast (R29). Document in PR body: GAME_TOKEN_SECRET is the single config dependency for resume; the explored_hexes one-time wipe; the durable overworld/run/inventory layer + transient-in-combat boundary; retention/erasure (R33).

