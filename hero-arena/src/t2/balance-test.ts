#!/usr/bin/env bun
/**
 * Balance test: run a dimension's enemies (and optionally items) through a standardized
 * battery of encounters. Outputs a JSON report + per-game logs.
 *
 *   bun hero-arena/src/t2/balance-test.ts <dimId> [--items] [--seeds N]
 */
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveAction } from "../../../shared/src/index.js";
import type { GameEvent } from "../../../shared/src/index.js";
import { generateEncounter } from "../../../shared/src/encounter/encounter.js";
import type { EncounterType } from "../../../shared/src/encounter/encounter.js";
import type { Dimension } from "../../../shared/src/encounter/dimension.js";
import type { EntityId, GameState, PlayerAction, TeamId, UnitTemplate } from "../../../shared/src/index.js";
import { rushStrategy, kiteStrategy, strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { ArenaConfig } from "./types.js";
import type { HeroController } from "../types.js";

// --- CLI args ---
const dimId = Number(process.argv[2]);
if (isNaN(dimId)) { console.error("usage: bun balance-test.ts <dimId> [--items] [--seeds N]"); process.exit(2); }
const doItems = process.argv.includes("--items");
const seedCount = (() => { const i = process.argv.indexOf("--seeds"); return i >= 0 ? Number(process.argv[i + 1]) : 3; })();
const SEEDS = Array.from({ length: seedCount }, (_, i) => i + 1);

// --- Load dimension data ---
process.chdir(join(import.meta.dir, "..", "..", "..", "server"));
const { loadEnemyTemplateRegistry, loadDimension, loadItems } = await import("../../../server/src/db.js");
// Trigger seed loading
await import("../../../server/src/index.js").catch(() => {});

const registry = loadEnemyTemplateRegistry(dimId);
const dimension = loadDimension(dimId);
if (!dimension) { console.error(`Dimension ${dimId} not found`); process.exit(1); }

const enemyKeys = Object.keys(registry);
console.log(`Dimension ${dimId}: ${dimension.name} — ${enemyKeys.length} enemies`);

// --- Controllers ---
const MAX_ACTIONS = 16;
const MAX_TURNS = 80;

type PlayerType = "sovereign" | "rush" | "kite";

function makeController(type: PlayerType): HeroController {
  if (type === "sovereign") return makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
  return (ctx) => {
    const entity = ctx.state.entities.get(ctx.heroId);
    if (!entity || entity.dead) return [];
    const strat = type === "kite" ? kiteStrategy : rushStrategy;
    return strat.planActions(entity, ctx.state);
  };
}

// --- Game runner ---
interface GameResult {
  winner: string | null;
  turns: number;
  redHpPct: number;
  blueHpPct: number;
}

async function runGame(config: ArenaConfig, controllers: Map<EntityId, HeroController>): Promise<{ result: GameResult; events: GameEvent[] }> {
  const arena = await buildArena2(config);
  let state = arena.state;
  const events: GameEvent[] = [];

  const step = (a: PlayerAction): boolean => {
    const r = resolveAction(state, a);
    if (r.state === state) return false;
    state = r.state;
    events.push(...r.events);
    return true;
  };

  for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
    const team = state.activeTeam;

    // Hero-controlled units
    for (const heroId of arena.heroIds[team]) {
      const hero = state.entities.get(heroId);
      if (!hero || hero.dead) continue;
      const ctl = controllers.get(heroId);
      if (!ctl) continue;
      let actions: PlayerAction[] = [];
      try { actions = ctl({ state, heroId, deadlineMs: Date.now() + 2000, turnIndex: t }) ?? []; } catch {}
      let applied = 0;
      for (const a of actions) {
        if (applied >= MAX_ACTIONS) break;
        if (a.type !== "ability" || a.entityId !== heroId) continue;
        if (step(a)) applied++;
        if (state.winner) break;
      }
      if (state.winner) break;
    }

    // Scripted units
    if (!state.winner) {
      const scripted = [...state.entities.values()]
        .filter(e => e.teamId === team && !e.dead && !arena.heroIds[team].includes(e.id));
      for (const u of scripted) {
        if (state.entities.get(u.id)?.dead) continue;
        for (const action of strategyForEntity(u).planActions(u, state)) {
          step(action);
          if (state.winner) break;
        }
        if (state.winner) break;
      }
    }

    if (!state.winner) step({ type: "endTurn" });
  }

  const hpFrac = (team: TeamId) => {
    let hp = 0, max = 0;
    for (const e of state.entities.values()) if (e.teamId === team) { max += e.maxHp; hp += e.dead ? 0 : e.hp; }
    return max > 0 ? hp / max : 0;
  };

  return {
    result: {
      winner: state.winner ?? null,
      turns: state.turnNumber,
      redHpPct: Math.round(hpFrac("red") * 100),
      blueHpPct: Math.round(hpFrac("blue") * 100),
    },
    events,
  };
}

