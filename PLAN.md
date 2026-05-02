# Turn-Based Strategy Game — Implementation Plan

## Tech Stack

- **Frontend:** TypeScript + Pixi.js (2D WebGL renderer, not a game engine)
- **Backend:** TypeScript on Node.js/Bun (shared language = shared game logic types)
- **Networking:** WebSockets (`ws` package)
- **UI:** HTML/CSS overlay for menus/HUD, Pixi.js canvas for game viewport
- **Build:** Bun workspaces monorepo, Vite for client, tsx for server dev
- **Testing:** Vitest

## Architecture Decisions

- **Server-authoritative:** Client sends intent, server validates and resolves, broadcasts new state. Client is for input and display only.
- **Sequential turns:** Not simultaneous. Each action resolves against a known stable state. Eliminates combinatorial edge cases.
- **Snapshot state model:** Each turn produces a complete self-contained GameState. No event sourcing, no delta tracking. Any bug is reproducible from one snapshot + the action applied.
- **Designed for both PvP and co-op.**

## World & Collision

- **Freeform positioning** for entities and combat — continuous coordinates for rendering and gameplay.
- **Hidden grid overlay** for collision and pathfinding only. Small tiles (e.g. 4-8px). Not visible to players.
- **A\* pathfinding** on the grid. Simple, well-understood, trivial dynamic updates (flip cells on/off).
- **Entity collision enforced** — each entity has a collision radius, no overlap allowed. Deterministic, inspectable state.
- **Walls and structures** rasterized onto the grid. Supports dynamic placement (procedural generation, class abilities placing structures mid-game).

## Combat System

- **4 combat shape primitives:** circle (AOE), rectangle (spear/beam), sector/arc (sword sweep), point (single target). Every weapon/ability picks one and configures parameters.
- **Instant projectile resolution:** Ray-cast from origin in aim direction, find first entity or wall hit, apply effect. No simulated projectile movement. Client animates the visual, server resolves instantly.
- **Fireball = ray-cast to impact point, then circle AOE at that point.**
- **Shields are physical geometry** — wall segments placed on the grid, interact with the same systems as every other wall. Visible, testable, no hidden modifiers.

## Design Philosophy

- Optimize for debuggability, not development speed. Prefer systems that once correct stay correct.
- Prefer visible spatial state over hidden modifiers.
- Prefer atomic one-shot resolution over multi-step simulation.
- Avoid unnecessary abstraction. Don't design for hypothetical future needs.

---

## Project Structure

```
turn-based-strategy/
  package.json                    # Root workspace config
  tsconfig.json                   # Base TS config
  .gitignore
  shared/
    package.json
    tsconfig.json
    src/
      index.ts                    # Barrel re-export
      types/
        game-state.ts             # GameState, Entity, Player, Team
        actions.ts                # PlayerAction union type
        combat.ts                 # CombatShape, WeaponDefinition, AttackResult
        geometry.ts               # Vec2, CollisionCircle
        messages.ts               # WebSocket message types (client<->server)
      math/
        vec2.ts                   # Vec2 operations (add, sub, normalize, distance, dot, etc.)
        geometry.ts               # Shape intersection functions (circle, rect, sector, point)
        ray.ts                    # Ray-cast against grid + entities
      grid/
        collision-grid.ts         # Boolean grid, rasterize walls, query walkable cells
        pathfinding.ts            # A* on collision grid
      combat/
        shape-resolver.ts         # Given a CombatShape + origin + aim, return affected entities
        damage.ts                 # Apply damage/effects, produce new entity states
      validation/
        action-validator.ts       # Validate a PlayerAction against current GameState
      serialization.ts            # Serialize/deserialize GameState (Maps, Uint8Array)
  server/
    package.json
    tsconfig.json
    src/
      index.ts                    # Entry: create HTTP server, attach WebSocket
      lobby/
        lobby.ts                  # Game rooms, player connections, matchmaking
      game/
        game-session.ts           # One active game: holds GameState, processes turns
        turn-resolver.ts          # Takes GameState + PlayerAction, returns new GameState
      network/
        ws-server.ts              # WebSocket server, connection handling, message routing
        connection.ts             # Per-player connection wrapper
  client/
    package.json
    tsconfig.json
    index.html
    vite.config.ts
    src/
      main.ts                     # Entry: init Pixi app, connect to server
      network/
        ws-client.ts              # WebSocket client, send actions, receive state
      renderer/
        game-renderer.ts          # Pixi.js stage management, camera
        entity-renderer.ts        # Draw entities at their positions
        grid-debug.ts             # Optional: visualize collision grid for debugging
        effects.ts                # Animate projectiles, AOE visuals, etc.
      input/
        input-manager.ts          # Mouse/keyboard -> intent
        targeting.ts              # Aim preview, shape preview overlay
      ui/
        hud.ts                    # HTML/CSS overlay: health bars, turn indicator
        menu.ts                   # Main menu, lobby UI
      state/
        client-state.ts           # Holds latest GameState snapshot from server
```

