# Plan: Full event logging for multiplayer co-op

## Goal

Make every server→client message **sequenced, logged, and correlatable** end-to-end, so
ordering/timing bugs are caught by an assertion at the bad frame instead of by hand-reasoning
about async timing. Two live bugs are the immediate proof:

1. **Out-of-order / dropped events on the frontend** — prime suspect is the empty-events queue
   wipe in `client/src/state/combat-store.ts:64-69`, which clears the in-flight animation queue
   with no log.
2. **Mixed bot+player damage slower to display/process** — a `defendPrompt` round that includes a
   human serializes the whole `driveCombat` loop behind a client round-trip
   (`server/src/room-machine.ts:440-442`), and the combined damage resolves in one
   `resolveAction` only after the human answers (`server/src/ai-turn-runner.ts:122-147`).

A monotonic sequence number surfaces (1) immediately; a timestamped log timeline surfaces (2).

## Design principles

- **Stamp once, at the transport chokepoint.** Do not add `seq` to the 187-line `ServerMessage`
  union. Wrap at the wire layer so call sites and message shapes are untouched.
- **Per-connection monotonic `seq`.** Each socket gets its own counter; ordering only matters
  per-recipient. A `broadcast` stamps a distinct `seq` per socket.
- **One shared record shape** for server-emit and client-receive logs, so the two timelines line
  up by `seq` when debugging.
- **Fail loud.** The client asserts `seq` monotonicity and `actionCount` monotonicity; a gap or
  regression logs a structured warning (and throws in dev), per the project's no-silent-fallback
  rule.

## Wire change (protocol bump)

`shared/src/net/protocol.ts`:

- Bump `PROTOCOL_VERSION` to `2`.
- Add a transport envelope distinct from `ServerMessage`:
  ```ts
  export interface ServerEnvelope {
    readonly seq: number;        // per-connection monotonic, from 1
    readonly t: number;          // server emit ordinal (see note on Date.now below)
    readonly msg: ServerMessage;
  }
  ```
  Client→server messages are unchanged (only the server timeline needs sequencing for these bugs;
  a client-send counter can follow later if needed).
- Add the shared log record + a typed event summary so logs are compact and stable:
  ```ts
  export interface WireLogRecord {
    readonly dir: "send" | "recv";
    readonly seq: number;
    readonly t: number;
    readonly room?: RoomCode;
    readonly runId?: number;
    readonly seatId?: SeatId;
    readonly type: ServerMessageType;
    readonly actionCount?: number;        // for "state" msgs
    readonly events?: readonly EventSummary[];
    readonly combatPhase?: string;        // room.combat step kind at emit (server only)
    readonly note?: string;               // e.g. "queue-wipe", "dropped-stale", "defend-wait"
  }
  export interface EventSummary { readonly kind: GameEvent["type"]; readonly actor?: EntityId; readonly target?: EntityId; readonly amount?: number; }
  ```
  A `summarizeEvent(ev: GameEvent): EventSummary` helper lives in shared so client and server
  produce identical summaries.

> Note: scripts/tests in this repo can't call `Date.now()` in some contexts and determinism tests
> exist. Use a plain incrementing `t` ordinal per process (not wall-clock) for the timeline; if real
> latency numbers are wanted later, add an optional wall-clock field guarded to live server only.

## Server changes

### 1. Single stamping + logging chokepoint — `server/src/index.ts`

All outbound already passes through `io.send`, `io.broadcast`, and `sendTo`. Introduce one
low-level `emit(ws, msg)`:

```ts
function emit(ws: ServerWebSocket<SocketData>, msg: ServerMessage): void {
  const seq = ++ws.data.seq;                 // seq:number initialized to 0 on connect
  const env: ServerEnvelope = { seq, t: nextT(), msg };
  ws.send(JSON.stringify(env));
  eventLog.record(buildSendRecord(ws, env)); // ring buffer, below
}
```

- Route `io.send`, `io.broadcast`, and `sendTo` through `emit` (broadcast loops seats, each gets
  its own `seq`).
- Add `seq: number` to `SocketData` (initialize `0` where the socket is set up).
- `buildSendRecord` pulls `room`/`runId`/`seatId` from `ws.data`, and for `state` messages reads
  `msg.events` (summarized) + `state.actionCount` + the room's `room.combat?.step.kind`.

### 2. Server-side event log — new `server/src/event-log.ts`

- A bounded ring buffer (e.g. last 2000 records) of `WireLogRecord`, keyed for filtering by room.
- `record(r)`, `recent(filter?)`, `clear()`.
- Sink controlled by env var `MP_EVENT_LOG` (`off` | `ring` | `stdout`). Default `ring` in dev,
  `off` in prod. `stdout` prints one compact line per record for live tailing.
- A debug dump path: extend the existing debug message handling (the protocol already has
  `debugWin`/`debugLose`) with a dev-only way to fetch `recent()` for a room, or simply log to
  stdout — pick the smaller change during implementation.

