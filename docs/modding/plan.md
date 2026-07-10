# Code Mods — Domain-General Mod Surfaces (Plan v3)

Status: final merged v3, post adversarial review, superseding plan v2 as the top-level document.
v2 is NOT discarded: its kernel — the sandbox, the pure-handler law, the fail-loud ladder, the
golden discipline, dimension scoping — carries forward verbatim as v3's encounter-domain
instantiation and is inventoried in the "v2 kernel — carried forward unchanged" section at the
end. Branch context: `loot-overhaul`; all file:line anchors re-verified against the working tree
on 2026-07-10 (`run-events.ts` REGISTRY at :65-77 and the recorder law at :18-25,
`encounterTypeFor` at `room-machine.ts:1163`, `ensureGatewayAttuned` in `server/src/gateways.ts`,
the whole-entity serializer in `shared/src/core/serialization.ts`, `routeScene` at
`BoardHost.svelte:186`).

**One-paragraph summary.** v2 built one complete mod surface for one domain — combat encounters:
events in, ops out, a serialized per-mod state bag, declarative render. v3's single move is to
make that quartet THE pattern: a generic `DomainSpec` contract that every domain of the game
instantiates — encounter, overworld, run/economy, scenes, plus two cross-cutting surfaces
(entity components, UI/audio chrome) — so that every future capability is vocabulary growth
inside a fixed shape, never new architecture. The sandbox, artifact, ladder, and scoping rules
are shared machinery written once; a domain supplies exactly four things (event union, op union +
interpreter, bag binding, render vocabulary) and inherits everything else. Under this contract,
all eight of Ben's wishlist mods are pure mod artifacts against scheduled surfaces, and the two
wishlist items that fail (client accessibility remaps, cross-player events) fail *by design*,
documented as boundaries.

Three decisions made here, not hedged:

1. **The contract is born generic in the idea PR; the machinery ships single-instance.** The
   manifest is domain-sectioned from birth (retrofitting it later is a `contractVersion` burn
   over rows that today number zero), and the interpreter/dispatch core is written against a
   `DomainSpec` seam with exactly one registered instance. Slice 2 (overworld) is the
   generalization proof, with a mechanical kill-switch (§7.1).
2. **Determinism is a per-domain class, not one global contract.** Encounters and scenes are
   `byte-exact` (pure function of seed+inputs+mods; client-predicted; cross-host hash gates).
   Overworld and run are `replay-deterministic` (pure fold over a recorded event stream;
   server-only dispatch; transcript-replay gates). Forcing byte-exact-from-seed onto the
   wall-clock, vote-driven overworld would be a lie; the class system makes the honest envelope
   checkable. The load-bearing rule: **nondeterminism stops at the event boundary** (§4.1).
3. **The hot-path law is statute.** Every domain's read-hot chokepoints consume declarative
   data; sandbox code runs only on discrete events and writes the data those chokepoints read.
   Move cost proved it in v2; shape targeting, AI planning, biome lookup, and scene rendering
   are the same law in four more places. Any proposal that puts a dispatch inside a per-frame,
   per-candidate, or per-hex loop is rejected at review by citing this paragraph.

---

## 1. The domain contract — one generic, N instantiations

### 1.1 `DomainSpec`

```ts
// shared/src/mods/domain.ts — the only new abstraction v3 introduces
export type DomainId = "encounter" | "overworld" | "run" | "scene" | "build";

export type DeterminismClass =
  | "byte-exact"            // pure fn of (seed, inputs, mods); client prediction; cross-host hash gate
  | "replay-deterministic"; // pure fold over (recorded event stream, bags); server-only; replay×2 gate

export interface DomainSpec<
  Ev extends { readonly type: string },
  Op extends { readonly type: string },
  View,
> {
  readonly id: DomainId;
  readonly determinism: DeterminismClass;
  readonly eventSchema: z.ZodType<Ev>;        // closed, discriminated, versioned (§6)
  readonly opSchema: z.ZodType<Op>;           // closed, discriminated, versioned (§6)
  readonly buildView: (ctx: HostCtx) => View; // frozen, canonically ordered (sorted ids/keys)
  readonly interpretOps: (ctx: HostCtx, modId: string, ops: readonly Op[]) => void;
  readonly bag: BagBinding;                   // §1.3
}

export interface BagBinding {
  readonly lifetime: "encounter" | "run" | "account";
  readonly fence: "none" | "sourceHash";      // hash-fenced ⇒ droppable by contract (§1.3)
}
```

Kept deliberately small: view builder + op table + event list + bag binding. No lifecycle, no
render machinery, no determinism policy *inside* the shared core — those attach per class and
per host. A mistake in this seam propagates to every domain, so the seam carries nothing it
doesn't have to.

Shared machinery, written once in `shared/src/mods/` and parameterized by `DomainSpec`:

- **Registration.** Event names are namespaced `"<domain>:<event>"`. One code source per mod
  serves all domains: `mod.on("overworld:encounter-won", h)` beside `mod.on("encounter:attack", h)`.
  `code.events` declares the full namespaced list; the prelude's declaration≡registration check
  is unchanged, just namespace-aware. One source, but **one isolate per (mod, domain, lifetime)**:
  the encounter host and the overworld host each eval the same source in their own sandbox and
  dispatch only their own domain's events. The `api` injected into a handler is the dispatching
  domain's api; calling `api.damage` from an overworld handler is a `ReferenceError` → `ModError`
  naming the mod, the event, and the missing capability. `api.state` always means "the bag of the
  domain whose event you are handling" — stated in every capability card (§8), because it is the
  one same-name-different-referent in the whole surface.
- **Dispatch.** The v2 `__dispatch` JSON protocol verbatim: host builds `(event, view, bagSlice)`,
  guest returns `{ bag, ops }`, host Zod-validates every op against `opSchema` **and live state**,
  then `spec.interpretOps` applies them. Fuel (`FUEL_PER_DISPATCH`, `FUEL_LOAD`), 32 MiB memory
  limit, lockdown prelude, `ModError`/`ModFuelExhausted`, per-mod isolates, content-addressed
  caching with locally-recomputed hashes — all shared constants and code, identical across
  domains.
- **Determinism harness per class.** `byte-exact` domains keep v2's full battery (cross-host SHA,
  A/B rebuild, golden hash coverage of bag + ops). `replay-deterministic` domains get the cheaper
  gate: record the event stream, dispatch it twice (with isolate dispose+rebuild between events)
  against the same initial bag, byte-compare bags and op transcripts. `api.roll` in replay
  domains hashes `(modId, runId, event seq#, call idx)` — see §4.2 for why the seq# must be
  durable. No `Date`, no `Math.random` crosses the boundary anywhere, ever, in any domain.

### 1.2 What a domain must supply

Exactly four things, and nothing about sandboxing, fuel, validation plumbing, or caching:
(1) its closed event union and the host emit sites; (2) its closed op union and one
`interpretOps`; (3) a `BagBinding` and the storage row/field behind it; (4) a declarative render
vocabulary in the manifest, bound to bag keys. A domain that cannot fill all four slots is not a
domain yet — it is a feature of an existing domain (this is why "run/economy" is a thin domain
and "entity components" is not a domain at all, §2.4).

### 1.3 The state bags — one table of truth

| Bag | Keying | Storage | Lifetime | Fence |
|---|---|---|---|---|
| encounter | `GameState.modState[modId]` | serialized snapshot (v2 allow-list) | dies with the encounter (combat volatile) | none — hashed into goldens |
| scene | `SceneSnapshot.state[modId]` | scene snapshot, same serializer discipline | dies with the scene | none — hashed |
| run | `run_mod_state (run_id, dimension_id, mod_id)` | new SQLite table, loaded in `reconstructRoomForRun` beside `partyBag` (~`room-machine.ts:1768`) | run; **survives leave-and-return** to the dimension (§4.3) | `sourceHash` — drop-and-reseed on mismatch, cascading (§4.3) |
| account | `account_mod_state (account_id, mod_id)` | new table (ships when an I3-class mod forces it) | permanent | `sourceHash`, same semantics |