### What Lives in `shared/` (and Why)

The shared package contains everything the server needs for game logic and everything the client needs to understand game state, but zero rendering or networking code.

- **Types** — The lingua franca. `GameState`, `Entity`, `PlayerAction`, `CombatShape`, WebSocket message envelopes. All `readonly` — GameState is a snapshot, never mutated.
- **Math** — Vec2 arithmetic, shape intersection tests, ray-casting. Used by both server (hit detection) and client (targeting preview). One source of truth.
- **Grid** — CollisionGrid class and A* pathfinding. Server uses for validation, client could use for movement preview.
- **Combat resolution** — Pure functions: `resolveAttack` takes attacker + weapon + aim + entities + grid, returns which entities are hit.
- **Action validation** — Pure function: `validateAction` checks if an action is legal given the current GameState.

---

## Phased Implementation

### Phase 0: Project Scaffolding

Create the monorepo structure, get all three packages building and typechecking.

- Root `package.json` with bun workspaces `["client", "server", "shared"]`
- Root `tsconfig.json` (strict, ES2022, ESNext modules, bundler resolution)
- Each package gets its own `package.json` and `tsconfig.json`
- Server: raw `http.createServer` (no express needed yet)
- Client: Vite + Pixi.js, renders a colored rectangle
- `.gitignore` for node_modules, dist, bun.lock, .tsbuildinfo, .vite

**Verification:** `bun install && bun run typecheck` passes. `bun run dev` starts both client (Vite on 5173) and server (tsx watch on 3000). Browser shows the Pixi canvas.

### Phase 1: Core Types & Vec2 Math

All in `shared/`. The foundation everything else builds on.

**Types:**
```typescript
interface GameState {
  readonly turnNumber: number;
  readonly activeTeam: TeamId;
  readonly entities: ReadonlyMap<EntityId, Entity>;
  readonly grid: GridState;
  readonly teams: ReadonlyMap<TeamId, Team>;
}

interface Entity {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly collisionRadius: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly teamId: TeamId;
  readonly class: EntityClass;
  readonly actionsRemaining: number;
  readonly movementRemaining: number;
}

type PlayerAction =
  | { type: "move"; entityId: EntityId; path: Vec2[] }
  | { type: "attack"; entityId: EntityId; weaponId: string; aimDirection: Vec2 }
  | { type: "useAbility"; entityId: EntityId; abilityId: string; target: Vec2 }
  | { type: "endTurn" };

type CombatShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rectangle"; origin: Vec2; direction: Vec2; width: number; length: number }
  | { kind: "sector"; origin: Vec2; direction: Vec2; radius: number; halfAngle: number }
  | { kind: "point"; targetId: EntityId };
```