### 3. Annotate the known-suspect emit sites with `note`

- The reconnect snapshot `state` with `events: []` (`index.ts:242`) → `note: "snapshot"`.
- `broadcastState(room, io, [])` calls → `note: "state-empty"`.
- In `driveCombat`, when a `defendPrompt` is emitted and the loop returns, record a
  `note: "defend-wait"` marker so the gap before the resolved damage is explicit in the timeline.

## Client changes

### 1. Unwrap + log + assert — `client/src/net/connection.ts`

`handleMessage` is the single receive chokepoint. Change it to:

```ts
const env = JSON.parse(event.data) as ServerEnvelope;
this.checkSeq(env.seq);            // monotonic per-connection; warn+throw-in-dev on gap/regress
clientEventLog.record(buildRecvRecord(env));
const msg = env.msg;
// ...existing welcome/displaced/protocolMismatch handling + dispatch unchanged
```

- `checkSeq` tracks `lastSeq`; a non-`lastSeq+1` value records a `WireLogRecord` with
  `note: "seq-gap"` (drop) or `"seq-regress"` (reorder) and, when `import.meta.env.DEV`, throws.
- Reset `lastSeq` to `0` on reconnect (server's counter is per-connection and restarts).

### 2. Log the combat-store drain decisions — `client/src/state/combat-store.ts`

This is where bug 1 actually manifests. Add log records (not behavior changes yet) at the three
decision points so the cause is visible:

- `handleState` stale drop (`:48`) → `note: "dropped-stale"` with both actionCounts.
- the **empty-events queue wipe** (`:64-69`) → `note: "queue-wipe"` with `queue.length` before
  clearing. This is the line most likely to be the bug; the log makes it obvious in one repro.
- `processNext` dequeue → `note: "drain"` with remaining queue depth.

Records go to a `clientEventLog` ring buffer with the same `WireLogRecord` shape.

### 3. Dev overlay (optional, high future value) — small toggle

A keypress (e.g. `~`) renders the last N `clientEventLog` records as a scrolling overlay:
`seq · type · actionCount · events · note · queueDepth`. This is the "value later" payoff — every
future ordering bug is one screenshot. Keep it dev-gated and tiny; defer if time-boxed.

## Test harness integration

`server/src/__tests__/coop-harness.ts` already drives the server in-process. Wire the harness's
fake IO through the same `emit`/`eventLog` path (or have it capture `WireLogRecord`s directly), and:

- Add a helper `harness.timeline(room)` returning the ordered `WireLogRecord[]`.
- On a failing assertion, dump the timeline so test output shows the exact emit order.
- Add two regression tests that reproduce the live bugs against the timeline:
  - **Ordering:** assert client-side `seq` is strictly monotonic and **no** `queue-wipe` record
    drops non-empty queued events during a combat sequence.
  - **Mixed defend:** assert the `defend-wait` marker precedes a single combined damage `state`,
    and document the round-trip ordering so the timing source is pinned.

These tests should **fail first** (proving the bugs), then guide the fixes.

## Sequencing of work

1. Protocol: envelope, `WireLogRecord`, `EventSummary`, `summarizeEvent`, version bump. `bun run typecheck`.
2. Server: `event-log.ts` + `emit` chokepoint + `SocketData.seq`. Route `io`/`sendTo` through it.
3. Client: envelope unwrap + `checkSeq` + `clientEventLog`; combat-store decision logs.
4. Harness: capture timeline + the two failing regression tests.
5. **Fix the two bugs** (separate commit) using the now-visible timeline:
   - Out-of-order: rework the empty-events branch so it never drops a non-empty in-flight queue.
   - Mixed damage: decide whether to keep the serialized defend round or pipeline bot damage ahead
     of the human round-trip — the timeline tells us which.
6. Dev overlay (optional) + flip default log sink to `off` for prod.

## Out of scope

- Per-event global ordinals inside a single `state` batch (snapshot `actionCount` + `seq` is
  enough for these bugs).
- Client→server send sequencing (add later if a client-action ordering bug appears).
- Persisting logs to disk/DB; the ring buffer + stdout sink is sufficient for now.

## Files touched

- `shared/src/net/protocol.ts` — envelope, log types, version bump
- `shared/src/net/` (or `shared/src/index.ts`) — `summarizeEvent` helper export
- `server/src/event-log.ts` — **new**, ring buffer + sink
- `server/src/index.ts` — `emit` chokepoint, `SocketData.seq`, route `io`/`sendTo`
- `server/src/room-machine.ts` — `note` annotations on suspect emit sites
- `client/src/net/connection.ts` — unwrap, `checkSeq`, `clientEventLog`
- `client/src/state/combat-store.ts` — drain decision logs
- `client/src/...` — optional dev overlay
- `server/src/__tests__/coop-harness.ts` + a new `coop-event-order.test.ts`
</content>
</invoke>
