#!/usr/bin/env bun
/**
 * Long-lived game worker for parallel balance/item tests. Reads JSON-line jobs from stdin,
 * writes event logs to disk, returns result summaries on stdout (one line per result).
 * Exits when stdin closes.
 *
 * Job format:
 *   { gameIndex, config, controllers: [{entityId, type}], logFile }
 * Result format (internal — translated to heroes/enemies at report time):
 *   { gameIndex, result: { winner, turns, redHpPct, blueHpPct } }
 */
import { writeFileSync, createWriteStream } from "node:fs";
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { rushStrategy, kiteStrategy, strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { buildArena2 } from "./arena2.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { ArenaConfig } from "./types.js";
import type { HeroController } from "../types.js";

const MAX_ACTIONS = 16;
const MAX_TURNS = 80;

type ControllerType = "sovereign" | "rush" | "kite";

interface GameJob {
  gameIndex: number;
  config: ArenaConfig;
  controllers: { entityId: string; type: ControllerType }[];
  logFile: string;
}

interface GameResult { winner: string | null; turns: number; redHpPct: number; blueHpPct: number; }

function makeController(type: ControllerType): HeroController {
  if (type === "sovereign") return makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
  return (ctx) => {
    const entity = ctx.state.entities.get(ctx.heroId);
    if (!entity || entity.dead) return [];
    const strat = type === "kite" ? kiteStrategy : rushStrategy;
    return strat.planActions(entity, ctx.state);
  };
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

// --- Server-side data init (same lazy import pattern as arena2.ts) ---
// arena2's buildArena2 already lazy-loads the server modules on first call.
// We just need to make sure the seeds are loaded so loadEnemyTemplateRegistry has data.
process.chdir(new URL("../../../server", import.meta.url).pathname);
await import("../../../server/src/index.js").catch(() => {});

// --- JSON-lines stdin/stdout loop ---
const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    const job = JSON.parse(line) as GameJob;
    const controllers = new Map<EntityId, HeroController>(
      job.controllers.map(c => [c.entityId as EntityId, makeController(c.type)])
    );
    const { result, events } = await runGame(job.config, controllers);
    writeFileSync(job.logFile, JSON.stringify(events));
    process.stdout.write(JSON.stringify({ gameIndex: job.gameIndex, result }) + "\n");
  }
}