**Vec2:** Pure functions — `add`, `sub`, `scale`, `normalize`, `length`, `distance`, `dot`, `cross2d`, `rotate`, `angle`, `lerp`, `equals` (with epsilon). All return new Vec2, never mutate.

**Verification:** All types compile. Vitest set up. Trivial test constructs a GameState and asserts on a field.

### Phase 2: Collision Grid & Pathfinding

All in `shared/`. Fully headless-testable.

**CollisionGrid:**
- `Uint8Array` backing store, flat index `cy * width + cx`
- `createGrid`, `worldToCell`, `cellToWorld`, `isBlocked`, `setBlocked`
- `rasterizeRect`, `rasterizeCircle`, `rasterizeLineSegment` — mark cells as blocked
- `isPositionWalkable(grid, pos, collisionRadius)` — check all cells within entity radius
- Copy-on-write: returns new GridState with updated walls array

**A\* Pathfinding:**
- `findPath(grid, from, to, collisionRadius): Vec2[] | null`
- 8-directional with diagonal cost sqrt(2)
- Accounts for entity collision radius (checks circle of cells around each candidate)
- Returns world-coordinate waypoints, null if no path

**Tests:**
- Empty grid: straight-ish path from A to B
- Wall across middle: path goes around
- Enclosed position: returns null
- Large entity can't fit through narrow gap

### Phase 3: Combat Geometry

All in `shared/`. The core combat math — heavily unit-tested since subtle bugs hide here.

**Shape intersection tests (pure functions):**
- `pointInCircle(point, center, radius)`
- `pointInRectangle(point, origin, direction, width, length)` — transform to local space
- `pointInSector(point, origin, direction, radius, halfAngle)` — distance + angle check
- `circleIntersectsSegment(center, radius, segA, segB)` — for ray vs entity

**Ray-casting:**
- DDA (digital differential analyzer) on the grid
- Checks walls (blocked cells) and entity collision circles
- Returns first hit: `{ type: "entity", entityId, point, distance }` or `{ type: "wall", point, distance }` or `{ type: "none" }`

**Attack resolution:**
- `resolveAttack(attacker, weaponDef, aimDirection, entities, grid): AttackResult`
- Point weapon: ray-cast, return first entity hit
- Rectangle: all entities whose collision circle overlaps the rect
- Sector: all entities in the arc
- Fireball: ray-cast to impact point, then circle AOE there

**Tests:**
- Entity in front of attacker with rectangle weapon: hit
- Entity off to the side: miss
- Wall between attacker and target with point weapon: ray hits wall
- Sector at 45deg half-angle: entity at 44deg hit, entity at 46deg miss
- Fireball hits wall, AOE catches entity near impact

### Phase 4: Turn Resolution

The heart of the game. Pure function, no side effects.

```typescript
function resolveAction(state: GameState, playerId: string, action: PlayerAction): GameState
```

- **Validate** the action (correct turn, entity ownership, resources available, path valid)
- **Apply** based on type:
  - `move` — update entity position, deduct movement
  - `attack` — call `resolveAttack`, apply damage, remove dead entities, deduct action
  - `useAbility` — ability-specific (e.g., place shield = rasterize wall onto grid + create shield entity)
  - `endTurn` — advance to next team, reset actions/movement
- Every branch returns a **complete new GameState**. The old one is never mutated.

**Tests (all headless, no networking):**
- Two entities, submit move: position changes, movement decremented
- Submit attack: target takes damage
- Action for wrong team: rejected
- Move to blocked cell: rejected
- Kill entity: removed from state
- End turn: active team changes

### Phase 5: Networking

**Server:**
- `ws` package, attached to HTTP server
- On connection: assign player ID, create Connection wrapper
- Parse `ClientMessage`, dispatch to lobby or game session
- Lobby: create/join game rooms, start GameSession when ready

**Shared serialization:**
- `serializeGameState` / `deserializeGameState` — handles Map and Uint8Array conversion