// --- Test scenarios ---

interface ScenarioResult {
  scenario: string;
  enemyKey?: string;
  encounterType?: string;
  budget: number;
  playerConfig: string;
  seed: number;
  result: GameResult;
}

const allResults: ScenarioResult[] = [];
const logDir = join(import.meta.dir, "..", "..", "..", `balance-logs-dim-${dimId}`);
mkdirSync(logDir, { recursive: true });
for (const f of readdirSync(logDir)) unlinkSync(join(logDir, f));
let gameIndex = 0;

async function runScenario(
  scenario: string,
  config: ArenaConfig,
  controllers: Map<EntityId, HeroController>,
  meta: Omit<ScenarioResult, "result">,
): Promise<void> {
  const { result, events } = await runGame(config, controllers);
  allResults.push({ ...meta, result });
  writeFileSync(join(logDir, `${String(gameIndex).padStart(4, "0")}-${scenario}.json`), JSON.stringify(events));
  gameIndex++;
}

// Helper: fill a budget with copies of one enemy
function fillBudget(key: string, budget: number): Array<{ key: string; count: number; dim: number }> {
  const cost = registry[key]!.cost ?? 1;
  const count = Math.max(1, Math.floor(budget / cost));
  return [{ key, count, dim: dimId }];
}

// Solo hero configs
type SoloRole = "tank" | "fighter" | "ranged";
const SOLO_ROLES: { role: SoloRole; template: UnitTemplate; badType: PlayerType }[] = [
  { role: "tank", template: TANK_TEMPLATE, badType: "rush" },
  { role: "fighter", template: FIGHTER_TEMPLATE, badType: "rush" },
  { role: "ranged", template: RANGED_TEMPLATE, badType: "kite" },
];

function soloConfig(seed: number, role: SoloRole, template: UnitTemplate, enemies: Array<{ key: string; count: number; dim: number }>): ArenaConfig {
  return {
    seed,
    red: { heroes: [{ id: "R-hero" as any, role, template }], scriptedAllies: [] },
    blue: { heroes: [], scriptedAllies: enemies },
  };
}

function soloControllers(type: PlayerType): Map<EntityId, HeroController> {
  return new Map([["R-hero" as EntityId, makeController(type)]]);
}

// Party configs
function partyConfig(seed: number, enemies: Array<{ key: string; count: number; dim: number }>): ArenaConfig {
  return {
    seed,
    red: {
      heroes: [
        { id: "R-tank" as any, role: "tank", template: TANK_TEMPLATE },
        { id: "R-fighter" as any, role: "fighter", template: FIGHTER_TEMPLATE },
        { id: "R-ranged" as any, role: "ranged", template: RANGED_TEMPLATE },
      ],
      scriptedAllies: [],
    },
    blue: { heroes: [], scriptedAllies: enemies },
  };
}

