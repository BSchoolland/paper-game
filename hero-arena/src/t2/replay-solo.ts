#!/usr/bin/env bun
/**
 * Run ONE Solo-challenge match with a chosen agent + seed + ladder tier, capture frames,
 * and write a replay JSON for the in-browser viewer.
 *
 *   bun hero-arena/src/t2/replay-solo.ts <agent> <seed> <tier> [outName=replay]
 *   bun hero-arena/src/t2/replay-solo.ts agent-04 42 8 replay-solo-vanguard
 *
 *   Open:  http://localhost:5173/?mode=replay&log=/<outName>.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import type { ReplayFrame } from "../match.js";
import type { ArenaConfig } from "./types.js";
import { buildArena2 } from "./arena2.js";
import { generateRandomLoadout } from "./loadouts.js";
import { LADDER } from "./enemy-ladder.js";
import { AGENTS2 } from "./registry2.js";

const TURN_BUDGET_MS = Number(globalThis.process?.env?.HERO_TURN_BUDGET_MS ?? 2000);
const FORFEIT_FACTOR = 3;
const MAX_HERO_ACTIONS = 16;

const agentName = process.argv[2];
const seed = Number(process.argv[3] ?? 42);
const tierArg = process.argv[4] ?? "5";
const outName = process.argv[5] ?? "replay";

if (!agentName || !AGENTS2[agentName]) {
  console.error(`usage: bun hero-arena/src/t2/replay-solo.ts <agent> <seed> <tier|custom> [outName]`);
  console.error(`  tier: integer ladder tier, OR a custom composition "key:count:dim[,key:count:dim...]@maxTurns"`);
  console.error(`  e.g.  agent-04 42 stone-golem:1:0@120 replay-vs-golem`);
  console.error(`  agents: ${Object.keys(AGENTS2).join(", ")}`);
  process.exit(2);
}

interface ResolvedComp { label: string; composition: Array<{ key: string; count: number; dim: 0|1|2|3 }>; maxTurns: number }
let resolved: ResolvedComp;
const asNum = Number(tierArg);
if (Number.isFinite(asNum)) {
  const tier = LADDER.find(t => t.level === asNum);
  if (!tier) { console.error(`tier ${asNum} not in ladder`); process.exit(2); }
  resolved = { label: `tier ${tier.level} (${tier.label})`, composition: tier.composition.slice(), maxTurns: tier.maxTurns };
} else {
  const [compStr, mtStr] = tierArg.split("@");
  const maxTurns = mtStr ? Number(mtStr) : 100;
  const composition = compStr!.split(",").map(s => {
    const [key, count, dim] = s.split(":");
    return { key: key!, count: Number(count ?? 1), dim: Number(dim ?? 0) as 0|1|2|3 };
  });
  resolved = { label: `custom: ${compStr}`, composition, maxTurns };
}

const agent = AGENTS2[agentName]!;
const { template, abilities } = generateRandomLoadout(seed);
const controller = agent.solo(abilities);
const abilityNames = abilities.filter(a => a.kind === "attack").map(a => a.name).join(", ");

console.log(`# ${agentName} — ${resolved.label} — seed ${seed}`);
console.log(`# kit: ${abilityNames}`);

const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-solo", role: "solo", template }], scriptedAllies: [] },
  blue: { heroes: [], scriptedAllies: resolved.composition.map(c => ({ key: c.key, count: c.count, dim: c.dim })) },
};

const arena = await buildArena2(config);
let state = arena.state;
const heroId = "R-solo" as EntityId;
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

let turnIndex = 0;
const maxTurns = resolved.maxTurns;

for (let t = 0; t < maxTurns && !state.winner; t++) {
  const team = state.activeTeam;

  if (team === "red") {
    turnIndex++;
    const hero = state.entities.get(heroId);
    if (hero && !hero.dead) {
      const ctx = { state, heroId, deadlineMs: Date.now() + TURN_BUDGET_MS, turnIndex };
      const t0 = Date.now();
      let actions: PlayerAction[] = [];
      try { actions = controller(ctx) ?? []; }
      catch (e) { console.error(`!! threw: ${(e as Error).message}`); }
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
  } else {
    // Scripted enemy team
    const units = [...state.entities.values()]
      .filter(e => e.teamId === team && !e.dead)
      .sort((a, b) => closestEnemyDist(a) - closestEnemyDist(b));
    for (const u of units) {
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

const heroAlive = !state.entities.get(heroId)?.dead;
const result = state.winner ?? (heroAlive ? "draw" : "blue");
console.log(`\nResult: ${result === "red" ? "HERO WINS" : result === "blue" ? "HERO DIES" : "TURN CAP"}  ` +
            `(${state.turnNumber} turns, hero ${heroAlive ? "alive" : "dead"})`);

const outPath = join(import.meta.dir, "..", "..", "..", "client", "public", `${outName}.json`);
mkdirSync(dirname(outPath), { recursive: true });
const dims = Array.from(new Set<number>([0, ...resolved.composition.map(c => c.dim)])).sort();
writeFileSync(outPath, JSON.stringify({ seed, dimensions: dims, frames }));
console.log(`\nWrote ${frames.length}-frame replay → ${outPath}`);
console.log(`Watch:  http://localhost:5173/?mode=replay&log=/${outName}.json`);

function closestEnemyDist(e: { teamId: TeamId; position: { x: number; y: number } }): number {
  let best = Infinity;
  for (const o of state.entities.values()) if (!o.dead && o.teamId !== e.teamId) {
    best = Math.min(best, Math.hypot(e.position.x - o.position.x, e.position.y - o.position.y));
  }
  return best;
}
