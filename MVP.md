# MVP: Visual Prototype

Goal: Two entities on screen, you can move them and attack, and see the results visually. Single player, no networking — just the core game loop running in the browser.

## What's Included

1. Scaffolding (monorepo, Pixi canvas)
2. Core types (GameState, Entity, Vec2 — slimmed down)
3. Collision grid (basic grid, a few hardcoded walls)
4. One combat shape (sector / sword swing)
5. Turn resolver (move + attack, runs in the client directly)
6. Renderer (entities as circles, walls, health bars)
7. Input (click to select, right-click to move, click to attack)
8. Targeting preview (sword arc shown while aiming)

## What's Skipped

- Server, networking, lobby
- Pathfinding (straight-line movement, just check destination isn't blocked)
- Ray-casting, projectiles, fireball, bow
- Abilities, shields, classes, entity class system
- Serialization, co-op, fog of war
- Map generation (hardcoded map)

---

## Steps

### Step 1: Scaffolding

Set up the monorepo with two packages for now: `shared` and `client`. No server package yet.

- Root `package.json` with bun workspaces `["shared", "client"]`
- Root `tsconfig.json` (strict, ES2022, ESNext modules)
- `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
- `client/package.json` (deps: `pixi.js`, `shared: workspace:*`), `client/tsconfig.json`
- `client/vite.config.ts`, `client/index.html`, `client/src/main.ts`
- `.gitignore`

**Done when:** `bun install` works, `bun run dev` starts Vite, browser shows an empty Pixi canvas.

### Step 2: Core Types

Minimal types in `shared/src/types/`. Only what's needed for the MVP.

```typescript
// Vec2
interface Vec2 { readonly x: number; readonly y: number }

// Grid
interface GridState {
  readonly width: number;      // in cells
  readonly height: number;
  readonly cellSize: number;   // world-units per cell
  readonly walls: Uint8Array;  // 1 = blocked
}

// Entity — minimal
interface Entity {
  readonly id: string;
  readonly position: Vec2;
  readonly collisionRadius: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly team: "red" | "blue";
  readonly movementRemaining: number;
  readonly actionsRemaining: number;
}

// GameState — minimal
interface GameState {
  readonly entities: ReadonlyMap<string, Entity>;
  readonly grid: GridState;
  readonly activeTeam: "red" | "blue";
  readonly turnNumber: number;
}

// Actions — just move and attack
type PlayerAction =
  | { type: "move"; entityId: string; destination: Vec2 }
  | { type: "attack"; entityId: string; aimDirection: Vec2 }
  | { type: "endTurn" };
```

Vec2 math in `shared/src/math/vec2.ts`: `add`, `sub`, `scale`, `normalize`, `length`, `distance`, `dot`, `angle`, `rotate`. Pure functions only.

**Done when:** Types compile, vec2 functions exist with a few vitest tests.

### Step 3: Collision Grid

`shared/src/grid/collision-grid.ts` — minimal grid operations.

- `createGrid(width, height, cellSize): GridState`
- `worldToCell(pos, cellSize): { cx, cy }`
- `isBlocked(grid, cx, cy): boolean`
- `setBlocked(grid, cx, cy): GridState`
- `isPositionWalkable(grid, pos, collisionRadius): boolean`
- `rasterizeRect(grid, center, width, height, angle): GridState` — for placing walls

No pathfinding yet. Movement validation is just: "is the destination walkable?"

Hardcoded map function: `createTestMap(): GridState` — an arena with a few walls.

**Done when:** Tests confirm walls block correctly, positions near walls are unwalkable.

### Step 4: Combat — Sword Swing

One shape: sector (arc in front of the attacker).

`shared/src/math/geometry.ts`:
- `pointInSector(point, origin, direction, radius, halfAngle): boolean`
- `entitiesInSector(origin, direction, radius, halfAngle, entities): Entity[]` — checks each entity's position (accounting for collision radius)

`shared/src/combat/shape-resolver.ts`:
- `resolveSwordAttack(attacker, aimDirection, entities): Entity[]` — hardcoded sword stats for now (radius: 40, halfAngle: PI/4, damage: 20)

**Done when:** Tests confirm entity in the arc is hit, entity outside is not, entity behind attacker is not.

### Step 5: Turn Resolver

`shared/src/game/turn-resolver.ts` — runs in the client for now, will move to server later.

```typescript
function resolveAction(state: GameState, action: PlayerAction): GameState
```

- **move:** Check entity belongs to active team, has movement remaining, destination is walkable and within movement range. Update position, deduct movement.
- **attack:** Check entity belongs to active team, has actions remaining. Resolve sword attack, apply damage, remove dead entities. Deduct action.
- **endTurn:** Switch active team, reset movement/actions for new team's entities, increment turn.

Returns a new GameState every time. Never mutates.

**Done when:** Headless tests pass — move changes position, attack damages enemy, wrong-team actions rejected, dead entities removed, turn switching works.

### Step 6: Renderer

`client/src/renderer/` — Pixi.js drawing.

- **game-renderer.ts:** Create Pixi Application, manage a container for the game world. Camera: offset via WASD/arrow keys, zoom via scroll wheel.
- **entity-renderer.ts:** Each entity = colored circle (red/blue by team) + health bar above. Highlight selected entity with a border. Dim entities with no actions remaining.
- **grid-renderer.ts:** Draw wall cells as dark rectangles. Draw grid lines faintly for debugging (toggle-able).

The renderer reads from a `GameState` and redraws. No animation between states for MVP — entities teleport to new positions. That's fine.

**Done when:** Browser shows the map with walls, two colored circles with health bars.

### Step 7: Input & Game Loop

`client/src/input/input-manager.ts` + `client/src/game-loop.ts`:

- Hold the current `GameState` in the client
- **Click** on an entity from the active team: select it
- **Right-click** on the ground with an entity selected: submit move action, get new state, re-render
- **Click** on an enemy entity with an entity selected: submit attack action with aim direction = direction toward enemy, get new state, re-render
- **End Turn button** (HTML): submit endTurn action

The game loop is just: user does something → `resolveAction` → update state → re-render. No server, no ticks.

**Done when:** You can select a red entity, move it, attack a blue entity, see its health drop, end turn, control blue, and go back and forth.

### Step 8: Targeting Preview

`client/src/input/targeting.ts`:

- When an entity is selected and the mouse hovers, show a sword arc preview (semi-transparent sector shape) from the entity toward the cursor
- Uses `shared/src/math/geometry.ts` to compute the arc shape — same code that resolves hits
- Pixi.js Graphics object drawn each frame based on mouse position

**Done when:** Moving the mouse with a selected entity shows a sweeping arc preview. Clicking fires the attack in that direction.

---

## End State

A single-page browser app where:
- A hardcoded map with walls is visible
- Two teams of entities (circles) are placed on the map
- You can select, move, and sword-attack with each team's entities
- Health bars update, dead entities disappear
- Turns alternate between red and blue
- A targeting arc shows where your sword will hit before you attack
- Wall collision prevents movement into walls

From here, the next steps would be:
1. Add pathfinding (A*) so movement routes around walls
2. Add more combat shapes (rectangle, circle, point) and weapons
3. Split game logic to a server, add WebSocket networking
4. Add a lobby so two players can connect
