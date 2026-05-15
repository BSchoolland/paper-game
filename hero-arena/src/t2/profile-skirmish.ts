#!/usr/bin/env bun
/**
 * CPU-profile crafty vs crafty, asymmetric 1v1 + 10 minions (the realistic case).
 *   bun hero-arena/src/t2/profile-skirmish.ts [seed]
 */
import { Session } from "node:inspector/promises";
import { writeFileSync } from "node:fs";
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { buildArena2 } from "./arena2.js";
import { FIGHTER_TEMPLATE } from "./loadouts.js";
import type { ArenaConfig } from "./types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { HeroController } from "../types.js";

const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 60;
const seed = Number(process.argv[2] ?? 42);
const preset = "crafty" as const;
const MINIONS: Array<{ key: string; count: number; dim: 0 }> = [
  { key: "goblin-spear", count: 3, dim: 0 },
  { key: "goblin-archer", count: 2, dim: 0 },
  { key: "goblin-shield", count: 2, dim: 0 },
  { key: "slime", count: 2, dim: 0 },
  { key: "big-slime", count: 1, dim: 0 },
];

const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
  blue: { heroes: [{ id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: MINIONS },
};
const arena = await buildArena2(config);
let state = arena.state;
const redBrain: HeroController = makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset]);
const blueBrain: HeroController = makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset]);
const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red: new Map([["R-fighter" as EntityId, redBrain]]),
  blue: new Map([["B-fighter" as EntityId, blueBrain]]),
};
const heroIds: Record<TeamId, EntityId[]> = { red: ["R-fighter" as EntityId], blue: ["B-fighter" as EntityId] };
const budget = () => (PRESETS[preset].softBudgetMs ?? 2000) + 500;
const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };
const step = (a: PlayerAction): boolean => {
  const r = resolveAction(state, a);
  if (r.state === state) return false;
  state = r.state; return true;
};

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.setSamplingInterval", { interval: 100 });
await session.post("Profiler.start");
const wallStart = Date.now();

for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
  const team = state.activeTeam;
  turnIndex[team]++;
  for (const heroId of heroIds[team]) {
    const hero = state.entities.get(heroId);
    if (!hero || hero.dead) continue;
    const ctx = { state, heroId, deadlineMs: Date.now() + budget(), turnIndex: turnIndex[team] };
    let actions: PlayerAction[] = [];
    try { actions = controllers[team].get(heroId)!(ctx) ?? []; }
    catch (e) { console.error(`!! threw: ${(e as Error).message}`); }
    let applied = 0;
    for (const a of actions) {
      if (applied >= MAX_HERO_ACTIONS) break;
      if (a.type !== "ability" || a.entityId !== heroId) continue;
      if (step(a)) applied++;
      if (state.winner) break;
    }
    if (state.winner) break;
  }
  if (!state.winner) step({ type: "endTurn" });
}

const wallMs = Date.now() - wallStart;
const { profile } = await session.post("Profiler.stop");
writeFileSync("/tmp/sovereign-skirmish.cpuprofile", JSON.stringify(profile));

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] };
const nodes: Node[] = profile.nodes as Node[];
const samples: number[] = profile.samples as number[];
const timeDeltas: number[] = profile.timeDeltas as number[];
const byId = new Map(nodes.map(n => [n.id, n]));
const selfUs = new Map<number, number>();
for (let i = 0; i < samples.length; i++) selfUs.set(samples[i]!, (selfUs.get(samples[i]!) ?? 0) + (timeDeltas[i] ?? 0));
const totalUs = new Map<number, number>();
function totalOf(id: number): number {
  if (totalUs.has(id)) return totalUs.get(id)!;
  let t = selfUs.get(id) ?? 0;
  const n = byId.get(id);
  for (const c of (n?.children ?? [])) t += totalOf(c);
  totalUs.set(id, t);
  return t;
}
for (const n of nodes) totalOf(n.id);
function key(n: Node) {
  const file = n.callFrame.url.split("/").slice(-2).join("/");
  return `${n.callFrame.functionName || "(anon)"}  ${file}:${n.callFrame.lineNumber + 1}`;
}
const aggSelf = new Map<string, number>();
const aggTotal = new Map<string, number>();
for (const n of nodes) {
  const k = key(n);
  aggSelf.set(k, (aggSelf.get(k) ?? 0) + (selfUs.get(n.id) ?? 0));
  aggTotal.set(k, (aggTotal.get(k) ?? 0) + (totalUs.get(n.id) ?? 0));
}
const totalSampledUs = [...selfUs.values()].reduce((a, b) => a + b, 0);
console.log(`# crafty vs crafty asym 1v1+10min, seed ${seed}, ${state.turnNumber} game-turns, wall ${wallMs}ms, sampled ${(totalSampledUs/1000).toFixed(0)}ms`);
function dump(label: string, m: Map<string, number>, n = 25) {
  console.log(`\n## top ${n} by ${label} time`);
  console.log(`  ${"ms".padStart(8)}  ${"%".padStart(6)}  function`);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  for (const [k, us] of rows) {
    const ms = us / 1000;
    const pct = (us / totalSampledUs) * 100;
    console.log(`  ${ms.toFixed(1).padStart(8)}  ${pct.toFixed(1).padStart(5)}%  ${k}`);
  }
}
dump("self", aggSelf, 30);
dump("total", aggTotal, 30);