**Client:**
- WebSocket client: `send(ClientMessage)`, `onMessage(ServerMessage)` with typed callbacks
- Simple reconnection logic

**Verification:** Two browser tabs connect, join same game, see "game started."

### Phase 6: Client Rendering

**Renderer:**
- Pixi.js Application with camera (offset + zoom, pan with WASD/middle mouse, zoom with scroll)
- Entities as colored circles (radius = collision radius), different colors per team
- Health bars above entities, highlight for active entity

**Input:**
- Click own entity to select
- Right-click ground to move (show path preview using shared pathfinding)
- Click enemy to attack (show weapon shape preview using shared geometry)

**Targeting overlay:**
- Semi-transparent shape preview while aiming
- Uses the *same shared geometry code* the server uses for hit detection

**HUD:**
- HTML/CSS overlay: turn indicator, selected entity stats, action buttons

**Verification:** Two browser tabs can play a basic game — move, attack, see health change, turns alternate.

### Phase 7: Maps & Content

**Map generation:**
- Start simple: rectangular arena with random wall clusters
- Returns a `GridState` with walls rasterized
- Designed to be replaced/extended with more interesting generators later

**Weapon definitions (plain data):**
```typescript
shortSword: { shape: "sector", radius: 40, halfAngle: PI/4, damage: 20, actionCost: 1 }
spear:      { shape: "rectangle", length: 80, width: 10, damage: 15, actionCost: 1 }
fireball:   { shape: "circle", range: 200, blastRadius: 50, damage: 30, actionCost: 2 }
bow:        { shape: "point", range: 300, damage: 12, actionCost: 1 }
```

**Entity classes:**
- Warrior (high HP, sword + shield ability)
- Ranger (bow, trap ability)
- Mage (fireball, wall ability)

### Phase 8: Polish & Advanced Features

- **Shield ability:** Places wall geometry on the grid. Blocks movement, projectiles, line of sight. Can be destroyed (has HP).
- **Client animations:** Projectile flight, slash arcs, explosions — purely visual, server already resolved.
- **Co-op mode:** Multiple players on same team, each controlling subset of entities.
- **Fog of war:** Ray-cast visibility from active team's entities. Server sends filtered state.
- **Game replay:** Array of GameState snapshots played back. Nearly free given snapshot architecture.
- **Debug overlay:** Toggle collision grid, collision radii, attack shapes, pathfinding visualization.

---

## Testing Strategy

Phases 1-4 are fully testable without a browser or network:

- **`shared/` tests** — vitest, pure functions. No mocking needed.
- **`server/game/` tests** — construct GameStates in code, call `resolveAction`, assert on results. No WebSocket.
- **Integration tests** — create a GameSession programmatically, feed a sequence of actions, assert final state.
- **Client** — manual testing in browser. It's just a display layer.

```
shared/src/__tests__/vec2.test.ts
shared/src/__tests__/collision-grid.test.ts
shared/src/__tests__/pathfinding.test.ts
shared/src/__tests__/geometry.test.ts
shared/src/__tests__/ray.test.ts
shared/src/__tests__/shape-resolver.test.ts
shared/src/__tests__/action-validator.test.ts
server/src/__tests__/turn-resolver.test.ts
server/src/__tests__/game-session.test.ts
```

---

## Key Design Properties

1. **`resolveAction(state, action) -> newState`** — The entire game is a reduce over actions. Any bug is reproducible from one state + one action.
2. **Shared code** — Client targeting preview uses the exact same geometry functions as server hit detection. No divergence possible.
3. **Sequential turns** — Only one action processed at a time against a known stable state. No race conditions.
4. **Grid is internal only** — Players and combat use freeform coordinates. The grid just answers "can I stand here?" and "how do I get there?"
5. **Visible state** — Shields are walls. Combat shapes are geometry. Everything is inspectable and spatial. No hidden modifiers.
