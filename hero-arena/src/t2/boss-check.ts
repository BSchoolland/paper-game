#!/usr/bin/env bun
/**
 * Targeted boss sanity check: runs specific bosses through solo-expert and party scenarios
 * (a slice of balance-test.ts's battery) and prints a per-boss table. Use before/after tuning
 * a boss without paying for the full 16-enemy battery.
 *
 *   bun hero-arena/src/t2/boss-check.ts <dimId> <bossKey> [bossKey...] [--seeds N]
 *   GAME_DB_PATH=... to point at a different DB (e.g. an unpatched copy for a baseline).
 */
import { join } from "node:path";
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, GameState, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { rushStrategy, kiteStrategy, strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { ArenaConfig } from "./types.js";
import type { HeroController } from "../types.js";

const args = process.argv.slice(2).filter((a) => a !== "--seeds");
const seedIdx = process.argv.indexOf("--seeds");
const seedCount = seedIdx >= 0 ? Number(process.argv[seedIdx + 1]) : 6;
const dimId = Number(args[0]);
const bossKeys = args.slice(1).filter((a) => isNaN(Number(a)));
if (isNaN(dimId) || bossKeys.length === 0) {
  console.error("usage: bun boss-check.ts <dimId> <bossKey> [bossKey...] [--seeds N]");
  process.exit(2);
}
const SEEDS = Array.from({ length: seedCount }, (_, i) => i + 1);

process.chdir(join(import.meta.dir, "..", "..", "..", "server"));
const { loadEnemyTemplateRegistry } = await import("../../../server/src/db.js");
const registry = loadEnemyTemplateRegistry(dimId);

const MAX_ACTIONS = 16;
const MAX_TURNS = 80;

function makeController(type: "sovereign" | "rush" | "kite"): HeroController {
  if (type === "sovereign") return makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
  return (ctx) => {
    const entity = ctx.state.entities.get(ctx.heroId);
    if (!entity || entity.dead) return [];
    return (type === "kite" ? kiteStrategy : rushStrategy).planActions(entity, ctx.state);
  };
}

interface GameOutcome {
  won: boolean;
  turns: number;
  heroHpPct: number;
}

async function runGame(config: ArenaConfig, controllers: Map<EntityId, HeroController>): Promise<GameOutcome> {
  const arena = await buildArena2(config);
  let state = arena.state;

  const step = (a: PlayerAction): boolean => {
    const r = resolveAction(state, a);
    if (r.state === state) return false;
    state = r.state;
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

  let hp = 0, max = 0;
  for (const e of state.entities.values()) {
    if (e.teamId !== "red") continue;
    max += e.maxHp;
    hp += e.dead ? 0 : e.hp;
  }
  return { won: state.winner === "red", turns: state.turnNumber, heroHpPct: max > 0 ? Math.round(100 * hp / max) : 0 };
}

function summarize(outcomes: GameOutcome[]): string {
  const wins = outcomes.filter(o => o.won).length;
  const avgTurns = outcomes.reduce((s, o) => s + o.turns, 0) / outcomes.length;
  const avgHp = outcomes.reduce((s, o) => s + o.heroHpPct, 0) / outcomes.length;
  return `win ${wins}/${outcomes.length}  turns ${avgTurns.toFixed(1)}  heroHP ${avgHp.toFixed(0)}%`;
}

for (const key of bossKeys) {
  const template = registry[key];
  if (!template) throw new Error(`boss "${key}" not found in dimension ${dimId}`);
  const boss = [{ key, count: 1, dim: dimId }];
  console.log(`\n=== ${template.className} (dim ${dimId}, cost ${template.cost}) ===`);

  const scenarios: Array<{ name: string; config: (seed: number) => ArenaConfig; heroes: Array<[string, "sovereign" | "rush" | "kite"]> }> = [
    {
      name: "solo-expert-fighter",
      config: (seed) => ({
        seed,
        red: { heroes: [{ id: "R-hero" as EntityId, role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
        blue: { heroes: [], scriptedAllies: boss },
      }),
      heroes: [["R-hero", "sovereign"]],
    },
    {
      name: "party-expert",
      config: (seed) => ({
        seed,
        red: {
          heroes: [
            { id: "R-tank" as EntityId, role: "tank", template: TANK_TEMPLATE },
            { id: "R-fighter" as EntityId, role: "fighter", template: FIGHTER_TEMPLATE },
            { id: "R-ranged" as EntityId, role: "ranged", template: RANGED_TEMPLATE },
          ],
          scriptedAllies: [],
        },
        blue: { heroes: [], scriptedAllies: boss },
      }),
      heroes: [["R-tank", "sovereign"], ["R-fighter", "sovereign"], ["R-ranged", "sovereign"]],
    },
    {
      name: "party-dumb",
      config: (seed) => ({
        seed,
        red: {
          heroes: [
            { id: "R-tank" as EntityId, role: "tank", template: TANK_TEMPLATE },
            { id: "R-fighter" as EntityId, role: "fighter", template: FIGHTER_TEMPLATE },
            { id: "R-ranged" as EntityId, role: "ranged", template: RANGED_TEMPLATE },
          ],
          scriptedAllies: [],
        },
        blue: { heroes: [], scriptedAllies: boss },
      }),
      heroes: [["R-tank", "rush"], ["R-fighter", "rush"], ["R-ranged", "kite"]],
    },
  ];

  for (const sc of scenarios) {
    const outcomes: GameOutcome[] = [];
    for (const seed of SEEDS) {
      const controllers = new Map<EntityId, HeroController>(sc.heroes.map(([id, type]) => [id, makeController(type)]));
      outcomes.push(await runGame(sc.config(seed), controllers));
    }
    console.log(`  ${sc.name.padEnd(22)} ${summarize(outcomes)}`);
  }
}
