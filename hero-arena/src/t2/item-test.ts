#!/usr/bin/env bun
/**
 * Item balance test: give each item (weapon/shield) to a baseline hero (sword + shield + innate
 * punch + move) and run them through a fixed set of dim-0 encounters. Both solo and "party with
 * item on the fighter" scenarios. Outputs a JSON report + per-game event logs.
 *
 *   bun hero-arena/src/t2/item-test.ts <dimId> [--seeds N]
 */
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveAction, deriveLoadout } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, ItemDefinition, PlayerAction, TeamId, UnitTemplate } from "../../../shared/src/index.js";
import { PLAYER_INNATE_ABILITIES } from "../../../shared/src/core/items.js";
import { rushStrategy, kiteStrategy, strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { ArenaConfig } from "./types.js";
import type { HeroController } from "../types.js";
import { runJobsParallel, type GameJob, type ControllerType } from "./parallel-dispatch.js";

// --- CLI ---
const dimId = Number(process.argv[2]);
if (isNaN(dimId)) { console.error("usage: bun item-test.ts <dimId> [--seeds N] [--workers N]"); process.exit(2); }
const seedCount = (() => { const i = process.argv.indexOf("--seeds"); return i >= 0 ? Number(process.argv[i + 1]) : 3; })();
const SEEDS = Array.from({ length: seedCount }, (_, i) => i + 1);
const workers = (() => { const i = process.argv.indexOf("--workers"); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();

function makeController(type: ControllerType): HeroController {
  if (type === "sovereign") return makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
  return (ctx) => {
    const entity = ctx.state.entities.get(ctx.heroId);
    if (!entity || entity.dead) return [];
    const strat = type === "kite" ? kiteStrategy : rushStrategy;
    return strat.planActions(entity, ctx.state);
  };
}

// --- Load dimension data ---
process.chdir(join(import.meta.dir, "..", "..", "..", "server"));
const { loadItems } = await import("../../../server/src/db.js");
await import("../../../server/src/index.js").catch(() => {});

const items = loadItems(dimId);
const dim0Items = loadItems(0);
const baseSword = dim0Items["short-sword"]!;
const baseShield = dim0Items["round-shield"]!;
if (!baseSword || !baseShield) { console.error("Need short-sword and round-shield in dim 0"); process.exit(1); }

// Every item type is priced: weapons/shields swap into the base kit, accessories and
// consumables ride on top of it (they cost no hand slots, so their value is pure upside
// vs. baseline — rankings must still track rarity).
const testableItems = Object.entries(items);
console.log(`Dim ${dimId}: testing ${testableItems.length} items`);

// --- Hero loadout assembly ---

function isTwoHanded(item: ItemDefinition): boolean {
  return (item.slotCost.hand ?? 0) >= 2;
}

/** Build a hero template equipping the given item, with sword + shield as defaults. Assembled
 *  through the same deriveLoadout as the live encounter builder, so passives price in here. */
function makeHeroTemplate(item: ItemDefinition | null): UnitTemplate {
  let weaponItem = baseSword;
  let shieldItem: ItemDefinition | null = baseShield;
  let extraItem: ItemDefinition | null = null;

  if (item) {
    if (item.type === "weapon") {
      weaponItem = item;
      if (isTwoHanded(item)) shieldItem = null;
    } else if (item.type === "shield") {
      shieldItem = item;
    } else {
      extraItem = item;
    }
  }

  const equipped = [weaponItem, shieldItem, extraItem].filter((i): i is ItemDefinition => i !== null);
  const loadout = deriveLoadout(equipped);

  return {
    abilities: [...PLAYER_INNATE_ABILITIES, ...loadout.abilities],
    hp: 120 + loadout.hpBonus,
    energy: { red: 2 + loadout.regenRedBonus, blue: 2 + loadout.regenBlueBonus },
    collisionRadius: 16,
    className: "Hero",
    passives: loadout.passives,
  };
}

// --- Game runner (same as balance-test) ---
const MAX_ACTIONS = 16;
const MAX_TURNS = 80;

interface GameResult { winner: string | null; turns: number; redHpPct: number; blueHpPct: number; }

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
// Each scenario probes a specific weapon trait. Names describe what they test.
const SOLO_ENEMIES: { label: string; comp: Array<{ key: string; count: number; dim: number }> }[] = [
  // Swarm — tests AoE / cleave value
  { label: "swarm",        comp: [{ key: "slime", count: 12, dim: 0 }] },
  // Tank group — slow high-HP melee, tests sustained DPS
  { label: "tanks",        comp: [{ key: "goblin-shield", count: 5, dim: 0 }] },
  // Ranged harass — kiters that shoot from afar, tests mobility/closing
  { label: "ranged-harass", comp: [{ key: "goblin-archer", count: 4, dim: 0 }, { key: "slime", count: 3, dim: 0 }] },
  // Single fat target — tests single-target burst
  { label: "fat-single",   comp: [{ key: "big-slime", count: 2, dim: 0 }] },
  // Realistic mixed — baseline encounter
  { label: "mixed",        comp: [{ key: "goblin-spear", count: 3, dim: 0 }, { key: "goblin-archer", count: 2, dim: 0 }, { key: "goblin-shield", count: 2, dim: 0 }] },
];
const PARTY_ENEMIES: { label: string; comp: Array<{ key: string; count: number; dim: number }> }[] = [
  // Huge swarm — really tests AoE at scale
  { label: "huge-swarm",    comp: [{ key: "slime", count: 30, dim: 0 }] },
  // Single boss — pure single-target damage race
  { label: "single-boss",   comp: [{ key: "stone-golem", count: 1, dim: 0 }] },
  // Spawner boss — tests AoE + sustain (massive-slime spawns adds on death)
  { label: "spawner-boss",  comp: [{ key: "massive-slime", count: 1, dim: 0 }] },
  // Elite mixed — realistic hard encounter
  { label: "elite-mixed",   comp: [{ key: "goblin-brute", count: 2, dim: 0 }, { key: "stone-golem", count: 1, dim: 0 }, { key: "big-slime", count: 1, dim: 0 }] },
];

// --- Output setup ---
const logDir = join(import.meta.dir, "..", "..", "..", `item-logs-dim-${dimId}`);
mkdirSync(logDir, { recursive: true });
// Clear stale logs
for (const f of readdirSync(logDir)) unlinkSync(join(logDir, f));

interface ItemResult {
  itemId: string;
  scenario: string;
  enemyLabel: string;
  seed: number;
  result: GameResult;
}

interface PendingJob {
  scenarioName: string;
  itemId: string;
  enemyLabel: string;
  seed: number;
  config: ArenaConfig;
  controllers: { entityId: string; type: ControllerType }[];
}
const pendingJobs: PendingJob[] = [];

function enqueue(scenarioName: string, itemId: string, enemyLabel: string, seed: number, config: ArenaConfig, controllers: { entityId: string; type: ControllerType }[]): void {
  pendingJobs.push({ scenarioName, itemId, enemyLabel, seed, config, controllers });
}

// Include "baseline" (no item swap) so we can compare
const itemsToTest: Array<{ id: string; item: ItemDefinition | null }> = [
  { id: "baseline", item: null },
  ...testableItems.map(([id, item]) => ({ id, item })),
];

console.log(`\nEnqueuing solo tests...`);
for (const { id, item } of itemsToTest) {
  const template = makeHeroTemplate(item);
  for (const enemy of SOLO_ENEMIES) {
    for (const seed of SEEDS) {
      const config: ArenaConfig = {
        seed,
        red: { heroes: [{ id: "R-hero" as any, role: "hero", template }], scriptedAllies: [] },
        blue: { heroes: [], scriptedAllies: enemy.comp },
      };
      enqueue("solo", id, enemy.label, seed, config, [{ entityId: "R-hero", type: "sovereign" }]);
    }
  }
}

console.log(`Enqueuing party tests (item on fighter)...`);
for (const { id, item } of itemsToTest) {
  const fighterTemplate = makeHeroTemplate(item);
  for (const enemy of PARTY_ENEMIES) {
    for (const seed of SEEDS) {
      const config: ArenaConfig = {
        seed,
        red: {
          heroes: [
            { id: "R-tank" as any, role: "tank", template: TANK_TEMPLATE },
            { id: "R-fighter" as any, role: "fighter", template: fighterTemplate },
            { id: "R-ranged" as any, role: "ranged", template: RANGED_TEMPLATE },
          ],
          scriptedAllies: [],
        },
        blue: { heroes: [], scriptedAllies: enemy.comp },
      };
      enqueue("party", id, enemy.label, seed, config, [
        { entityId: "R-tank", type: "sovereign" },
        { entityId: "R-fighter", type: "sovereign" },
        { entityId: "R-ranged", type: "sovereign" },
      ]);
    }
  }
}

// --- Execute jobs (sequentially or in parallel) ---
console.log(`\nExecuting ${pendingJobs.length} games${workers > 0 ? ` across ${workers} workers` : " sequentially"}...`);

const allResults: ItemResult[] = [];
const jobMetaByIndex = new Map<number, { itemId: string; scenario: string; enemyLabel: string; seed: number }>();
const gameJobs: GameJob[] = pendingJobs.map((pj, i) => {
  jobMetaByIndex.set(i, { itemId: pj.itemId, scenario: pj.scenarioName, enemyLabel: pj.enemyLabel, seed: pj.seed });
  return {
    gameIndex: i,
    config: pj.config,
    controllers: pj.controllers,
    logFile: join(logDir, `${String(i).padStart(4, "0")}-${pj.scenarioName}-${pj.itemId}-${pj.enemyLabel}-s${pj.seed}.json`),
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
    const m = jobMetaByIndex.get(i)!;
    allResults.push({ ...m, result: resultMap.get(i)! });
  }
} else {
  for (const job of gameJobs) {
    const controllers = new Map<EntityId, HeroController>(
      job.controllers.map(c => [c.entityId as EntityId, makeController(c.type)])
    );
    const { result, events } = await runGame(job.config, controllers);
    writeFileSync(job.logFile, JSON.stringify(events));
    const m = jobMetaByIndex.get(job.gameIndex)!;
    allResults.push({ ...m, result });
  }
}
const elapsedMs = Date.now() - t0;

// --- Write report ---
const reportPath = join(import.meta.dir, "..", "..", "..", `item-report-dim-${dimId}.json`);
const itemMeta: Record<string, { type: string; rarity: string; slotCost: Record<string, number> }> = {};
for (const [id, item] of testableItems) itemMeta[id] = { type: item.type, rarity: item.rarity, slotCost: item.slotCost as Record<string, number> };

function translateWinner(w: string | null): string | null {
  if (w === "red") return "heroes";
  if (w === "blue") return "enemies";
  return w;
}

writeFileSync(reportPath, JSON.stringify({
  dimensionId: dimId,
  timestamp: new Date().toISOString(),
  seeds: SEEDS,
  baselineSword: "short-sword",
  baselineShield: "round-shield",
  items: itemMeta,
  results: allResults.map(r => ({
    ...r,
    result: {
      winner: translateWinner(r.result.winner),
      turns: r.result.turns,
      heroHpPct: r.result.redHpPct,
      enemyHpPct: r.result.blueHpPct,
    },
  })),
}, null, 2));

console.log(`\nDone! ${allResults.length} games in ${(elapsedMs / 1000).toFixed(1)}s.`);
console.log(`Report: ${reportPath}`);
console.log(`Logs:   ${logDir}/`);
process.exit(0);
