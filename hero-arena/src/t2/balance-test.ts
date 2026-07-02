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
import { BASELINE_SCALING } from "../../../shared/src/encounter/difficulty.js";
import type { EncounterType } from "../../../shared/src/encounter/encounter.js";
import type { Dimension } from "../../../shared/src/encounter/dimension.js";
import type { EntityId, GameState, PlayerAction, TeamId, UnitTemplate } from "../../../shared/src/index.js";
import { rushStrategy, kiteStrategy, strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { ArenaConfig } from "./types.js";
import type { HeroController } from "../types.js";
import { runJobsParallel, type GameJob, type ControllerType } from "./parallel-dispatch.js";

// --- CLI args ---
const dimId = Number(process.argv[2]);
if (isNaN(dimId)) { console.error("usage: bun balance-test.ts <dimId> [--items] [--seeds N]"); process.exit(2); }
const doItems = process.argv.includes("--items");
const seedCount = (() => { const i = process.argv.indexOf("--seeds"); return i >= 0 ? Number(process.argv[i + 1]) : 3; })();
const SEEDS = Array.from({ length: seedCount }, (_, i) => i + 1);
const workers = (() => { const i = process.argv.indexOf("--workers"); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();

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

type PlayerType = ControllerType;

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
  enemyComp?: Array<{ key: string; count: number }>;
  budget: number;
  playerConfig: string;
  seed: number;
  result: GameResult;
}

const logDir = join(import.meta.dir, "..", "..", "..", `balance-logs-dim-${dimId}`);
mkdirSync(logDir, { recursive: true });
for (const f of readdirSync(logDir)) unlinkSync(join(logDir, f));

// Enqueued work — populated by the scenario loops, then executed at the end.
interface PendingJob {
  scenarioName: string;
  config: ArenaConfig;
  controllers: { entityId: string; type: PlayerType }[];
  meta: Omit<ScenarioResult, "result">;
}
const pendingJobs: PendingJob[] = [];

function enqueue(
  scenarioName: string,
  config: ArenaConfig,
  controllers: { entityId: string; type: PlayerType }[],
  meta: Omit<ScenarioResult, "result">,
): void {
  pendingJobs.push({ scenarioName, config, controllers, meta });
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

function soloControllers(type: PlayerType): { entityId: string; type: PlayerType }[] {
  return [{ entityId: "R-hero", type }];
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

function partyControllers(type: "sovereign" | "bad"): { entityId: string; type: PlayerType }[] {
  if (type === "sovereign") {
    return [
      { entityId: "R-tank", type: "sovereign" },
      { entityId: "R-fighter", type: "sovereign" },
      { entityId: "R-ranged", type: "sovereign" },
    ];
  }
  // Bad: tank rushes, fighter rushes, ranged kites
  return [
    { entityId: "R-tank", type: "rush" },
    { entityId: "R-fighter", type: "rush" },
    { entityId: "R-ranged", type: "kite" },
  ];
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
        enqueue(`solo-exp-${role}-${key}-b${budget}-s${seed}`, cfg, soloControllers("sovereign"),
          { scenario: `solo-expert-${role}`, enemyKey: key, budget, playerConfig: `solo-expert-${role}`, seed });
      }
      for (const seed of SEEDS) {
        const cfg = soloConfig(seed, role, template, enemies);
        enqueue(`solo-nov-${role}-${key}-b${budget}-s${seed}`, cfg, soloControllers(badType),
          { scenario: `solo-dumb-${role}`, enemyKey: key, budget, playerConfig: `solo-dumb-${role}`, seed });
      }
    }
  }

  for (const budget of PARTY_BUDGETS) {
    const enemies = fillBudget(key, budget);
    for (const seed of SEEDS) {
      const cfg = partyConfig(seed, enemies);
      enqueue(`party-exp-${key}-b${budget}-s${seed}`, cfg, partyControllers("sovereign"),
        { scenario: "party-expert", enemyKey: key, budget, playerConfig: "party-expert", seed });
    }
    for (const seed of SEEDS) {
      const cfg = partyConfig(seed, enemies);
      enqueue(`party-nov-${key}-b${budget}-s${seed}`, cfg, partyControllers("bad"),
        { scenario: "party-dumb", enemyKey: key, budget, playerConfig: "party-dumb", seed });
    }
  }

  process.stderr.write(` done (${pendingJobs.length} jobs)\n`);
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
    const encounter = generateEncounter(profile, dimension, seed, seed * 7, seed * 13, BASELINE_SCALING);
    const enemies: Array<{ key: string; count: number; dim: number }> = [];
    const counts = new Map<string, number>();
    for (const tmpl of encounter.enemies) {
      const key = tmplToKey.get(tmpl) ?? classNameToKey.get(tmpl.className);
      if (!key) { console.error(`  warning: no registry key for "${tmpl.className}"`); continue; }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) enemies.push({ key, count, dim: dimId });

    const budget = encounter.enemies.reduce((s, e) => s + (e.cost ?? 1), 0);
    const enemyComp = enemies.map(e => ({ key: e.key, count: e.count }));

    for (const { role, template, badType } of SOLO_ROLES) {
      enqueue(`enc-solo-exp-${role}-${profile}-s${seed}`, soloConfig(seed, role, template, enemies), soloControllers("sovereign"),
        { scenario: `encounter-solo-expert-${role}`, encounterType: profile, enemyComp, budget, playerConfig: `solo-expert-${role}`, seed });
      enqueue(`enc-solo-nov-${role}-${profile}-s${seed}`, soloConfig(seed, role, template, enemies), soloControllers(badType),
        { scenario: `encounter-solo-dumb-${role}`, encounterType: profile, enemyComp, budget, playerConfig: `solo-dumb-${role}`, seed });
    }
    enqueue(`enc-party-exp-${profile}-s${seed}`, partyConfig(seed, enemies), partyControllers("sovereign"),
      { scenario: "encounter-party-expert", encounterType: profile, enemyComp, budget, playerConfig: "party-expert", seed });
    enqueue(`enc-party-nov-${profile}-s${seed}`, partyConfig(seed, enemies), partyControllers("bad"),
      { scenario: "encounter-party-dumb", encounterType: profile, enemyComp, budget, playerConfig: "party-dumb", seed });
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
        enqueue(`item-sov-${key}-${diff}-s${seed}`, cfg, soloControllers("sovereign"),
          { scenario: "item-sovereign", enemyKey: key, budget: 0, playerConfig: `item-sovereign-${diff}`, seed });
        enqueue(`item-bad-${key}-${diff}-s${seed}`, cfg, soloControllers("rush"),
          { scenario: "item-bad", enemyKey: key, budget: 0, playerConfig: `item-rush-${diff}`, seed });
      }
    }
    process.stderr.write(`  ${key} done\n`);
  }
}

