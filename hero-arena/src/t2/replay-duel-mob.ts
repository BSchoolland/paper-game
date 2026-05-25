#!/usr/bin/env bun
/**
 * Smart AI with standard fighter kit vs a mob of scripted enemies.
 *
 *   bun hero-arena/src/t2/replay-duel-mob.ts <agent> <seed> [outName=replay-duel-mob]
 *
 *   Open:  http://localhost:5173/?mode=replay&log=/<outName>.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import type { ReplayFrame } from "../match.js";
import type { ArenaConfig } from "./types.js";
import { buildArena2 } from "./arena2.js";
import { FIGHTER_TEMPLATE } from "./loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../../shared/src/ai/sovereign.js";

const TURN_BUDGET_MS = Number(globalThis.process?.env?.HERO_TURN_BUDGET_MS ?? 2000);
const FORFEIT_FACTOR = 3;
const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 120;

const seed = Number(process.argv[2] ?? 42);
const outName = process.argv[3] ?? "replay-duel-mob";

const redCtl1 = makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
const redCtl2 = makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
const blueCtl1 = makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);
const blueCtl2 = makeSovereign(FIGHTER_WEIGHTS, PRESETS.crafty);

const MOB = [
  { key: "massive-slime",  count: 1, dim: 0 },
  { key: "big-slime",      count: 1, dim: 0 },
  { key: "goblin-spear",   count: 2, dim: 0 },
  { key: "goblin-shield",  count: 2, dim: 0 },
  { key: "goblin-archer",  count: 1, dim: 0 },
];

const config: ArenaConfig = {
  seed,
  red:  { heroes: [
    { id: "R-hero1", role: "fighter", template: FIGHTER_TEMPLATE },
    { id: "R-hero2", role: "fighter", template: FIGHTER_TEMPLATE },
  ], scriptedAllies: MOB },
  blue: { heroes: [
    { id: "B-hero1", role: "fighter", template: FIGHTER_TEMPLATE },
    { id: "B-hero2", role: "fighter", template: FIGHTER_TEMPLATE },
  ], scriptedAllies: MOB },
};

console.log(`# 2 crafty fighters + massive slime + big slime + 5 goblins per side — seed ${seed}`);

const arena = await buildArena2(config);
let state = arena.state;
const heroIds: Record<TeamId, EntityId[]> = {
  red: ["R-hero1", "R-hero2"] as EntityId[],
  blue: ["B-hero1", "B-hero2"] as EntityId[],
};
const controllers: Record<TeamId, Map<EntityId, ReturnType<typeof makeSovereign>>> = {
  red: new Map([["R-hero1" as EntityId, redCtl1], ["R-hero2" as EntityId, redCtl2]]),
  blue: new Map([["B-hero1" as EntityId, blueCtl1], ["B-hero2" as EntityId, blueCtl2]]),
};
const frames: ReplayFrame[] = [{
  serializedState: serializeGameState(state), events: [], turnNumber: state.turnNumber, team: state.activeTeam,
}];

const record = (events: readonly GameEvent[]) => {
  frames.push({ serializedState: serializeGameState(state), events: [...events], turnNumber: state.turnNumber, team: state.activeTeam });
};
const step = (action: PlayerAction): boolean => {
  const res = resolveAction(state, action);
  if (res.state === state) return false;
  state = res.state;
  record(res.events);
  return true;
};

const turnIdx: Record<TeamId, number> = { red: 0, blue: 0 };

for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
  const team = state.activeTeam;
  turnIdx[team]++;

  // Hero turns
  for (const heroId of heroIds[team]) {
    if (state.winner) break;
    const hero = state.entities.get(heroId);
    if (!hero || hero.dead) continue;
    const ctl = controllers[team].get(heroId);
    if (!ctl) continue;
    const ctx = { state, heroId, deadlineMs: Date.now() + TURN_BUDGET_MS, turnIndex: turnIdx[team] };
    const t0 = Date.now();
    let actions: PlayerAction[] = [];
    try { actions = ctl(ctx) ?? []; }
    catch (e) { console.error(`!! ${heroId} threw: ${(e as Error).message}`); }
    const dt = Date.now() - t0;
    if (dt > TURN_BUDGET_MS * FORFEIT_FACTOR) actions = [];
    let applied = 0;
    for (const a of actions) {
      if (applied >= MAX_HERO_ACTIONS) break;
      if (a.type !== "ability" || a.entityId !== heroId) continue;
      if (step(a)) applied++;
      if (state.winner) break;
    }
  }

  // Scripted allies (big slime)
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

const result = state.winner ?? "draw";
console.log(`\nResult: ${result === "red" ? "RED WINS" : result === "blue" ? "BLUE WINS" : "DRAW"}  (${state.turnNumber} turns)`);
for (const team of ["red", "blue"] as TeamId[]) {
  for (const id of heroIds[team]) {
    const h = state.entities.get(id);
    console.log(`  ${id}: ${h?.dead ? "DEAD" : `${h!.hp}/${h!.maxHp} hp`}`);
  }
}

const outPath = join(import.meta.dir, "..", "..", "..", "client", "public", `${outName}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ seed, dimensions: [0], frames }));
console.log(`\nWrote ${frames.length}-frame replay → ${outPath}`);
console.log(`Watch:  http://localhost:5173/?mode=replay&log=/${outName}.json`);

function closestEnemyDist(e: { teamId: TeamId; position: { x: number; y: number } }): number {
  let best = Infinity;
  for (const o of state.entities.values()) if (!o.dead && o.teamId !== e.teamId) {
    best = Math.min(best, Math.hypot(e.position.x - o.position.x, e.position.y - o.position.y));
  }
  return best;
}