Keying is the scoping mechanism. Mod ids are `d<dim>-mod-<slug>` and the run bag is additionally
keyed by `dimension_id` (mirroring `run_cleared_hexes`), so a bag written under dim-A's mod is
*unreadable in dim-B by construction* — dim-B's mods have different ids and each dispatch
receives only its own slice. This is how currency (B6) and reputation (B2) persist across a
leave-and-return without ever leaking across dimensions. All bags keep v2's value type
`Record<string, string | number>` with the non-finite guard; bag keys must match
`/^[a-zA-Z_][a-zA-Z0-9_:.-]*$/` and never be integer-like (JS integer-key reordering would make
serialization order depend on write history — the Ember Wake `"h:q:r"` trick, now a validated
rule instead of a convention).

**Fence semantics, stated as contract:** a `sourceHash`-fenced bag is *droppable*. On mismatch
the row is deleted and re-seeded from the manifest's initial state, and everything derived from
it (markers, staged overrides — §2.2) is deleted in the same transaction. Mods must be written
so that a dropped bag is a setback, not corruption. This is the entire mod-version-migration
story for durable state, on purpose: no per-mod migration code, ever.

### 1.4 The manifest, generalized

```ts
export interface ModDefinition {
  readonly contractVersion: 3;               // one global version per artifact (§6)
  readonly id: string;                       // d<dim>-mod-<slug>, ownership guard unchanged
  readonly dimensionId: number;
  readonly name: string;
  readonly encounter?: EncounterManifest;    // v2's resources/templates/rules/reactions/hud/initialModState, verbatim
  readonly overworld?: OverworldManifest;    // §2.2: biomes, marker sprites, initial run-bag seeds
  readonly run?: RunManifest;                // §2.3: currencies, encounter bridge decls
  readonly scenes?: readonly SceneDecl[];    // §2.5: declarative + console scenes
  readonly components?: readonly ComponentDecl[]; // §2.4: this mod's entity-component schema
  readonly audio?: AudioManifest;            // §2.6
  readonly code?: {
    readonly source: string;                 // ≤ 8 KiB, one script serving all domains
    readonly sourceHash: string;             // integrity only, never authority (v2 §4)
    readonly events: readonly string[];      // namespaced: "encounter:attack", "overworld:hex-entered"
  };
}
```

One artifact, one row in `dimension_mods`, one ownership guard, one write-time Zod gate, one
fail-loud ladder. Sections not yet opened by a shipped slice are *reserved*: the schema accepts
the key and throws a "not yet open — lands in slice S<n>" error, so a too-eager generated mod
fails with an actionable message rather than a mystery (and the schema never has to make a
breaking change to open a section).

---

## 2. The instantiations

### 2.1 D1 — Encounter (v2, restated as instance #1)

`DomainSpec` values: `determinism: "byte-exact"`; events
`encounterStart | turnStart | attack | unitKilled`, growing to `unitMoved | abilityUsed` in S4;
ops = the v2 union (`damage, damageAt, damageArea, heal, applyStatus(+Area), spawn, giveResource,
announce`) growing per §6; bag = the `modState` slice; render = v2's HUD widgets, resource pips,
and `modState` floating labels, plus v3 vocabulary that accretes across slices:

- **Board decals** `{kind: "disc"|"hexTint"|"line", bind: stateKey | selector}` (I1's threat
  overlay) — declarative, bound to bag keys, drawn by the existing render layer.
- **Attachment sprites** `{anchor: entityRef, spriteKey, offset, z}` — B7 mounts' render half.
- **Cosmetic override maps** (pattern/color per effect kind — I12) and a `table` HUD widget (I11).
- **Declared statuses** (I9): `EncounterManifest.statuses: [{id, glyph, color,
  durationSemantics, tickOp}]`; one resolver arm iterates declared statuses;
  `StatusEffectType` widens to core ∪ declared.
- **`aiHints`** (I8): an op that writes a target-weight / zone-avoid table into the bag, read
  declaratively by the AI planner at its existing chokepoint. Code never enters the planning
  loop — the hot-path law's third proof.
- **Seat on `UnitView`** (I5): heroes carry their controlling seat id in the view, enabling
  per-seat-flavored mods (bonded pair) with zero protocol change.
- **One geometry addition** (B5): `ShapeKind` gains a single `composite` member — a closed
  algebra `{parts: [{primitive, offset, rotate}], op: "union"|"subtract"}` over the four
  existing primitives, Zod-bounded (≤ 8 parts), evaluated in the same exhaustive switch
  (`shared/src/geometry/shape.ts`). Rings, crosses, split cones — still pure data on the
  targeting hot path.

The v2 refactor cost: `compileModRules`, the view builder, interpret/validate, and the isolate
cache move onto the generic core as `compileDomain(ENCOUNTER_SPEC, …)`. **Golden hashes must not
move** — the refactor commit shows a byte-identical baseline, which is the cheapest possible
proof that the parameterization changed shape, not behavior.

### 2.2 D2 — Overworld

The server run-event bus (`server/src/run-events.ts`) is already the events-in surface; slice 2
is *exposure*, not construction. `determinism: "replay-deterministic"` — the overworld is
imperative, wall-clock, vote-driven (`room-machine.ts`, ~1800 lines), and no client predicts it.