// --- Execute jobs (sequentially or in parallel) ---
console.log(`\nExecuting ${pendingJobs.length} games${workers > 0 ? ` across ${workers} workers` : " sequentially"}...`);

const allResults: ScenarioResult[] = [];
const jobMetaByIndex = new Map<number, Omit<ScenarioResult, "result">>();
const gameJobs: GameJob[] = pendingJobs.map((pj, i) => {
  jobMetaByIndex.set(i, pj.meta);
  return {
    gameIndex: i,
    config: pj.config,
    controllers: pj.controllers,
    logFile: join(logDir, `${String(i).padStart(4, "0")}-${pj.scenarioName}.json`),
  };
});

const t0 = Date.now();
if (workers > 0) {
  let done = 0;
  const total = gameJobs.length;
  const resultMap = await runJobsParallel(gameJobs, workers, () => {
    done++;
    if (done % 50 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`);
  });
  for (let i = 0; i < gameJobs.length; i++) {
    allResults.push({ ...jobMetaByIndex.get(i)!, result: resultMap.get(i)! });
  }
} else {
  for (const job of gameJobs) {
    const controllers = new Map<EntityId, HeroController>(
      job.controllers.map(c => [c.entityId as EntityId, makeController(c.type)])
    );
    const { result, events } = await runGame(job.config, controllers);
    writeFileSync(job.logFile, JSON.stringify(events));
    allResults.push({ ...jobMetaByIndex.get(job.gameIndex)!, result });
  }
}
const elapsedMs = Date.now() - t0;

// --- Write report ---
function translateWinner(w: string | null): string | null {
  if (w === "red") return "heroes";
  if (w === "blue") return "enemies";
  return w;
}

function translateResult(r: ScenarioResult) {
  return {
    scenario: r.scenario,
    ...(r.enemyKey ? { enemyKey: r.enemyKey } : {}),
    ...(r.encounterType ? { encounterType: r.encounterType } : {}),
    ...(r.enemyComp ? { enemyComp: r.enemyComp } : {}),
    budget: r.budget,
    playerConfig: r.playerConfig,
    seed: r.seed,
    result: {
      winner: translateWinner(r.result.winner),
      turns: r.result.turns,
      heroHpPct: r.result.redHpPct,
      enemyHpPct: r.result.blueHpPct,
    },
  };
}

function buildSummary(results: ScenarioResult[]) {
  const perEnemy = new Map<string, { expert: { w: number; t: number }; dumb: { w: number; t: number }; partyExpert: { w: number; t: number }; partyDumb: { w: number; t: number } }>();

  for (const r of results) {
    if (!r.enemyKey || r.scenario.startsWith("encounter-")) continue;
    if (!perEnemy.has(r.enemyKey)) perEnemy.set(r.enemyKey, { expert: { w: 0, t: 0 }, dumb: { w: 0, t: 0 }, partyExpert: { w: 0, t: 0 }, partyDumb: { w: 0, t: 0 } });
    const e = perEnemy.get(r.enemyKey)!;
    const heroWon = r.result.winner === "red";
    if (r.scenario.startsWith("solo-expert")) { e.expert.t++; if (heroWon) e.expert.w++; }
    else if (r.scenario.startsWith("solo-dumb")) { e.dumb.t++; if (heroWon) e.dumb.w++; }
    else if (r.scenario === "party-expert") { e.partyExpert.t++; if (heroWon) e.partyExpert.w++; }
    else if (r.scenario === "party-dumb") { e.partyDumb.t++; if (heroWon) e.partyDumb.w++; }
  }

  const pct = (b: { w: number; t: number }) => b.t > 0 ? Math.round(b.w / b.t * 1000) / 10 : null;

  const enemySummary = enemyKeys.map(k => {
    const cost = registry[k]!.cost ?? 1;
    const e = perEnemy.get(k);
    if (!e) return { name: k, cost, expertSoloWin: null, dumbSoloWin: null, skillGap: null, expertPartyWin: null, dumbPartyWin: null };
    const expSolo = pct(e.expert);
    const novSolo = pct(e.dumb);
    return {
      name: k,
      cost,
      expertSoloWin: expSolo,
      dumbSoloWin: novSolo,
      skillGap: expSolo != null && novSolo != null ? Math.round((expSolo - novSolo) * 10) / 10 : null,
      expertPartyWin: pct(e.partyExpert),
      dumbPartyWin: pct(e.partyDumb),
    };
  });

  const totals = { expert: { w: 0, t: 0 }, dumb: { w: 0, t: 0 } };
  for (const e of perEnemy.values()) {
    totals.expert.w += e.expert.w; totals.expert.t += e.expert.t;
    totals.dumb.w += e.dumb.w; totals.dumb.t += e.dumb.t;
  }
  const overallExpert = pct(totals.expert);
  const overallDumb = pct(totals.dumb);

  return {
    perEnemy: enemySummary,
    overall: {
      expertSoloWin: overallExpert,
      dumbSoloWin: overallDumb,
      skillGap: overallExpert != null && overallDumb != null ? Math.round((overallExpert - overallDumb) * 10) / 10 : null,
    },
  };
}

const reportPath = join(import.meta.dir, "..", "..", "..", `balance-report-dim-${dimId}.json`);
const report = {
  dimensionId: dimId,
  dimensionName: dimension.name,
  timestamp: new Date().toISOString(),
  seeds: SEEDS,
  enemyCount: enemyKeys.length,
  totalGames: allResults.length,
  enemies: Object.fromEntries(enemyKeys.map(k => [k, { cost: registry[k]!.cost ?? 1, hp: registry[k]!.hp, strategy: registry[k]!.strategy, tags: registry[k]!.tags ?? [] }])),
  summary: buildSummary(allResults),
  results: allResults.map(translateResult),
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nDone! ${allResults.length} games in ${(elapsedMs / 1000).toFixed(1)}s.`);
console.log(`Report: ${reportPath}`);
console.log(`Logs:   ${logDir}/`);
process.exit(0);