function partyControllers(type: "sovereign" | "bad"): Map<EntityId, HeroController> {
  if (type === "sovereign") {
    return new Map([
      ["R-tank" as EntityId, makeController("sovereign")],
      ["R-fighter" as EntityId, makeController("sovereign")],
      ["R-ranged" as EntityId, makeController("sovereign")],
    ]);
  }
  // Bad: tank rushes, fighter rushes, ranged kites
  return new Map([
    ["R-tank" as EntityId, makeController("rush")],
    ["R-fighter" as EntityId, makeController("rush")],
    ["R-ranged" as EntityId, makeController("kite")],
  ]);
}

// --- Run per-enemy pure tests ---
const SOLO_BUDGETS = [6, 18, 25];
const PARTY_BUDGETS = [25, 35, 50];

console.log(`\nRunning per-enemy tests (${enemyKeys.length} enemies)...`);
for (const key of enemyKeys) {
  const cost = registry[key]!.cost ?? 1;
  process.stderr.write(`  ${key} (cost ${cost})...`);

  for (const { role, template, badType } of SOLO_ROLES) {
    for (const budget of SOLO_BUDGETS) {
      const enemies = fillBudget(key, budget);
      for (const seed of SEEDS) {
        const cfg = soloConfig(seed, role, template, enemies);
        await runScenario(`solo-sov-${role}-${key}-b${budget}-s${seed}`, cfg, soloControllers("sovereign"),
          { scenario: `solo-sovereign-${role}`, enemyKey: key, budget, playerConfig: `solo-sovereign-${role}`, seed });
      }
      for (const seed of SEEDS) {
        const cfg = soloConfig(seed, role, template, enemies);
        await runScenario(`solo-bad-${role}-${key}-b${budget}-s${seed}`, cfg, soloControllers(badType),
          { scenario: `solo-bad-${role}`, enemyKey: key, budget, playerConfig: `solo-${badType}-${role}`, seed });
      }
    }
  }

  for (const budget of PARTY_BUDGETS) {
    const enemies = fillBudget(key, budget);
    for (const seed of SEEDS) {
      const cfg = partyConfig(seed, enemies);
      await runScenario(`party-sov-${key}-b${budget}-s${seed}`, cfg, partyControllers("sovereign"),
        { scenario: "party-sovereign", enemyKey: key, budget, playerConfig: "party-sovereign", seed });
    }
    for (const seed of SEEDS) {
      const cfg = partyConfig(seed, enemies);
      await runScenario(`party-bad-${key}-b${budget}-s${seed}`, cfg, partyControllers("bad"),
        { scenario: "party-bad", enemyKey: key, budget, playerConfig: "party-bad", seed });
    }
  }

  process.stderr.write(` done (${allResults.length} games)\n`);
}

// --- Run realistic encounter tests ---
const ENCOUNTER_PROFILES: EncounterType[] = ["wilderness", "enemy-camp", "elite-encounter", "boss", "calamity"];

// Build reverse lookup: template object identity → registry key
const tmplToKey = new Map<UnitTemplate, string>();
for (const [key, tmpl] of Object.entries(registry)) tmplToKey.set(tmpl, key);
// Also match by className for templates that were cloned
const classNameToKey = new Map<string, string>();
for (const [key, tmpl] of Object.entries(registry)) classNameToKey.set(tmpl.className, key);

