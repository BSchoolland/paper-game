#!/usr/bin/env bun
/**
 * 1 hero + N scripted minions per side. Each side's hero uses a Sovereign preset.
 *
 *   bun hero-arena/src/t2/replay-presets-mob.ts <redPreset> <bluePreset> <seed> [outName] [minionCount=5]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import type { EntityId, GameEvent, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import { REPLAYS_DIR } from "../../../shared/src/paths.js";
import type { HeroController } from "../types.js";
import type { ReplayFrame } from "../match.js";
import type { ArenaConfig } from "./types.js";
import { buildArena2 } from "./arena2.js";
import { FIGHTER_TEMPLATE } from "./loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { IntelligencePreset } from "../../agents/agent-02/sovereign.js";

const TURN_BUDGET_MS = 10000;
const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 140;

const redPreset = process.argv[2] as IntelligencePreset;
const bluePreset = process.argv[3] as IntelligencePreset;
const seed = Number(process.argv[4] ?? 42);
const outName = process.argv[5] ?? `replay-${redPreset}-vs-${bluePreset}-mob`;
const minionCount = Number(process.argv[6] ?? 5);

if (!(redPreset in PRESETS) || !(bluePreset in PRESETS)) {
  console.error(`usage: bun ... <redPreset> <bluePreset> <seed> [outName] [minionCount]`);
  console.error(`  presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

const minionKit: Array<{ key: string; count: number; dim: 0 }> = ([
  { key: "goblin-spear",  count: 1, dim: 0 as const },
  { key: "goblin-archer", count: 1, dim: 0 as const },
  { key: "goblin-shield", count: 1, dim: 0 as const },
  { key: "slime",         count: 1, dim: 0 as const },
  { key: "big-slime",     count: 1, dim: 0 as const },
]).slice(0, minionCount);

const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-hero", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: minionKit },
  blue: { heroes: [{ id: "B-hero", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: minionKit },
};

const mk = (p: IntelligencePreset): HeroController => makeSovereign(FIGHTER_WEIGHTS, PRESETS[p]);
const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red:  new Map([["R-hero" as EntityId, mk(redPreset)]]),
  blue: new Map([["B-hero" as EntityId, mk(bluePreset)]]),
};
const heroIds: Record<TeamId, EntityId[]> = {
  red:  ["R-hero" as EntityId],
  blue: ["B-hero" as EntityId],
};

console.log(`# ${redPreset} (red) vs ${bluePreset} (blue), ${minionCount} minions/side — seed ${seed}`);

const arena = await buildArena2(config);
let state = arena.state;
const frames: ReplayFrame[] = [{
  serializedState: serializeGameState(state), events: [], turnNumber: state.turnNumber, team: state.activeTeam,
}];

const record = (events: readonly GameEvent[]) => {
  frames.push({ serializedState: serializeGameState(state), events: [...events], turnNumber: state.turnNumber, team: state.activeTeam });
};
const step = (action: PlayerAction): boolean => {
  const r = resolveAction(state, action);
  if (r.state === state) return false;
  state = r.state;
  record(r.events);
  return true;
};

const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };

for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
  const team = state.activeTeam;
  turnIndex[team]++;
  // Hero acts first
  for (const heroId of heroIds[team]) {
    const hero = state.entities.get(heroId);
    if (!hero || hero.dead) continue;
    const ctx = { state, heroId, deadlineMs: Date.now() + TURN_BUDGET_MS, turnIndex: turnIndex[team] };
    let actions: PlayerAction[] = [];
    try { actions = controllers[team].get(heroId)!(ctx) ?? []; }
    catch (e) { console.error(`!! ${heroId} threw: ${(e as Error).message}`); }

    let applied = 0;
    for (const a of actions) {
      if (applied >= MAX_HERO_ACTIONS) break;
      if (a.type !== "ability" || a.entityId !== heroId) continue;
      if (step(a)) applied++;
      if (state.winner) break;
    }
    if (state.winner) break;
  }
  // Scripted minions
  if (!state.winner) {
    const allies = [...state.entities.values()]
      .filter(e => e.teamId === team && !e.dead && !heroIds[team].includes(e.id))
      .sort((a, b) => closestEnemyDist(a) - closestEnemyDist(b));
    for (const u of allies) {
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

function hpFraction(s: GameState, team: TeamId): number {
  let hp = 0, max = 0;
  for (const e of s.entities.values()) if (e.teamId === team) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
  return max > 0 ? hp / max : 0;
}
function closestEnemyDist(e: { teamId: TeamId; position: { x: number; y: number } }): number {
  let best = Infinity;
  for (const o of state.entities.values()) if (!o.dead && o.teamId !== e.teamId) {
    best = Math.min(best, Math.hypot(e.position.x - o.position.x, e.position.y - o.position.y));
  }
  return best;
}

const hpR = hpFraction(state, "red"), hpB = hpFraction(state, "blue");
const outcome = state.winner ?? (Math.abs(hpR - hpB) < 1e-6 ? "draw" : (hpR > hpB ? "red" : "blue"));
console.log(`\nResult: ${outcome === "red" ? `${redPreset} (red) WINS` : outcome === "blue" ? `${bluePreset} (blue) WINS` : "DRAW"}  ` +
            `(${state.turnNumber} turns, HP%: red ${(hpR*100).toFixed(0)} / blue ${(hpB*100).toFixed(0)})`);

const outPath = join(REPLAYS_DIR, `${outName}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ seed, dimensions: [0], frames }));
console.log(`\nWrote ${frames.length}-frame replay → ${outPath}`);
console.log(`Watch:  bun dev → backtick (dev hub) → ${outName}.json`);