**Events** (payloads mirror `RunEvent` minus `room`/`io`; kebab-case matching the bus):
`overworld:run-started {}`, `overworld:encounter-won {hex, icon, firstEver, clearedCount}`,
`overworld:hex-entered {hex, icon}`, `overworld:dimension-entered {tier}`,
`overworld:interact {hex, icon}` (new: party rests at / uses a town — B2's join affordance),
`overworld:choice-resolved {promptId, optionId}` and `overworld:choice-dismissed {promptId}`
(§2.2a). Event payload schemas are the nondeterminism fence: **no timestamp, no deadline, no
account id, no live community-state reference may appear in a payload** (§4.1). Fields like
`firstEver` and `tier` — which depend on wall-clock-ordered global state at emit time — are
legal precisely because they are *baked into the recorded payload*; a replay replays the
recording, not the world.

**Dispatch site and the recorder law.** A new recorder `modDispatchRecorder` registers **last**
in `REGISTRY` (`run-events.ts:65`). It dispatches each mod's overworld isolate, writes the
returned run bag, and **stages** the ops on the room (`room.pendingEncounterOverride`,
`room.modMarkers`, `room.pendingChoicePrompts`) — it does not apply transition-shaped ones. The
machine drains the staging at its existing chokepoints (`finalizeMove` → `encounterTypeFor`),
preserving the recorder law at `run-events.ts:21-24` to the letter: handlers never touch
phase/vote/session; the machine remains the sole transition owner. Ops are *intent*; the machine
is the interpreter.

**Ops:**

```ts
type OverworldOp =
  | { type: "setMarker"; markerId: string; at: HexCoord; spriteKey: string; label?: string }
  | { type: "moveMarker"; markerId: string; to: HexCoord }   // adjacency NOT required — mods aren't players
  | { type: "removeMarker"; markerId: string }
  | { type: "overrideNextEncounter"; at: HexCoord; spec: EncounterSpec }  // §3.1
  | { type: "offerChoice"; promptId: string; text: string;
      options: readonly { id: string; label: string }[] }     // §2.2a
  | { type: "banner"; text: string };                         // transient toast, ≤ 60 chars
```

Validation beyond Zod, per op: `overrideNextEncounter` **rejects gateway hexes, the origin/town
retreat hex, and any hex with a live core override** — found under attack: a mod that could
override a gateway hex would intercept community-permanent descent progression
(`ensureGatewayAttuned` fires from the `encounter-won` recorder chain); the closed union plus
this validation arm is what makes "mods cannot touch gateways" checkable rather than hoped.
Markers may sit on any hex (they are scenery) but never alter gateway/retreat semantics.

**Persistence.** Markers in `run_overworld_markers (run_id, dimension_id, mod_id, marker_id, q,
r, sprite_key, label)`; encounter overrides in `run_encounter_overrides (run_id, dimension_id,
q, r, mod_id, spec_json)`, read by `encounterTypeFor` (`room-machine.ts:1163`) **before** the
icon fallback — override beats icon beats decoration-hash. Both rehydrate in
`reconstructRoomForRun` and both clear on `commitTravel` for the departed dimension (markers are
per-dimension scenery; the *bag* survives, so a chaser respawns its marker from its bag on
`overworld:dimension-entered` — one line of mod code, which makes leave-and-return semantics the
mod's explicit, testable decision rather than framework magic).

**2.2a `offerChoice` does NOT ride the vote channel.** Found under attack: the room has a single
`room.vote` slot with phase guards; a mod prompt occupying it would collide with travel votes and
create mod-blocks-core deadlocks. Instead: staged prompts queue FIFO in `room.pendingChoicePrompts`;
the machine opens at most one at a time, **only at overworld-idle** (no vote open, no encounter);
the party resolves it through a lightweight prompt UI (host-decides-on-timeout, same social
contract as votes but a separate slot that core actions always preempt). Resolution emits
`overworld:choice-resolved` into the event stream (recorded — deterministic); a prompt preempted
by travel out of the dimension emits `overworld:choice-dismissed` (also recorded), so a mod
always sees a terminal event for every prompt it opened. Prompts never block travel, combat, or
run settlement.

**Render decl:** the `hexMapState` payload (`room-machine.ts:239`) grows
`modMarkers: Record<markerId, {q, r, spriteKey, label}>`; `hex-map-renderer.ts` draws it exactly
as it draws icons — sprite keys resolve through the dimension asset channel. Plus declarative
**biomes** (B4), pure data because biome lookup runs per rendered hex:

```ts
interface OverworldManifest {
  readonly biomes?: {
    readonly fn: { kind: "axialBands"; axis: "q"|"r"|"ring"; width: number }
              | { kind: "valueNoise"; seed: number; scale: number; thresholds: readonly number[] };
    readonly table: Readonly<Record<string /*biomeId*/, {
      spawnTable?: Partial<Record<HexIconType, number>>;  // overrides HEX_SPAWN_TABLE weights
      mapPool?: readonly string[];
      artKeys?: Readonly<Record<string, string>>;
      archetypeWeights?: Readonly<Record<string, number>>;
      musicKey?: string;
    }>>;
  };
  readonly markerSprites?: Readonly<Record<string, string>>;  // spriteKey → asset path
  readonly initialRunState?: Readonly<Record<string, string | number>>;
}
```

Biome decls are **immutable after first chart**: `pickIconForHex`'s output is
community-permanent via `discovered_hex_icons`, so adding *or* editing a biome fn after any hex
of the dimension is charted is a write-gate error (dimension regen deletes charts, so regen is
the escape hatch). This applies to adding a biome-bearing mod to an already-charted dimension,
not just to edits.

### 2.3 D3 — Run / economy

A deliberately thin domain: events `run:started`, `run:ended {outcome, contract}` (both exist on
the bus); `determinism: "replay-deterministic"`; bag = the same `run_mod_state` row as D2 (one
bag per (run, dimension, mod) — the run "domain" and overworld domain share the bag; they are
two event surfaces over one lifetime).

```ts
type RunOp =
  | { type: "giveCurrency"; currencyId: string; amount: number }   // declared, clamped to max
  | { type: "spendCurrency"; currencyId: string; amount: number }  // throws if insufficient — fail-loud
  | { type: "grantItem"; poolRef: { rarity: Rarity; slot?: ItemSlot } }  // §3.3 — pool-gated, never mints
  | { type: "contractProgress"; contractKey: string; delta: number };    // I6 stepping stone
```

`RunManifest` declares `currencies: [{id, label, glyph, color, max}]` (values live in the bag
under reserved keys `__cur:<id>`) and the run↔encounter **bridge** (§3.2). Render: currency pips
on the run screen (the `ResourceDecl` pip component reused at run scope) and a contract-progress
line. Vendor *spending* is not a run op — it is a scene (§2.5): a declarative shop scene whose
purchase options emit `spendCurrency` + `grantItem`.

### 2.4 D5 — Entity component bag (cross-cutting, not a quartet)

v1/v2's OQ-1 flips at its rule-of-three moment: mounts (B7), the chaser's allegiance echo, and
faction tags (B2) are three concrete consumers.

```ts
// shared/src/core/types.ts — Entity gains one optional field; core stays flat
readonly components?: Readonly<Record<string /*modId*/, Readonly<Record<string, string | number>>>>;
```

- **Schema:** `ModDefinition.components: [{key, type: "string"|"number", description}]`. Writes
  are validated against the declaration — an undeclared key throws with a fix-naming message.
  Component keys obey the same non-integer-like key rule as bags (§1.3).
- **Addressing:** one op `{type: "setComponent", unitId, key, value}` / `api.setComponent(...)`;
  `UnitView` gains `components` (own-mod slice only — cross-mod component reads are
  unrepresentable, same as modState). Data rules gain `when: {component: {key, equals}}`, read
  at the existing chokepoints (move cost/distance for mounts).
- **Serialization & goldens:** `serializeGameState` copies entities whole
  (`serialization.ts:16-44`), so the optional field rides through mechanically; what is added is
  (a) the round-trip fixed-point test asserting `components` survives, (b) the rule that
  `setComponent` produces a new frozen entity via immutable spread (views stay frozen), and
  (c) golden scenario N+1: a mounted fixture — component set at `encounterStart`, a
  component-conditioned movement rule, dismount on `unitKilled`. One added baseline entry, per
  discipline. Absent-when-unmodded means every existing golden and every sim fixture is
  byte-identical — the sim harness (hero-arena, arena2) needs zero changes for the field to
  exist, and one new arena scenario for it to be *covered*.
- **Migration:** combat is volatile — entity components never rehydrate mid-run, so migration is
  template seeding plus the golden. Where components echo into durable bags (a chaser's
  allegiance in `run_mod_state`), the sourceHash fence is the whole migration story: changed mod
  ⇒ dropped bag ⇒ reseeded. **Component data is droppable** — contract, not accident.
- **The trap, named:** components are for mods. Core mechanics (HP, position, team) stay flat
  fields; any PR moving core state into the bag "for uniformity" is wrong by policy. `TeamId`
  stays binary — factions (B2) are an *allegiance overlay*: an allegiance component plus a
  mod-maintained matrix in the run bag, consumed by the S9 `hostileTo(a, b)` chokepoint in
  target selection and by `aiHints` weights. The resolver's red/blue skeleton is untouched.
- **No overworld entity system in v1.** The chaser is a marker + a bag, deliberately. If three
  mods someday need overworld actors with per-actor state, that is an additive
  `run_overworld_actors` growth — the quartet slot for it already exists.

### 2.5 D4 — Scene / encounter-kind registry (the v3 pivot)

**Registry.** `EncounterKind = HexIconType | "wilderness" | "dense-wilderness" |
{modId: string; sceneId: string}`. Three core seams change, all in S5:

```ts
export interface EncounterKindSession {
  serialize(): EncounterSnapshot;                       // { kind, state } — kind tag rides the snapshot
  applyInput(seatId: SeatId, input: WireAction): void;  // deterministic; throws on gate violation
  needsServerStep(): boolean;                           // combat: AI turns; most scenes: false
  stepServer(): void;
  outcome(): EncounterOutcome | null;                   // null = still running
}
export interface EncounterOutcome {
  readonly result: "victory" | "defeat" | "neutral";    // generalizes winner === "red" (endCombat ~:1243)
  readonly commits: readonly RunOp[];                   // applied by the run interpreter at teardown (§3.3)
}
```

`endCombat` reads `outcome()` instead of `state.winner`; `exploreHex`/`settleRun`/contract
recorders are already kind-agnostic (verified — the reward path funnels through one boolean
today). Client: `routeScene` (`BoardHost.svelte:186`) gains a third arm on the snapshot's kind
tag → `SceneRenderer`; `RunScreen` swaps CombatDock for a scene HUD on the same tag.
`FrameDriver`, `CombatCamera`, `ScreenFlash`, and the sprite/text primitives are the reused
substrate.

**Two tiers, matching the data/code split:**

*Declarative choice scene* (I10; B6's vendor) — pure data, no sandbox:

```ts
interface ChoiceSceneDecl {
  readonly kind: "choice"; readonly sceneId: string;
  readonly nodes: Readonly<Record<string, {
    text: string; portraitKey?: string;
    options: readonly {
      label: string; goto?: string;
      requires?: { currencyId: string; amount: number };
      effects?: readonly RunOp[];                        // spendCurrency + grantItem = a shop
      outcome?: "victory" | "neutral";
    }[];
  }>>;
  readonly entry: string;
}
```

*Code scene* (B3) — the fantasy-console contract, sized honestly:

```ts
interface CodeSceneDecl {
  readonly kind: "console"; readonly sceneId: string;
  readonly grid: { cols: number; rows: number };        // ≤ 32×24 logical cells
  readonly sprites: Readonly<Record<string, string>>;   // key → dimension-channel asset
  readonly palette: readonly string[];                  // ≤ 16
  readonly pulseHz?: 0 | 1 | 2 | 4;                     // §2.5a — server-metered clock, default 0
}
// guest loop: mod.on("scene:input", (ev, api) => …) — ev is ONE SceneInput
type SceneInput =
  | { type: "cell"; seatId: SeatId; q: number; r: number }         // quantized pointer
  | { type: "key"; seatId: SeatId; key: "up"|"down"|"left"|"right"|"a"|"b" }
  | { type: "skill"; seatId: SeatId; power: number }               // trusted scalar, clamped,
                                                                   // NEVER on a value-minting branch
  | { type: "pulse"; n: number };                                  // §2.5a — server clock, recorded
type SceneOp =
  | { type: "draw"; cells: readonly { q; r; spriteKey?; glyph?; fg?; bg? }[] }  // ≤ 256 cells/dispatch
  | { type: "text"; q; r; text: string }
  | { type: "end"; outcome: EncounterOutcome };
```

**Determinism (byte-exact, T3 resolved as option i):** the scene advances on **input events,
not render frames**. The client streams quantized inputs; the server appends each to the scene's
input log and applies the identical `applyInput` — the scene is a pure fold over the input log,
replayable byte-exact at scene end. Prediction is free: same code, same sandbox; the client
applies its own inputs optimistically and reconciles on the server's authoritative log order
(the only divergence source is cross-seat interleaving, converged by log order like combat
actions today). The `skill` scalar is the defend-prompt precedent (`protocol.ts:308`), admitted
explicitly and fenced: clamped server-side, forbidden as an input to `grantItem` or currency
amounts.

**2.5a The pulse, and exactly what v1 minigames cannot do.** Input-only advancement means no
autonomous time: no Snake, no falling blocks, nothing moves unless a player acts. That is a real
disappointment risk, so v1 admits **one clock, server-metered**: if `pulseHz > 0`, the server
appends `{type: "pulse", n}` events to the input log at that cadence *while the scene is live*.
Pulses are recorded log entries, so the fold stays pure and replay stays byte-exact; the hot-path
law bounds cadence at 4 Hz (a pulse is a dispatch — 4/s is nothing; 60/s is forbidden forever).
Clients do not predict pulses — pulse-driven motion renders at server pace with client inputs
echoed locally.

With that, the honest capability fence. **v1 minigames CAN be:** grid/sprite/text games at up to
4 Hz — puzzles, sokoban, memory, tile-tactics variants, card/dialogue hybrids, snake-likes,
timing challenges via the scalar, turn-based anything. **v1 minigames CANNOT be:** smooth or
sub-cell motion (cell-quantized only); reaction gameplay under ~250 ms (pulse floor + no
per-frame code); physics or freeform vectors; per-frame guest code of any kind; audio beyond the
D6 event→stinger map; camera control beyond the fixed grid; mid-scene asset loading; grids over
32×24 or more than 16 palette entries; and — found under attack — **per-seat hidden
information**: every seat sees the same grid, so hidden-hand card games and asymmetric-info
games are out of v1's scope (per-seat views are a quartet-shaped growth, admitted only against a
forcing mod — OQ-6). This is Pico-8-shaped by intent; it is also the "a different game runs on
the core" engine milestone, because `EncounterKindSession` + fantasy console is precisely a
second game loop hosted on the same kernel.

### 2.6 D6 — UI / audio chrome

Mostly declarative vocabulary attached to the other domains' manifests, listed once: HUD widgets
(exist) + `table`; board decals; attachment sprites; cosmetic override maps; **audio manifest**
`{tracks: Record<key, assetRef>, stingers: Record<"encounter:unitKilled"|…, key>,
intensityBind?: stateKey}` — the client's adaptive-stem machinery
(`web/src/state/music.svelte.ts`) already exists; the vocabulary is a pointer table into the
dimension asset channel. **Code may drive UI in exactly zero places** — v2's rule holds across
all domains: code writes bags and ops; declarations bind bags to pixels.

Policy boundaries, written as boundaries not gaps: client-local cosmetic/accessibility mods
(I13) live outside the dimension-mod kernel entirely (no determinism impact, no dimension
authorship); cross-player systems (I14) are *correctly impossible* — no op union in any domain
has a cross-player referent, and that is the feature.

---

## 3. Cross-domain rules

The boundary between domains is **typed, not conventional** — three mechanisms, no honor system:

1. Each domain's ops are validated against *that domain's* Zod union at its own dispatch
   chokepoint; an overworld-shaped op returned from an encounter handler fails Zod loudly.
2. Each domain's `api` object contains only that domain's verbs; a cross-domain call is a
   `ReferenceError` → `ModError` at dispatch.
3. Cross-domain reach exists **only as explicit bridge members** of a host domain's union, each
   validated against both schemas and applied only at a domain *boundary* (creation or
   teardown), never live. There are exactly three bridges:

**3.1 Overworld → encounter: `overrideNextEncounter.spec`.**

```ts
type EncounterSpec =
  | { kind: "combat"; roster: readonly string[];  // keys into THIS mod's encounter.templates
      archetype?: string; mapHint?: string }
  | { kind: "scene"; sceneId: string };           // THIS mod's scenes registry
```

Template/scene keys validate against the *emitting mod's own manifest* at op-validation time;
rosters are band-checked by the battery at generation time (a chaser encounter is priced like
any encounter). At `createEncounter` the override is consumed *after* `loadModsForDimension`
stamps `state.mods` — the custom encounter runs under the same dimension mod set as any other.
Gateway/retreat hexes are rejected (§2.2).

**3.2 Run → encounter: the bridge decl.** Encounter handlers may **not** query run state —
combat stays a pure function of `(seed, inputs, state.mods)`, and a live run-bag read would
smuggle an unhashed input. Instead, `RunManifest.bridge: {toEncounter: [{runKey, stateKey}]}`
copies named run-bag keys into the mod's `initialModState` at `createEncounter` — stamped,
serialized, and hashed like any initial state (weather I7, chaser-proximity dread, faction
standing all ride this).

**3.3 Encounter/scene → run: the commits ledger.** `api.commit(op: RunOp, when: "victory"|"any")`
appends to a `__commits` ledger inside the encounter/scene bag (serialized, hashed, predicted
like everything else); the run interpreter applies the ledger exactly once at teardown, filtered
by `outcome()`. Currency is earned mid-fight visibly but *banked* only at teardown — combat
stays volatile, crashes and `ModError` aborts lose nothing durable, and no mid-encounter durable
write ever exists.

**3.4 Economy vs the pricing/no-interaction invariant.** Currencies are dimension-scoped by bag
keying and worthless elsewhere by construction. `grantItem` takes a `poolRef` — a rarity/slot
filter over **the dimension's own priced item pool** (the `loot.ts` pattern), rolled with the
run domain's deterministic roll; no op anywhere creates an `ItemDefinition`, and v1's
no-item-costs-a-mod-resource cross-check stands. Items bought in a shop are exactly as portable
and exactly as priced as items dropped by the same dimension's loot table. Sim enforcement: S6's
run-sim pricing pass asserts currency-per-encounter faucets land in declared bands.

**3.5 No-interaction, restated once for all domains.** *No domain's op or event union contains a
referent that can name anything outside (this run, this dimension, this mod's own slices); every
community-permanent surface — discovery, charted icons, gateways — is read-only to mods, with
biome decls frozen after first chart and gateway/retreat hexes rejected by op validation.* The
v2 channel table survives verbatim (see the kernel section); the new channels — markers,
overrides, run bags, commits, prompts, scenes — are all run-scoped rows keyed by mod id.
Mod-set swap remains a travel-time non-operation: markers/overrides for the departed dimension
are cleared, bags go dormant under their keying, nothing mod-shaped crosses a gateway.

**3.6 Co-op and overworld actors — whose chaser is it?** Party-scoped, by construction, not by
rule: a room has one party, one `room.dimensionId`, one run; travel is a party vote; **seats
cannot split across dimensions mid-run because the state space has no representation for it**
(`room.dimensionId` is singular). The run bag is keyed by (run, dimension, mod) with no seat
key, so the chaser chases the party; `offerChoice` resolves as a party decision through the
prompt queue, not per-seat. Seat ids appear in exactly two mod-visible places — scene inputs and
`UnitView.seat` — both inside encounters, where all seats share one snapshot. If a future
feature ever splits parties across dimensions, `run_mod_state`'s keying is the declared
migration point; flagged now so it is a decision then, not an archaeology dig.

---

## 4. Determinism across classes — the rules the attacks forced

### 4.1 The event-boundary rule (replay domains)

The overworld event stream is genuinely nondeterministic: vote deadlines are `Date.now()`
(`room-machine.ts:957` etc.), gateway attunement outcome depends on the global pool queue at the
wall-clock moment of first clear, `firstEver` depends on community discovery state. Mod hooks do
**not** inherit this nondeterminism, and the rule that makes that true is mechanical:

> A replay-domain mod is a pure fold over `(recorded event payloads, its own bag)`. The recorded
> payload is the *entire* observable world: event schemas are forbidden to carry timestamps,
> deadlines, account ids, or live references; `api` in replay domains exposes no world queries —
> only `api.state` and `api.roll`. Whatever wall-clock or community-global truth a mod needs is
> baked into the payload at emit time (e.g. `firstEver`, `tier`) and replays as recorded.

The replay×2 gate (dispatch the transcript twice with isolate rebuilds between events,
byte-compare bags + op transcripts) enforces the fold's purity; the event-schema review
checklist (§6) enforces the fence. `loot.ts`'s `Math.random` and the machine's `Date.now()`
stay outside the mod envelope permanently.

### 4.2 Roll coordinates must survive crash recovery

Found under attack: `api.roll` in replay domains hashes `(modId, runId, event seq#, call idx)`.
If the seq# were an in-memory counter, `reconstructRoomForRun` would reset it and a recovered
run would repeat roll values — silent, unfenced nondeterminism across a crash. Rule: the event
seq# is durable — a `run_mod_events (run_id, seq)` counter bumped **in the same transaction** as
the bag write for each dispatched event. Recovery resumes the sequence exactly; the transcript
golden includes a mid-transcript reconstruct to pin this.

### 4.3 Run-persistent state: leave-and-return, recovery, version drift

- **Leave-and-return:** the bag survives under its (run, dimension, mod) key; markers and
  overrides are cleared at `commitTravel` and respawned by the mod from its bag on
  `dimension-entered`. Explicit mod decision, one line, covered by the transcript golden.
- **Recovery:** `reconstructRoomForRun` rehydrates bag, markers, overrides, and the seq counter.
  Nothing lives only in memory.
- **Version drift mid-run:** found under attack — if overworld dispatch read `dimension_mods`
  rows live per event, a regen while a run is active would mutate a live fold, and the hash
  fence would drop bags mid-stride with markers still referencing them. Rule: **the overworld
  mod set is pinned per (run, dimension) at dimension entry** — sources snapshotted into
  `run_dimension_mods (run_id, dimension_id, mod_id, source, source_hash)` on `run-started` /
  `dimension-entered`; every overworld dispatch for that run uses the pinned sources. The fence
  is checked only at pin time and at `reconstructRoomForRun`: on mismatch (regen happened while
  the run was suspended), the drop cascades atomically — bag, markers, overrides, and pending
  prompts for that mod all delete in one transaction, then reseed from the new manifest.
  Encounters are unaffected (they already re-read rows per encounter and embed them per
  snapshot; combat is volatile). Orphaned derived state is unrepresentable.

### 4.4 Serialization and the golden master under new fields

- `state.mods` embeds the full sectioned manifest + code; `modState`/`components`/`__commits`
  ride the snapshot; the golden hash therefore transitively covers every domain's encounter-side
  behavior, exactly as v2 argued.
- Entities serialize whole (`serialization.ts`), so `components` costs no serializer surgery —
  the added tests are the round-trip fixed point and golden N+1. Absent-when-unmodded keeps all
  existing goldens and all sim fixtures byte-identical; the S1 refactor commit and the S4 field
  commit each prove it with an untouched baseline.
- Key-order discipline: bags and component records enforce non-integer-like keys (§1.3), and
  hashing serializes records with sorted keys — the v2 "sorted units view" lesson applied to
  every record a mod can write, so byte-equality never rests on JS property-order folklore.

### 4.5 Golden families (one per determinism surface)

- **Encounter (exists):** byte-exact `(seed, inputs)` scenario hashes. Grows: 23 (data),
  24 (code), N+1 (components/mounted), one entry per new event/op.
- **Overworld (S2):** *transcript goldens* — a committed run-event sequence replayed through
  dispatch; hash covers the op log + final `run_mod_state`; includes a mid-transcript
  reconstruct (§4.2) and a leave-and-return. The A/B rebuild gate applies unchanged.
- **Scene (S5/S7):** declarative scenes hash their choice-tree resolution against scripted
  picks; console scenes hash the draw-op sequence produced by a committed input log (pulses
  included) — the fantasy-console contract makes "render output" a deterministic data structure,
  so it hashes like game state.

Baseline-diff discipline is global: each capability commit adds exactly one entry per family it
touches; any changed existing hash fails review.

---

## 5. The acceptance matrix

Classification **under v3 as specified**, with the slice that opens each surface named — "pure"
always means "pure mod artifact against surfaces this plan schedules." P = pure mod artifact;
A = additive vocabulary (union member + interpreter arm + decl, reviewed once, no core rework).
Re-verified row by row under attack; two rows were downgraded from Design 1's draft for honesty
(B5's composite member is itself vocabulary; B2's chokepoint is vocabulary). **Zero rows require
core rework. The bar holds.**

| # | Mod | Verdict | Opens at | Surface used |
|---|---|---|---|---|
| B1 | Overworld chaser | **P** | S2 | D2 events, `setMarker`/`moveMarker`, `overrideNextEncounter`, run bag, marker render |
| B2 | Factions + joining | **P** (via S9's A-class vocabulary: `hostileTo` chokepoint fold, `interact` event, `offerChoice`) | S9 | allegiance component + run-bag matrix + `aiHints` + reputation |
| B3 | Minigames | **P** | S7 | scene registry, console tier, input-log + pulse |
| B4 | Multi-biome | **P** (data-only) | S8 | `OverworldManifest.biomes`, immutable-after-chart |
| B5 | New attack shape | **P** (via S10's one-time `composite` ShapeKind — itself the A-class diff; a genuinely procedural shape later is another A) | S10 | composite geometry, data on the hot path |
| B6 | Currency + shops | **P** | S5+S6 | run currencies, commits ledger, declarative vendor scene, pool-gated `grantItem` |
| B7 | Mounts | **P** | S4 | component bag, `unitMoved`/`unitKilled`, component-conditioned move rule, attachment sprite |
| B8 | Everything else in this vein | **green by governance** | S9 | see verdict below |
| I1 | Threat overlay | P | S1-vocab | board decals |
| I2 | Music/stingers | P | S8 | audio manifest |
| I3 | Scars (permanent) | A | on demand | `account_mod_state` (designed §1.3) + a build-time placement hook |
| I4 | Elite affixes | A | on demand | one `build:encounterBuild` event in `generateEncounter` + band-validated `addEnemy/modifyEnemy` ops — the "build" domain's first tenant |
| I5 | Bonded pair | P | S1/S4 | `UnitView.seat` + per-seat HUD scoping |
| I6 | Doom-clock contract | A | S6 partial | `contractProgress` ships; declarative goal predicates are the growth |
| I7 | Cross-encounter weather | P | S2+S6 | the run↔encounter bridge (§3.2) |
| I8 | Custom boss AI | P | S9 | `aiHints` decl read at the planner chokepoint |
| I9 | New status | P | S4-vocab | declared statuses |
| I10 | Dialogue encounter | P | S5 | declarative choice scene |
| I11 | Telemetry HUD | P | S1-vocab | events → bag → `table` widget |
| I12 | Cosmetic reskin | P | S1-vocab | override maps |
| I13 | Accessibility remap | **out of kernel, by policy** | — | client-local tier; no determinism surface |
| I14 | Cross-player race | **impossible by design** | — | no cross-player referent exists in any union; a feature, not a gap |

**B8 verdict (G1–G3):** 16 of 20 traced rows are pure artifacts; the 4 A-rows are each the exact
three-diff pattern v2 proved, now available per domain; additivity is structural because there
is *one* dispatch/validate/interpret core parameterized N ways — a new capability has exactly
one place to land, and that place only grows unions. The matrix is a **standing test**: at every
slice boundary, all rows are re-classified; any row regressing to "core rework" fails the
*slice*, not the mod.

---

## 6. Vocabulary governance

- **Closed but growable.** Every event/op/decl union is a Zod discriminated union. *Adding* a
  member is non-breaking by construction — old mods neither emit nor receive it — and ships
  without a `contractVersion` bump. *Changing or removing* a member's semantics, or touching
  fuel/prelude/api-wrapper behavior, is `contractVersion: 4`. One global version per artifact.
- **The shipping unit for one vocabulary item** (reviewed once, one commit, five small diffs):
  union member + Zod arm → interpreter arm → `api.*` wrapper (code tier) and/or decl schema
  (data tier) → `API.md` entry with one canonical example and its failure mode → golden/fixture
  coverage (byte-exact domains: a fixture-mod usage churning exactly one baseline entry; replay
  domains: a transcript-gate case).
- **Admission rule:** a forcing mod in hand — rule of three for speculative shapes, one concrete
  demanded mod for direct requests (B5's composite is the model). Never speculative.
- **Review checklist per addition:** no cross-player/cross-dimension referent (§3.5); no
  dispatch on a hot path (decision 3); deterministic given its domain's declared inputs — and
  for replay domains, **no timestamp/deadline/account-id/live-reference in any event payload**
  (§4.1); misuse throws with a fix-naming message (the LLM compile loop is its error messages);
  documented no-op semantics for dead/absent targets wherever cascades can reach them.
- **What keeps old mods working forever:** snapshots embed mods; unions only grow; fuel and
  semantics are frozen per version; durable bags are droppable by fence contract. An old mod
  under a new server sees a strict superset of the surface it was written against.

---

## 7. Sequencing — the idea PR and the F-slices

### 7.1 The idea PR (S1): the v2 slice rebuilt as domain #1, born-generic contract

Everything in v2 §8 stands — the seven ordered commits, the cut order, the never-cut list — with
these deltas:

- **Commit 2** ships the *sectioned* manifest (§1.4): `{contractVersion: 3, …, encounter?,
  code?}` with `overworld`/`run`/`scenes`/`components`/`audio` reserved (accepted key, loud
  "opens in S<n>" error). `code.events` entries are namespaced (`"encounter:turnStart"`).
- **Commit 3** writes the sandbox host, interpreter, and compile chokepoint against the
  `DomainSpec` seam with exactly one registered instance: `compileModRules` becomes
  `compileDomain(ENCOUNTER_SPEC, …)`; call sites are one-liners. Goldens 23+24 identical in
  content, fixture mods rewritten in sectioned/namespaced form (hashes are new baselines,
  added-not-changed); the refactor shows a byte-identical baseline for everything pre-existing.
- Commits 1, 4–7 (template-registry refactor; server load path; dim-708 showcase — Emberheart,
  Bloodprice, Ember Wake; web HUD/prediction; sim capture) are v2's verbatim.
- **Not in S1:** no overworld code, no `run_mod_state`, no scenes. The second domain is a
  separate PR on purpose — v2's red team caught a 2x on a smaller slice; welding domain #2 in
  would make a 3-session PR pretend to be one.

**S1 kill-switch (born-generic insurance):** if the DomainSpec parameterization churns any
existing golden or costs more than half a session over the v2 shape, revert to v2's concrete
`compileModRules`/`interpretOps` and extract the seam in S2 (strangler-classic). The sectioned
*schema* ships regardless — that is the part with contract-version-burn cost.
**S2 honesty check:** slice 2's diff must touch no file under `shared/src/combat/` and no
encounter interpreter arm; if instantiating spec #2 forces edits inside domain #1, the
abstraction was wrong — fall back to per-domain copies before more domains pile on.

### 7.2 Why overworld is domain #2

- The events-in surface already exists (`run-events.ts` — typed, synchronous, fail-loud,
  registry-ordered); S2 exposes, it doesn't build.
- Dispatch is server-only (the cheap determinism class — no client sandbox work, no prediction).
- The chaser exercises every quartet slot (bus events, staged ops, run bag + rehydration +
  fence + pin, marker render) plus one cross-domain bridge (`overrideNextEncounter`).
- Its *different* determinism class is the proof of generality: if the quartet only hosts
  combat's envelope, it isn't a pattern.
- Against run-state as #2: it isn't a quartet (no events of its own worth proving, no render
  loop) — it rides inside S2 as `run_mod_state`, where the chaser needs it anyway.
- Against scenes as #2: the three nastiest core seams (outcome funnel, `routeScene`, wire
  protocol) plus the hardest open tension (minigame input authority) all live there. Proving
  generalization on the most expensive domain is backwards.

**S2 demo: "Ashen Hound" (dim-708)** — Ben's mod #1, verbatim, as a pure artifact: spawns a
marker after the third `encounter-won` (position via `api.roll`, stored in the run bag), steps
one hex toward the party per subsequent win, stages `overrideNextEncounter` on contact, respawns
its marker from its bag on re-entry. Plus "Waystones" (data-only markers near gateway-adjacent
hexes; cuttable) to prove the data tier exists in D2.

### 7.3 The full sequence, with pessimistic estimates

Estimates: v2's red team caught 2x on a slice its author called "one focused session." The same
skepticism is applied here to *every* row the optimistic draft authored — the planning number is
the pessimistic column. Every slice is an independently shippable PR: green typecheck, green
goldens with only-added baselines, its demo mod playable, and (post-S3) its pipeline artifacts
shipped (§8).

| # | Slice | Opens | Demo | Optimistic | **Plan on** | Green |
|---|---|---|---|---|---|---|
| S1 | Idea PR: generic core + encounter domain | D1 on DomainSpec; sectioned schema | Emberheart, Bloodprice, Ember Wake | 2 | **3** | foundation |
| S2 | Overworld + run state | D2 quartet; `run_mod_state` + pin + seq; staged-intent seam; markers; transcript goldens; run-sim harness stub | Ashen Hound (+ Waystones) | 1.5 | **2.5** | **B1** |
| S3 | Opus pipeline, domain-aware | `upsert-mod.ts`, per-domain capability cards, `mod-critic.ts` gates 1–5, workflow Mods phase, domain choice in modConcepts | Cinderfall + Pyre Clock regenerated; first generated overworld mod | 2 | **3** | throughput |
| S4 | Component bag + F1 events | components on `Entity`, `setComponent`, `when:{component}`, `unitMoved`/`abilityUsed`, declared statuses, attachment sprites, golden N+1 | Mounts | 2 | **2.5** | **B7**, I9 |
| S5 | Outcome + scene registry, declarative tier | `EncounterOutcome` at `endCombat`; kind tag; `routeScene` third arm; choice scenes; commits ledger | Dialogue encounter (I10) | 2.5 | **4** | I10; unlocks B3/B6 |
| S6 | Run economy | currencies + pips, commits banking, pool-gated `grantItem`, vendor scene, faucet-band sim pass | Currency + shop dimension | 1.5 | **2** | **B6**, I7 |
| S7 | Minigame code loop | console contract, input-log stream + pulse, replay validation, tick-driver harness | A playable minigame | 3 | **5** | **B3** |
| S8 | Biomes + audio | `biomes` decl, immutable-after-chart, audio manifest | Two-biome dimension | 1.5 | **2** | **B4**, I2 |
| S9 | Factions | allegiance + `hostileTo` chokepoint, `interact` + `offerChoice`, reputation, `aiHints` | Joinable faction | 1.5 | **2.5** | **B2**, I8 |
| S10 | Composite shape | one `composite` ShapeKind | Ring/cross weapon | 1 | **1** | **B5** |

**Totals: 18.5 optimistic; plan on ~28 focused sessions.** The scene arc (S5–S7) is 11 of the
28 — the engine milestone is genuinely expensive and this plan does not hide it. Checkpoints:
after S2 (was the seam right? — the no-touch check), after S5 (did outcome generalization stay
inside the measured seams?), before S7 (go/no-go on full console vs the scalar fallback).

**Placement rationale, the load-bearing three:** pipeline at S3, not last — every later slice
gets generated content against its new domain immediately, which is continuous QA of the
domain's LLM-friendliness, and the domain-choice machinery is built against a real choice (two
domains exist). Component bag at S4 — after the pipeline, before mounts/factions need it, at its
rule-of-three moment. S5 before S6/S7 — the outcome/routing seams are shared prerequisites of
shops and minigames; prove the registry on a one-session consumer (choice scenes) before the
five-session one.

**Kill-criteria (checked mid-slice):** S1/S2 above. S5: if outcome generalization ripples past
`endCombat`/`settleRun`/contract recorders into the resolver, stop — the seam is wider than
measured; re-scope to outcome-only, defer routing. S7: if committed-input-log replay can't reach
cross-host byte-equality within one session of debugging, fall back to scalar-outcome skill
inputs only (the shipped defend-prompt precedent) — B3 ships weaker (timing/skill scalars
feeding a declarative loop) and full loops return when replay is solved in isolation.

**Cut-first per slice (cuts, not optimism):** S1 keeps v2's order verbatim. S2: Waystones, then
transcript-golden *tooling* (keep one hand-run transcript as evidence); never the hash fence,
the pin, the seq counter, or the staged-intent shape. S3: gate 5 first, regen demos second;
never the A/B rebuild gate. S4: attachment sprites (mounts work, look wrong); never the
round-trip test or golden N+1. S5: scene-HUD polish; never the outcome generalization or the
commits ledger. S6: vendor polish; never pool-gating. S7: sprite-vocabulary breadth (rects+text
first) and the pulse (input-only first); never replay validation. S8: per-biome music; never
chart-immutability. S9: reputation UI; never `hostileTo` determinism. S10: one session or it
isn't done.

Order flex: S8 is dependency-free after S3 and can move earlier under content pressure; S10 can
land any time.

---

## 8. The Opus pipeline across domains

S3 lands v2 §6's Mods phase whole (gate ladder 1–5, prompt shape, regen hygiene), plus the rules
that keep the surface LLM-sized as domains multiply — because the end-state surface (six
domains, ~25 ops, ~15 events, a dozen decl schemas) is too much for one prompt, and pretending
otherwise would silently degrade generation quality:

- **Per-domain capability cards.** One card per open domain: every event/op/decl with signature,
  one canonical example, its failure mode, and the domain's determinism policy in one sentence
  ("overworld: deterministic per event; no prediction; no per-frame anything"). The card states
  what `api.state` means *in this domain*.
- **The mod agent sees only the domains its concept needs.** The Spec phase's `modConcepts`
  gains a `domains` field (enum grows per slice); the prompt loads those cards plus the bridge
  card (§3) only when the concept spans. A mod touching more than two domains is a critic WARN —
  sprawl is a smell in generated content.
- **Few-shot per domain:** each slice's demo mod, dumped from DB, is that domain's example. The
  growth contract: **a domain isn't open until Opus can author in it** — every domain-opening
  slice ships its capability card, its few-shot demo, and its gate-3/4 harness hook as part of
  its definition of done.
- **Naming uniformity as an API rule:** verbs mean the same thing everywhere (`give*` clamps,
  `spend*` throws, `set*` replaces); an LLM's cross-domain transfer is a governance concern, not
  luck.
- **Gates dispatch on domain.** Gates 1–2 (schema/static; A/B rebuild + determinism) are
  generic. Gates 3–4: encounter mods run the arena2 battery with paired-seed
  decision-divergence; overworld mods run the run-sim harness with the explorer-bot divergence
  metric (fraction of moves where a greedy scripted explorer picks a different hex, modded vs
  unmodded — the Hound scores high by construction; a marker-repainter scores ~0 and gets
  FAIL-for-code/WARN-for-data); minigames substitute completion fuzz (seeded input logs must
  reach both win and loss within bounded ticks) + replay equality + the outcome-stakes check
  (rewards route through pool-gated vocabulary only). Gate 5 (distinctiveness corpus) is shared,
  with per-domain op-trace signatures.

---

## 9. Honest costs

v2 §9's ledger stands in full (wasm-in-the-kernel, 281 KB client chunk, frozen-per-version
surface, gate-enforced state law, two front-ends one interpreter, mediocrity-passes-gates, the
view as forever-surface). New in v3:

- **The DomainSpec seam is permanent surface.** Every future domain inherits its shape; a
  mistake in S1/S2 propagates. Mitigated by the S2 no-touch check and by keeping the seam
  minimal (§1.1) — but it is a bet, and the kill-switch exists because bets can lose.
- **Three determinism envelopes, not one.** Byte-exact, replay-transcript, and input-log-fold
  each have their own gate machinery and their own mental model. The alternative — one envelope
  — is a lie the overworld disproves; the cost is real and accepted.
- **~28 pessimistic sessions to all-green**, 11 of them in the scene arc. The acceptance matrix
  is green *at end of sequence*; Ben's mods go green one slice at a time (B1 at S2, B7 at S4,
  B6 at S6, B3 at S7, B4 at S8, B2 at S9, B5 at S10).
- **Capability cards are living docs that MUST ship with slices.** If that discipline slips,
  Opus authors against stale surface and the ladder catches it late and expensively. The
  definition-of-done rule (§8) is the mitigation; it depends on review culture, not mechanism.
- **Pinned-per-run overworld sources** (§4.3) mean a regen doesn't reach live runs — correct,
  but it also means a broken overworld mod haunts a run until it ends or travels. Accepted:
  runs are hours, not weeks, and the alternative (live mutation of a fold) is worse.
- **v1 minigames will disappoint someone** — no smooth motion, no hidden information, 4 Hz
  ceiling. The fence is written down (§2.5a) so the disappointment is a documented boundary,
  not a discovered one.

---

## 10. Rejected alternatives

v1's and v2's rejection ledgers stand in full (expression language; component bag *then*;
per-row fuel; 32 KiB cap; separate CodeModDefinition; boot-time wasm preload;
skip-prediction-on-fault; throw-on-any-unknown-id; trusting stored sourceHash; five demos;
pure-LLM fun gate). New in v3:

- **Retrofit-generic (extract the DomainSpec when domain #2 lands).** Classic strangler
  discipline, but the manifest schema is versioned surface: retrofitting sections after rows
  exist is a contractVersion burn plus a row migration, and today zero rows exist. Contract born
  generic; machinery single-instance; kill-switch if the bet sours.
- **Second domain inside the idea PR.** v2's red team caught 2x on a smaller slice; a welded PR
  is a 3-session PR pretending to be one. The reserved schema section makes the N-domain claim
  legible without the code.
- **Run-state or scenes as domain #2.** Run-state proves nothing (not a quartet — storage, no
  loop); scenes prove everything at maximum price on top of the three nastiest core seams.
  Overworld is the cheap honest proof.
- **`offerChoice` through `room.vote`.** Single slot, phase-guarded, core-owned; a mod prompt
  there is a deadlock factory. Separate FIFO prompt queue, core always preempts, terminal event
  guaranteed (§2.2a).
- **Live per-event reads of `dimension_mods` for overworld dispatch.** A regen mid-run would
  mutate a live fold and cascade fence-drops mid-stride. Pin at dimension entry (§4.3).
- **In-memory event seq for `api.roll`.** Repeats rolls after crash recovery — silent
  nondeterminism. Durable counter, transactional with the bag (§4.2).
- **Byte-exact-from-seed for the overworld.** The overworld is wall-clock and vote-driven
  (`Date.now()` deadlines, human timing); claiming seed-replay would be a fiction the gates
  can't enforce. Replay-deterministic class with the event-boundary rule instead.
- **Frame-driven or client-clocked minigames.** Per-frame dispatch violates the hot-path law;
  client clocks diverge. Input-log fold plus a server-metered ≤4 Hz pulse recorded in the log.
- **An overworld entity/actor system in v1.** The chaser is a marker + a bag; three forcing
  mods with per-actor state buy `run_overworld_actors` later, additively.
- **Cross-domain ops by convention ("encounter handlers just shouldn't emit overworld ops").**
  Convention doesn't survive generated code. The boundary is typed three ways (§3): per-domain
  Zod unions at dispatch, per-domain api objects, bridges as explicit union members applied only
  at boundaries.
- **One flat `api` across domains.** Six domains of verbs in every prompt and every isolate
  bloats the surface an LLM must hold and lets wrong-domain calls exist until runtime. Per-domain
  api + per-domain cards; wrong-domain calls fail at dispatch with a naming error.

---

## 11. Open questions for Ben

- **OQ-1 — Minigame pulse in v1.** Input-only scenes are fully deterministic but nothing moves
  without a player action (no Snake, no timers). The ≤4 Hz server-metered pulse (§2.5a) is
  recorded in the input log, so replay stays byte-exact, but it adds a real-time-ish code path
  to S7. Ship the pulse in S7, or ship input-only and add the pulse when a mod forces it?
  *Recommendation: ship the pulse in S7 behind the `pulseHz` decl (default 0) — it is one event
  type and a server interval, it doubles the genre space, and retro-adding clocks to a shipped
  determinism contract is worse than fencing one now.*
- **OQ-2 — Born-generic vs extract-at-S2.** The sectioned manifest ships in S1 either way (zero
  rows exist; later is a version burn). The question is the `DomainSpec` seam: written in S1
  with one instance, or extracted in S2 when the second consumer lands? *Recommendation:
  born-generic with the S1 kill-switch (revert if it churns a golden or costs >0.5 sessions) and
  the S2 no-touch honesty check — the second consumer's event list, ops, keying, and render
  channel are already written down, so this is abstraction toward a known client, not a guess.*
- **OQ-3 — Overworld mod pinning granularity.** Pin sources per (run, dimension) at entry
  (§4.3) means a regenerated mod doesn't reach in-flight runs until they travel or end.
  Alternative: re-pin at every `dimension-entered` including re-entry, so returning to a
  dimension picks up the regen (and eats the fence-drop). *Recommendation: re-pin on every
  `dimension-entered` — leave-and-return already has explicit re-entry semantics (marker
  respawn), the fence cascade is designed for exactly this, and it shortens the haunted-run
  window to one dimension visit.*
- **OQ-4 — Which number gates the roadmap.** 18.5 optimistic vs ~28 pessimistic sessions; the
  scene arc (S5–S7) is 11 of the 28. Commit to the full sequence now, or commit through S4 and
  hold a go/no-go on the scene arc with the S5 seam evidence in hand? *Recommendation: plan on
  28, commit through S4 now, and make S5's outcome-generalization commit the explicit go/no-go
  for S6–S7 — it is the cheapest probe of the most expensive unknown, and B6/B3 are the only
  wishlist rows behind it.*
- **OQ-5 — Prompt UI vs vote UI for `offerChoice`.** The separate FIFO prompt queue (§2.2a)
  costs a small new client surface; reusing the vote UI costs collision rules with core votes.
  *Recommendation: the separate queue — the single `room.vote` slot is load-bearing core
  machinery, and "mods never block core transitions" should be structural, not scheduled.*
- **OQ-6 — Per-seat scene views.** v1 scenes are one shared grid; hidden-hand card games and
  asymmetric-information minigames are impossible until per-seat views exist (a real quartet
  growth: per-seat view builder + per-seat draw ops). *Recommendation: defer until a forcing
  mod; note it in the scene capability card so Opus doesn't generate hidden-information designs
  that can't ship.*
- **OQ-7 — `account_mod_state` timing.** The account bag (scars, I3) is designed (§1.3) but
  unscheduled. Ship the table opportunistically in S2 beside `run_mod_state` (cheap, same
  shape), or strictly on demand? *Recommendation: on demand — an empty permanent table is
  surface without a consumer, and the fence contract makes adding it later a non-event.*
- **OQ-8 — carried from v2, still open:** OQ-A (wasm-bump policy — recommendation stands:
  golden re-lock, not dual-wasm), OQ-B (decision-divergence floor 10%, FAIL-code/WARN-data —
  now also the explorer-bot floor for overworld), OQ-D (mod-critic timing — defer to S3 with
  "no new mods before S3" as the rule). Resolved by v3: v2's OQ-E/OQ-1 (component bag — S4, the
  rule of three arrived), OQ-C (demo scope — three demos confirmed; Cinderfall/Pyre Clock regen
  at S3).