console.log(`\nRunning realistic encounter tests...`);
for (const profile of ENCOUNTER_PROFILES) {
  for (const seed of SEEDS) {
    const encounter = generateEncounter(profile, dimension, seed, seed * 7, seed * 13);
    const enemies: Array<{ key: string; count: number; dim: number }> = [];
    const counts = new Map<string, number>();
    for (const tmpl of encounter.enemies) {
      const key = tmplToKey.get(tmpl) ?? classNameToKey.get(tmpl.className);
      if (!key) { console.error(`  warning: no registry key for "${tmpl.className}"`); continue; }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) enemies.push({ key, count, dim: dimId });

    const budget = encounter.enemies.reduce((s, e) => s + (e.cost ?? 1), 0);

    for (const { role, template, badType } of SOLO_ROLES) {
      await runScenario(`enc-solo-sov-${role}-${profile}-s${seed}`, soloConfig(seed, role, template, enemies), soloControllers("sovereign"),
        { scenario: `encounter-solo-sovereign-${role}`, encounterType: profile, budget, playerConfig: `solo-sovereign-${role}`, seed });
      await runScenario(`enc-solo-bad-${role}-${profile}-s${seed}`, soloConfig(seed, role, template, enemies), soloControllers(badType),
        { scenario: `encounter-solo-bad-${role}`, encounterType: profile, budget, playerConfig: `solo-${badType}-${role}`, seed });
    }
    // Party sovereign
    await runScenario(`enc-party-sov-${profile}-s${seed}`, partyConfig(seed, enemies), partyControllers("sovereign"),
      { scenario: "encounter-party-sovereign", encounterType: profile, budget, playerConfig: "party-sovereign", seed });
    // Party bad
    await runScenario(`enc-party-bad-${profile}-s${seed}`, partyConfig(seed, enemies), partyControllers("bad"),
      { scenario: "encounter-party-bad", encounterType: profile, budget, playerConfig: "party-bad", seed });
  }
  process.stderr.write(`  ${profile} done\n`);
}

// --- Item tests (optional) ---
if (doItems) {
  const items = loadItems(dimId);
  const weaponKeys = Object.keys(items).filter(k => items[k]!.type === "weapon");
  console.log(`\nRunning item tests (${weaponKeys.length} weapons)...`);

  // Use dim-0 enemies as stable reference
  const refEnemies: Record<string, Array<{ key: string; count: number; dim: number }>> = {
    easy: [{ key: "slime", count: 3, dim: 0 }, { key: "goblin-spear", count: 2, dim: 0 }],
    medium: [{ key: "goblin-spear", count: 3, dim: 0 }, { key: "goblin-archer", count: 2, dim: 0 }, { key: "goblin-shield", count: 2, dim: 0 }],
    hard: [{ key: "goblin-brute", count: 2, dim: 0 }, { key: "big-slime", count: 2, dim: 0 }, { key: "goblin-shield", count: 2, dim: 0 }],
  };

  for (const key of weaponKeys) {
    const weapon = items[key]!;
    if (weapon.type !== "weapon") continue;
    const abilities = [...FIGHTER_TEMPLATE.abilities.filter(a => a.kind === "move"), ...weapon.abilities];
    const template: UnitTemplate = { ...FIGHTER_TEMPLATE, abilities };

    for (const [diff, enemies] of Object.entries(refEnemies)) {
      for (const seed of SEEDS) {
        const cfg: ArenaConfig = {
          seed,
          red: { heroes: [{ id: "R-hero" as any, role: "fighter", template }], scriptedAllies: [] },
          blue: { heroes: [], scriptedAllies: enemies },
        };
        await runScenario(`item-sov-${key}-${diff}-s${seed}`, cfg, soloControllers("sovereign"),
          { scenario: "item-sovereign", enemyKey: key, budget: 0, playerConfig: `item-sovereign-${diff}`, seed });
        await runScenario(`item-bad-${key}-${diff}-s${seed}`, cfg, soloControllers("rush"),
          { scenario: "item-bad", enemyKey: key, budget: 0, playerConfig: `item-rush-${diff}`, seed });
      }
    }
    process.stderr.write(`  ${key} done\n`);
  }
}

// --- Write report ---
const reportPath = join(import.meta.dir, "..", "..", "..", `balance-report-dim-${dimId}.json`);
const report = {
  dimensionId: dimId,
  dimensionName: dimension.name,
  timestamp: new Date().toISOString(),
  seeds: SEEDS,
  enemyCount: enemyKeys.length,
  totalGames: allResults.length,
  enemies: Object.fromEntries(enemyKeys.map(k => [k, { cost: registry[k]!.cost ?? 1, hp: registry[k]!.hp, strategy: registry[k]!.strategy, tags: registry[k]!.tags ?? [] }])),
  results: allResults,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nDone! ${allResults.length} games played.`);
console.log(`Report: ${reportPath}`);
console.log(`Logs:   ${logDir}/`);
