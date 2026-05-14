#!/usr/bin/env bun
/**
 * Two boss-template (300HP) heroes 1v1, each piloted by a different controller from an agent.
 * Usage:
 *   bun hero-arena/src/t2/replay-boss-duel.ts <agentName> <redCtl> <blueCtl> <seed> [outName]
 *
 * <redCtl>/<blueCtl> are controller picks: "boss" | "fighter" | "tank" | "ranged"
 *   e.g. bun ... agent-02 fighter boss 42 replay-boss-duel-f-vs-b
 *
 * Open:  http://localhost:5173/?mode=replay&log=/<outName>.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import type { HeroController } from "../types.js";
import type { ReplayFrame } from "../match.js";
import type { ArenaConfig } from "./types.js";
import { buildArena2 } from "./arena2.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import { BOSS_TEMPLATE } from "./loadouts.js";
import { AGENTS2 } from "./registry2.js";

const WITH_MINIONS = process.env.MINIONS === "1";
const MINIONS = [
  { key: "goblin-spear",  count: 1, dim: 0 as const },
  { key: "goblin-archer", count: 1, dim: 0 as const },
  { key: "goblin-shield", count: 1, dim: 0 as const },
  { key: "slime",         count: 1, dim: 0 as const },
  { key: "big-slime",     count: 1, dim: 0 as const },
];

const TURN_BUDGET_MS = Number(globalThis.process?.env?.HERO_TURN_BUDGET_MS ?? 2000);
const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 140;

const agentName = process.argv[2];
const redCtlKey = process.argv[3];
const blueCtlKey = process.argv[4];
const seed = Number(process.argv[5] ?? 42);
const outName = process.argv[6] ?? "replay-boss-duel";

type CtlKey = "boss" | "fighter" | "tank" | "ranged";
const valid: CtlKey[] = ["boss", "fighter", "tank", "ranged"];

if (!agentName || !AGENTS2[agentName] || !valid.includes(redCtlKey as CtlKey) || !valid.includes(blueCtlKey as CtlKey)) {
  console.error(`usage: bun ... <agent> <redCtl:boss|fighter|tank|ranged> <blueCtl:...> <seed> [outName]`);
  console.error(`  agents: ${Object.keys(AGENTS2).join(", ")}`);
  process.exit(2);
}

const agent = AGENTS2[agentName]!;
const pickCtl = (k: CtlKey): HeroController => {
  if (k === "boss") return agent.boss;
  if (k === "fighter") return agent.squad.fighter;
  if (k === "tank") return agent.squad.tank;
  return agent.squad.ranged;
};

const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-boss", role: "boss", template: BOSS_TEMPLATE }], scriptedAllies: WITH_MINIONS ? MINIONS : [] },
  blue: { heroes: [{ id: "B-boss", role: "boss", template: BOSS_TEMPLATE }], scriptedAllies: WITH_MINIONS ? MINIONS : [] },
};

const controllers: Record<TeamId, Map<EntityId, HeroController>> = { red: new Map(), blue: new Map() };
controllers.red.set("R-boss" as EntityId, pickCtl(redCtlKey as CtlKey));
controllers.blue.set("B-boss" as EntityId, pickCtl(blueCtlKey as CtlKey));

const heroIds: Record<TeamId, EntityId[]> = {
  red: ["R-boss"] as EntityId[],
  blue: ["B-boss"] as EntityId[],
};

console.log(`# ${agentName}: red=${redCtlKey}-ctl vs blue=${blueCtlKey}-ctl — both on 300HP boss template — seed ${seed}`);

const arena = await buildArena2(config);
let state = arena.state;
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

const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };

for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
  const team = state.activeTeam;
  turnIndex[team]++;
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
  if (!state.winner && WITH_MINIONS) {
    const allies = [...state.entities.values()]
      .filter(e => e.teamId === team && !e.dead && !heroIds[team].includes(e.id));
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

const hpR = hpFraction(state, "red"), hpB = hpFraction(state, "blue");
const r = state.entities.get("R-boss" as EntityId);
const b = state.entities.get("B-boss" as EntityId);
const outcome = state.winner ?? (Math.abs(hpR - hpB) < 1e-6 ? "draw" : (hpR > hpB ? "red" : "blue"));
console.log(`\nResult: ${outcome === "red" ? `RED (${redCtlKey}-ctl) WINS` : outcome === "blue" ? `BLUE (${blueCtlKey}-ctl) WINS` : "DRAW"}`);
console.log(`  turns ${state.turnNumber}`);
console.log(`  red  (${redCtlKey}-ctl):  ${r?.dead ? "DEAD" : `${r?.hp}/${r?.maxHp} hp`}`);
console.log(`  blue (${blueCtlKey}-ctl): ${b?.dead ? "DEAD" : `${b?.hp}/${b?.maxHp} hp`}`);

const outPath = join(import.meta.dir, "..", "..", "..", "client", "public", `${outName}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ seed, dimensions: [0], frames }));
console.log(`\nWrote ${frames.length}-frame replay → ${outPath}`);
console.log(`Watch:  http://localhost:5173/?mode=replay&log=/${outName}.json`);