---

## v2 kernel — carried forward unchanged

The following v2 sections remain in force **verbatim** as the encounter-domain instantiation and
shared kernel; v3 changes their packaging (namespaced events, sectioned manifest, `compileDomain`
call shape), never their semantics. See plan v2 in git history (`docs/modding/plan.md` prior to
this commit) for the full text:

- **§1 the mod artifact** — `dimension_mods`, ownership guard, 8 KiB cap, contractVersion
  freeze rule, `code.events` declaration≡registration, where-it-lives module map.
- **§2 the capability API** — the pure-handler law; namespaced `modState` slices; the full
  `api` read/effect surface with `alive`-flag semantics, no-op-on-dead contract, and
  fix-naming error messages; the four-event catalog with both turn-start traps; the
  data-vs-code decision rule.
- **§3 execution model** — per-mod isolates, lifecycle at `createEncounter`/`endCombat`,
  content-addressed caching with locally-recomputed hashes, transactional fault semantics,
  client prediction mechanics (conditional wasm preload, fail-loud on client dispatch fault),
  code-never-touches-rendering, fuel constants, the fail-loud ladder rungs 1–4, the threat
  model.
- **§4 determinism & the golden master** — the five mechanical properties; sourceHash as
  integrity never authority; hash coverage semantics; scenarios 23+24; baseline-diff
  discipline.
- **§5 dimension scoping and the no-interaction invariant** — the active-mod-set function; the
  gateway transition walkthrough; hotload as the absence of an operation; the full channel
  table (v3 §3.5 extends it with the new run-scoped channels).
- **§6 the Opus pipeline** — prompt shape, the five-gate ladder, regen hygiene (v3 §8 layers
  domain awareness on top).
- **§7 demo mods** — Emberheart, Bloodprice, Ember Wake, the hotload QA script.
- **§8 the idea-PR slice** — the seven commits, cut order, never-cut list (v3 §7.1's deltas
  apply).
- **§9 honest costs and the rejected-alternatives ledger.**

## v1 addendum — pointer

v2 carried a "v1 addendum — what carries forward unchanged" inventorying the v1 data-tier plan's
surviving decisions (mod-as-row, the two channels, scoping, ladder rungs 1–2 + cross-checks,
declarative frontend, sim story, Emberheart, F1/F2 follow-up content). That addendum carries
forward with v2's kernel, unmodified — see the v2 document in git history. Nothing from v1 or v2
is silently lost: v1 survives inside v2's kernel; v2's kernel survives inside this plan.
