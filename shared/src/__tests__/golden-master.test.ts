/**
 * Golden-master characterization test for the deterministic combat simulation.
 *
 * This is the permanent regression guard for the bus refactor and every future core change.
 * It runs a broad battery of full-combat scenarios through the pure `resolveAction` engine and
 * the (now deterministic) sovereign AI, captures the ENTIRE serialized event stream plus the
 * final GameState per scenario, and reduces each to a sha256 digest. It asserts three things:
 *
 *   1. RUN-TWICE-IDENTICAL — the whole battery is executed twice in-process and the two results
 *      are byte-identical. This fails loudly on any residual Math.random / Date.now / iteration-
 *      order nondeterminism, even before a baseline exists.
 *   2. BASELINE LOCK — each scenario's digest matches the committed baseline snapshot. Any change
 *      to combat resolution, effect processing, or AI decision-making that alters observable
 *      behavior will trip this and demand an intentional baseline regeneration.
 *   3. COVERAGE — the battery is asserted to exercise every reaction event the engine emits
 *      (knockback, pull, applyStatus, wallSlam collision, recoil/lunge moves, onDeath spawn,
 *      zone create/tick/expire, barrier, turnStart), so the guard actually covers the moving parts.
 *
 * The scripted arm (hand-built states driven by literal action sequences) guarantees exhaustive
 * reaction coverage regardless of AI heuristics. The AI arm drives the sovereign against
 * rush/kite/sovereign opponents to lock in the determinism fix (node budget + hashPick tie-break).
 *
 * Regenerate the baseline (only after an intentional behavior change) with:
 *   GOLDEN_UPDATE=1 bun test golden-master
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ShapeKind } from "../core/types.js";
import type {
  AttackAbility, BarrierAbility, Entity, EntityEffect, GameEvent, GameState,
  MoveAbility, PlayerAction, TeamId, UnitTemplate, Vec2, ZoneAbility,
} from "../core/types.js";
import { resolveAction, createGameState } from "../combat/turn-resolver.js";
import { serializeGameState } from "../core/serialization.js";
import { createGrid, CELL_WALL } from "../map/collision-grid.js";
import { setTemplateRegistry, getTemplateRegistry } from "../encounter/effects.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS, type HeroController } from "../ai/sovereign.js";
import { strategyForEntity } from "../ai/strategy.js";

// ---------------------------------------------------------------------------
// Ability fixtures — deliberately built to trigger every engine reaction.
// ---------------------------------------------------------------------------

const MOVE: MoveAbility = { id: "move", name: "Move", kind: "move", cost: { blue: 2 }, variableCost: true, distance: 130 };

const SLASH_KB: AttackAbility = {
  id: "slash-kb", name: "Slash", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 },
  damage: 25, knockback: 60, wallSlamDamage: 20,
};
const PLAIN_STRIKE: AttackAbility = {
  id: "plain-strike", name: "Strike", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 },
  damage: 25, knockback: 0,
};
const PULL_HOOK: AttackAbility = {
  id: "pull-hook", name: "Hook", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 150, halfAngle: Math.PI / 2 },
  damage: 8, knockback: 0, onHit: [{ type: "pull", distance: 70 }],
};
const STATUS_STRIKE: AttackAbility = {
  id: "status-strike", name: "Hex", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 },
  damage: 5, knockback: 0,
  onHit: [
    { type: "applyStatus", status: "slowed", duration: 2, value: 0.5 },
    { type: "applyStatus", status: "winded", duration: 2, value: 0.5 },
    { type: "applyStatus", status: "suppressed", duration: 2, value: 0.5 },
    { type: "applyStatus", status: "rooted", duration: 2, value: 1 },
  ],
};
const RECOIL_STRIKE: AttackAbility = {
  id: "recoil-strike", name: "Kickback", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 },
  damage: 5, knockback: 0, recoil: 40,
};
const LUNGE_STRIKE: AttackAbility = {
  id: "lunge-strike", name: "Lunge", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Sector, radius: 90, halfAngle: Math.PI / 3 },
  damage: 5, knockback: 0, lungeThrough: 50,
};
const RANGED_BOLT: AttackAbility = {
  id: "ranged-bolt", name: "Bolt", kind: "attack", cost: { red: 2 },
  shape: { kind: ShapeKind.Point, range: 260 },
  damage: 18, knockback: 0,
};
const GUARD: BarrierAbility = { id: "guard", name: "Guard", kind: "barrier", cost: { blue: 2 }, barrierHp: 40 };

const ZONE_DMG: ZoneAbility = {
  id: "zone-dmg", name: "Firewall", kind: "zone", cost: { red: 2 }, range: 200,
  zone: { effect: "damage", radius: 60, duration: 2, magnitude: 15, color: 0xff4400 },
};
const ZONE_HEAL: ZoneAbility = {
  id: "zone-heal", name: "Sanctuary", kind: "zone", cost: { red: 2 }, range: 200,
  zone: { effect: "heal", radius: 60, duration: 2, magnitude: 20, color: 0x44ff44 },
};
const ZONE_DRAIN: ZoneAbility = {
  id: "zone-drain", name: "Sap", kind: "zone", cost: { red: 2 }, range: 200,
  zone: { effect: "drainRed", radius: 60, duration: 2, magnitude: 1, color: 0x4444ff },
};
const ZONE_WALL: ZoneAbility = {
  id: "zone-wall", name: "Barricade", kind: "zone", cost: { red: 2 }, range: 200,
  zone: { effect: "wall", radius: 24, duration: 3, magnitude: 0, color: 0x888888 },
};
const ZONE_COVER: ZoneAbility = {
  id: "zone-cover", name: "Thicket", kind: "zone", cost: { red: 2 }, range: 200,
  zone: { effect: "cover", radius: 32, duration: 3, magnitude: 0, color: 0x228822 },
};

// ---------------------------------------------------------------------------
// Entity + state builders.
// ---------------------------------------------------------------------------

interface UnitOverrides extends Partial<Entity> {}

function makeUnit(id: string, x: number, y: number, teamId: TeamId, o: UnitOverrides = {}): Entity {
  return {
    id, name: id, position: { x, y }, collisionRadius: 16,
    hp: 120, maxHp: 120, barrier: 0, teamId,
    energy: { red: 10, blue: 10, regenRed: 6, regenBlue: 6, maxRed: 12, maxBlue: 12 },
    abilities: [MOVE, SLASH_KB],
    ...o,
  };
}

const GRID_W = 40, GRID_H = 40, CELL = 8; // 320 x 320 world

function makeGame(entities: Entity[], startingTeam: TeamId = "red", stampWalls?: (walls: Uint8Array) => void): GameState {
  const grid = createGrid(GRID_W, GRID_H, CELL);
  if (stampWalls) stampWalls(grid.walls);
  const map = new Map<string, Entity>();
  for (const e of entities) map.set(e.id, e);
  return createGameState({ entities: map, grid, mapDefinition: { seed: 0, objects: [] }, startingTeam });
}

const aimAt = (from: Vec2, to: Vec2): Vec2 => ({ x: to.x - from.x, y: to.y - from.y });
const atk = (id: string, abilityId: string, aim: Vec2): PlayerAction => ({ type: "ability", entityId: id, abilityId, aimDirection: aim });
const END: PlayerAction = { type: "endTurn" };

// onDeath-spawn template registered for the whole battery.
const MINION_TEMPLATE: UnitTemplate = {
  className: "Minion", hp: 30, energy: { red: 2, blue: 2 }, collisionRadius: 12,
  abilities: [MOVE, PLAIN_STRIKE], strategy: "rush",
};
const ON_DEATH_SPAWN: readonly EntityEffect[] = [{ trigger: "onDeath", action: { type: "spawn", templateKey: "minion", count: 2 } }];

// ---------------------------------------------------------------------------
// Runners.
// ---------------------------------------------------------------------------

type Run = () => { events: GameEvent[]; finalState: GameState };

function runScripted(state: GameState, actions: PlayerAction[]): { events: GameEvent[]; finalState: GameState } {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = resolveAction(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { events, finalState: s };
}

const AI_MAX_ACTIONS = 12;

interface AiGameOpts {
  state: GameState;
  heroIds: Record<TeamId, string[]>;
  controllers: Map<string, HeroController>;
  maxTurns: number;
}

function runAiGame(opts: AiGameOpts): { events: GameEvent[]; finalState: GameState } {
  let state = opts.state;
  const events: GameEvent[] = [];
  const step = (a: PlayerAction): boolean => {
    const r = resolveAction(state, a);
    if (r.state === state) return false;
    state = r.state;
    events.push(...r.events);
    return true;
  };

  for (let t = 0; t < opts.maxTurns && !state.winner; t++) {
    const team = state.activeTeam;
    for (const heroId of opts.heroIds[team] ?? []) {
      const hero = state.entities.get(heroId);
      if (!hero || hero.dead) continue;
      const ctl = opts.controllers.get(heroId);
      if (!ctl) continue;
      const actions = ctl({ state, heroId, turnIndex: t }) ?? [];
      let applied = 0;
      for (const a of actions) {
        if (applied >= AI_MAX_ACTIONS) break;
        if (a.type !== "ability" || a.entityId !== heroId) continue;
        if (step(a)) applied++;
        if (state.winner) break;
      }
      if (state.winner) break;
    }
    if (!state.winner) {
      const heroSet = new Set(opts.heroIds[team] ?? []);
      const scripted = [...state.entities.values()].filter(e => e.teamId === team && !e.dead && !heroSet.has(e.id));
      for (const u of scripted) {
        if (state.entities.get(u.id)?.dead) continue;
        for (const action of strategyForEntity(u).planActions(u, state)) {
          step(action);
          if (state.winner) break;
        }
        if (state.winner) break;
      }
    }
    if (!state.winner) step(END);
  }
  return { events, finalState: state };
}

// Reduced node budget so the AI arm stays fast; determinism is independent of the value.
const AI_BUDGET = 4000;
const sov = () => makeSovereign(FIGHTER_WEIGHTS, { ...PRESETS.crafty, nodeBudget: AI_BUDGET });
const sovGenius = () => makeSovereign(FIGHTER_WEIGHTS, { ...PRESETS.genius, nodeBudget: AI_BUDGET });

// ---------------------------------------------------------------------------
// The battery.
// ---------------------------------------------------------------------------

const SCENARIOS: { name: string; run: Run }[] = [
  // ---- Scripted arm: exhaustive reaction coverage ----
  {
    name: "s01-knockback-wallslam",
    run: () => {
      const a = makeUnit("red-a", 240, 160, "red");
      const b = makeUnit("blue-b", 300, 160, "blue");
      const s = makeGame([a, b]);
      return runScripted(s, [atk("red-a", "slash-kb", aimAt(a.position, b.position)), END]);
    },
  },
  {
    name: "s02-pull",
    run: () => {
      const a = makeUnit("red-a", 100, 160, "red", { abilities: [MOVE, PULL_HOOK] });
      const b = makeUnit("blue-b", 220, 160, "blue");
      const s = makeGame([a, b]);
      return runScripted(s, [atk("red-a", "pull-hook", aimAt(a.position, b.position)), END, END]);
    },
  },
  {
    name: "s03-status-all-and-tick",
    run: () => {
      const a = makeUnit("red-a", 100, 160, "red", { abilities: [MOVE, STATUS_STRIKE] });
      const b = makeUnit("blue-b", 170, 160, "blue");
      const s = makeGame([a, b]);
      // end/end/end so the statuses tick on blue's turn starts and eventually expire.
      return runScripted(s, [atk("red-a", "status-strike", aimAt(a.position, b.position)), END, END, END, END]);
    },
  },
  {
    name: "s04-recoil",
    run: () => {
      const a = makeUnit("red-a", 160, 160, "red", { abilities: [MOVE, RECOIL_STRIKE] });
      const b = makeUnit("blue-b", 230, 160, "blue");
      const s = makeGame([a, b]);
      return runScripted(s, [atk("red-a", "recoil-strike", aimAt(a.position, b.position)), END]);
    },
  },
  {
    name: "s05-lunge",
    run: () => {
      const a = makeUnit("red-a", 120, 160, "red", { abilities: [MOVE, LUNGE_STRIKE] });
      const b = makeUnit("blue-b", 190, 160, "blue");
      const s = makeGame([a, b]);
      return runScripted(s, [atk("red-a", "lunge-strike", aimAt(a.position, b.position)), END]);
    },
  },
  {
    name: "s06-barrier-regen",
    run: () => {
      const a = makeUnit("red-a", 120, 160, "red", { abilities: [MOVE, GUARD], energy: { red: 2, blue: 4, regenRed: 2, regenBlue: 2, maxRed: 4, maxBlue: 4 } });
      const b = makeUnit("blue-b", 260, 160, "blue");
      const s = makeGame([a, b]);
      return runScripted(s, [{ type: "ability", entityId: "red-a", abilityId: "guard" }, END, END]);
    },
  },
  {
    name: "s07-ondeath-spawn",
    run: () => {
      const a = makeUnit("red-a", 120, 160, "red", { abilities: [MOVE, PLAIN_STRIKE] });
      const b = makeUnit("blue-b", 190, 160, "blue", { hp: 10, maxHp: 30, effects: ON_DEATH_SPAWN });
      const s = makeGame([a, b]);
      return runScripted(s, [atk("red-a", "plain-strike", aimAt(a.position, b.position)), END]);
    },
  },
  {
    name: "s08-zone-damage-tick-expire",
    run: () => {
      const a = makeUnit("red-a", 60, 160, "red", { abilities: [MOVE, ZONE_DMG] });
      const b = makeUnit("blue-b", 200, 160, "blue");
      const s = makeGame([a, b]);
      // Drop the zone right on the enemy, then flip turns so it ticks and then expires.
      return runScripted(s, [atk("red-a", "zone-dmg", aimAt(a.position, b.position)), END, END, END, END]);
    },
  },
  {
    name: "s09-zone-variety-and-stamps",
    run: () => {
      const caster = makeUnit("red-a", 160, 160, "red", {
        abilities: [ZONE_HEAL, ZONE_DRAIN, ZONE_WALL, ZONE_COVER],
        hp: 60, energy: { red: 12, blue: 0, regenRed: 6, regenBlue: 0, maxRed: 12, maxBlue: 0 },
      });
      const b = makeUnit("blue-b", 80, 80, "blue");
      const s = makeGame([caster, b]);
      return runScripted(s, [
        atk("red-a", "zone-heal", { x: 0, y: 40 }),   // heal on self area (down)
        atk("red-a", "zone-drain", { x: 40, y: 40 }), // drain SE
        atk("red-a", "zone-wall", { x: 80, y: 0 }),   // wall to the east (clear ground)
        atk("red-a", "zone-cover", { x: -80, y: 0 }), // cover to the west
        END, END,
      ]);
    },
  },
  {
    name: "s10-wall-blocked-knockback",
    run: () => {
      // A stamped interior wall the knockback slams the target into.
      const a = makeUnit("red-a", 120, 160, "red");
      const b = makeUnit("blue-b", 190, 160, "blue");
      const s = makeGame([a, b], "red", (walls) => {
        // Vertical wall column just east of the target at cell x=28 (world ~224).
        for (let cy = 14; cy <= 26; cy++) walls[cy * GRID_W + 28] = CELL_WALL;
      });
      return runScripted(s, [atk("red-a", "slash-kb", aimAt(a.position, b.position)), END]);
    },
  },

  // ---- AI arm: locks the deterministic sovereign (node budget + hashPick) ----
  {
    name: "ai01-sovereign-vs-rush",
    run: () => {
      const hero = makeUnit("red-h", 80, 160, "red", { abilities: [MOVE, SLASH_KB, RANGED_BOLT] });
      const foe = makeUnit("blue-f", 250, 160, "blue", { strategy: "rush", abilities: [MOVE, PLAIN_STRIKE] });
      const s = makeGame([hero, foe]);
      return runAiGame({ state: s, heroIds: { red: ["red-h"], blue: [] }, controllers: new Map([["red-h", sov()]]), maxTurns: 40 });
    },
  },
  {
    name: "ai02-sovereign-vs-kite",
    run: () => {
      const hero = makeUnit("red-h", 80, 160, "red", { abilities: [MOVE, SLASH_KB, RANGED_BOLT] });
      const foe = makeUnit("blue-f", 250, 160, "blue", { strategy: "kite", abilities: [MOVE, RANGED_BOLT] });
      const s = makeGame([hero, foe]);
      return runAiGame({ state: s, heroIds: { red: ["red-h"], blue: [] }, controllers: new Map([["red-h", sov()]]), maxTurns: 40 });
    },
  },
  {
    name: "ai03-sovereign-vs-sovereign",
    run: () => {
      const rh = makeUnit("red-h", 80, 160, "red", { abilities: [MOVE, SLASH_KB, RANGED_BOLT] });
      const bh = makeUnit("blue-h", 250, 160, "blue", { abilities: [MOVE, SLASH_KB, RANGED_BOLT] });
      const s = makeGame([rh, bh]);
      return runAiGame({
        state: s, heroIds: { red: ["red-h"], blue: ["blue-h"] },
        controllers: new Map([["red-h", sov()], ["blue-h", sovGenius()]]), maxTurns: 40,
      });
    },
  },
  {
    name: "ai04-two-sovereigns-vs-rush-squad",
    run: () => {
      // Two red sovereigns sharing actionCount — exercises hashPick's heroId decorrelation.
      const h1 = makeUnit("red-h1", 60, 120, "red", { abilities: [MOVE, SLASH_KB, RANGED_BOLT] });
      const h2 = makeUnit("red-h2", 60, 200, "red", { abilities: [MOVE, SLASH_KB, RANGED_BOLT] });
      const f1 = makeUnit("blue-f1", 260, 120, "blue", { hp: 80, maxHp: 80, strategy: "rush", abilities: [MOVE, PLAIN_STRIKE] });
      const f2 = makeUnit("blue-f2", 260, 200, "blue", { hp: 80, maxHp: 80, strategy: "rush", abilities: [MOVE, PLAIN_STRIKE] });
      const s = makeGame([h1, h2, f1, f2]);
      return runAiGame({
        state: s, heroIds: { red: ["red-h1", "red-h2"], blue: [] },
        controllers: new Map([["red-h1", sov()], ["red-h2", sov()]]), maxTurns: 40,
      });
    },
  },
  {
    name: "ai05-sovereign-vs-ondeath-spawner",
    run: () => {
      const hero = makeUnit("red-h", 80, 160, "red", { abilities: [MOVE, SLASH_KB, RANGED_BOLT] });
      const spawner = makeUnit("blue-s", 240, 160, "blue", { hp: 40, maxHp: 40, strategy: "rush", abilities: [MOVE, PLAIN_STRIKE], effects: ON_DEATH_SPAWN });
      const s = makeGame([hero, spawner]);
      return runAiGame({ state: s, heroIds: { red: ["red-h"], blue: [] }, controllers: new Map([["red-h", sov()]]), maxTurns: 40 });
    },
  },
  {
    name: "ai06-sovereign-knockback-near-wall",
    run: () => {
      const hero = makeUnit("red-h", 100, 160, "red", { abilities: [MOVE, SLASH_KB] });
      const foe = makeUnit("blue-f", 200, 160, "blue", { hp: 90, maxHp: 90, strategy: "rush", abilities: [MOVE, PLAIN_STRIKE] });
      const s = makeGame([hero, foe], "red", (walls) => {
        for (let cy = 12; cy <= 28; cy++) walls[cy * GRID_W + 32] = CELL_WALL;
      });
      return runAiGame({ state: s, heroIds: { red: ["red-h"], blue: [] }, controllers: new Map([["red-h", sov()]]), maxTurns: 40 });
    },
  },
];

// ---------------------------------------------------------------------------
// Reduction + baseline.
// ---------------------------------------------------------------------------

interface ScenarioResult { hash: string; summary: ScenarioSummary; }
interface ScenarioSummary {
  events: number;
  eventTypes: Record<string, number>;
  winner: TeamId | null;
  turnNumber: number;
  entities: number;
  actionCount: number;
}

function summarize(events: GameEvent[], finalState: GameState): ScenarioSummary {
  const eventTypes: Record<string, number> = {};
  for (const e of events) eventTypes[e.type] = (eventTypes[e.type] ?? 0) + 1;
  return {
    events: events.length,
    eventTypes: Object.fromEntries(Object.entries(eventTypes).sort(([a], [b]) => a.localeCompare(b))),
    winner: finalState.winner,
    turnNumber: finalState.turnNumber,
    entities: finalState.entities.size,
    actionCount: finalState.actionCount,
  };
}

function runBattery(): { results: Record<string, ScenarioResult>; jsons: Record<string, string> } {
  const results: Record<string, ScenarioResult> = {};
  const jsons: Record<string, string> = {};
  for (const sc of SCENARIOS) {
    const { events, finalState } = sc.run();
    const payload = { events, finalState: serializeGameState(finalState) };
    const json = JSON.stringify(payload);
    const hash = createHash("sha256").update(json).digest("hex");
    results[sc.name] = { hash, summary: summarize(events, finalState) };
    jsons[sc.name] = json;
  }
  return { results, jsons };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, "golden-master.baseline.json");

// Every GameEvent variant the engine can emit — coverage must include all of these.
// `satisfies` rejects a listed value that isn't a real variant; the Exclude guard below fails the
// typecheck if a NEW variant is added to GameEvent but not listed here — so the coverage assertion
// can never silently skip a newly-introduced reaction type.
const ALL_EVENT_TYPES = [
  "move", "attack", "barrier", "endTurn", "turnStart", "spawn", "knockback",
  "pull", "statusApplied", "collision", "zoneCreated", "zoneExpired", "zoneTick",
] as const satisfies readonly GameEvent["type"][];
type _MissingEventType = Exclude<GameEvent["type"], (typeof ALL_EVENT_TYPES)[number]>;
const _eventTypesExhaustive: [_MissingEventType] extends [never] ? true : ["ALL_EVENT_TYPES missing", _MissingEventType] = true;
void _eventTypesExhaustive;

describe("golden-master combat characterization", () => {
  let prevRegistry: Record<string, UnitTemplate> | null = null;

  beforeAll(() => {
    prevRegistry = getTemplateRegistry();
    setTemplateRegistry({ minion: MINION_TEMPLATE });
  });
  afterAll(() => {
    setTemplateRegistry(prevRegistry ?? {});
  });

  it("is byte-identical across two independent in-process runs (pure determinism)", () => {
    const a = runBattery();
    const b = runBattery();
    for (const sc of SCENARIOS) {
      expect(b.jsons[sc.name]).toBe(a.jsons[sc.name]);
      expect(b.results[sc.name]!.hash).toBe(a.results[sc.name]!.hash);
    }
    // Full-battery digest, too, so any cross-scenario ordering drift is caught.
    const digest = (x: typeof a) => createHash("sha256").update(SCENARIOS.map(s => x.jsons[s.name]).join(" ")).digest("hex");
    expect(digest(b)).toBe(digest(a));
  });

  it("exercises every engine reaction event across the battery", () => {
    const { results } = runBattery();
    const seen = new Set<string>();
    for (const r of Object.values(results)) for (const t of Object.keys(r.summary.eventTypes)) seen.add(t);
    const missing = ALL_EVENT_TYPES.filter(t => !seen.has(t));
    expect(missing).toEqual([]);
  });

  it("matches the committed baseline snapshot (regression guard)", () => {
    const { results } = runBattery();

    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2) + "\n");
      return;
    }
    if (!existsSync(BASELINE_PATH)) {
      throw new Error(
        `Golden baseline missing at ${BASELINE_PATH} — it is the committed regression guard and must be checked in. ` +
        `Regenerate intentionally with: GOLDEN_UPDATE=1 bun test golden-master`,
      );
    }

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, ScenarioResult>;

    // Scenario set must match exactly.
    expect(Object.keys(results).sort()).toEqual(Object.keys(baseline).sort());

    for (const name of Object.keys(results)) {
      const live = results[name]!;
      const base = baseline[name];
      if (!base) throw new Error(`No baseline entry for scenario "${name}" — regenerate the golden baseline`);
      if (live.hash !== base.hash) {
        // Emit a diffable artifact so a failure is easy to inspect.
        const actualPath = join(HERE, `golden-master.${name}.actual.json`);
        writeFileSync(actualPath, JSON.stringify(live, null, 2) + "\n");
      }
      expect({ name, hash: live.hash, summary: live.summary }).toEqual({ name, hash: base.hash, summary: base.summary });
    }
  });
});
