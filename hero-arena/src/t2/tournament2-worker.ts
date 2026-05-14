#!/usr/bin/env bun
/**
 * Parallel worker: reads a JSON array of work units from argv[2] file path,
 * runs each, writes a JSON array of results to stdout.
 *
 * Unit kinds:
 *   solo / squad         → run all ladder tiers for (agent, seed); return best level cleared
 *   skirmish / boss      → run a single match; return outcome + hpFrac
 */
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { AGENTS2 } from "./registry2.js";
import { generateRandomLoadout, TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE, BOSS_TEMPLATE } from "./loadouts.js";
import { LADDER } from "./enemy-ladder.js";
import { runMatch2 } from "./match2.js";
import type { ArenaConfig } from "./types.js";

const BOSS_MINIONS: Array<{ key: string; count: number; dim: 0 }> = [
  { key: "goblin-spear", count: 1, dim: 0 },
  { key: "goblin-archer", count: 1, dim: 0 },
  { key: "goblin-shield", count: 1, dim: 0 },
  { key: "slime", count: 1, dim: 0 },
  { key: "big-slime", count: 1, dim: 0 },
];

export type Unit =
  | { kind: "solo"; agent: string; seed: number }
  | { kind: "squad"; agent: string; seed: number }
  | { kind: "skirmish"; redAgent: string; blueAgent: string; seed: number }
  | { kind: "boss"; bossAgent: string; raidAgent: string; seed: number };

export type UnitResult =
  | { kind: "solo" | "squad"; agent: string; seed: number; bestLevel: number }
  | { kind: "skirmish"; redAgent: string; blueAgent: string; seed: number; outcome: "red" | "blue" | "draw"; hpRed: number; hpBlue: number }
  | { kind: "boss"; bossAgent: string; raidAgent: string; seed: number; outcome: "red" | "blue" | "draw"; hpRed: number; hpBlue: number };

async function runSoloUnit(agentName: string, seed: number): Promise<number> {
  const agent = AGENTS2[agentName]!;
  const { template, abilities } = generateRandomLoadout(seed);
  const controller = agent.solo(abilities);
  let seedLevel = 0;
  for (const tier of LADDER) {
    const config: ArenaConfig = {
      seed,
      red: { heroes: [{ id: "R-solo", role: "solo", template }], scriptedAllies: [] },
      blue: { heroes: [], scriptedAllies: tier.composition.map(c => ({ key: c.key, count: c.count, dim: c.dim })) },
    };
    const result = await runMatch2(
      { name: agent.name, controllers: new Map([["R-solo", controller]]) },
      { name: `tier-${tier.level}`, controllers: new Map() },
      config,
      { maxTurns: tier.maxTurns },
    );
    if (result.outcome === "red") seedLevel = tier.level;
    else break;
  }
  return seedLevel;
}

async function runSquadUnit(agentName: string, seed: number): Promise<number> {
  const agent = AGENTS2[agentName]!;
  let seedLevel = 0;
  for (const tier of LADDER) {
    const config: ArenaConfig = {
      seed,
      red: {
        heroes: [
          { id: "R-tank", role: "tank", template: TANK_TEMPLATE },
          { id: "R-fighter", role: "fighter", template: FIGHTER_TEMPLATE },
          { id: "R-ranged", role: "ranged", template: RANGED_TEMPLATE },
        ],
        scriptedAllies: [],
      },
      blue: { heroes: [], scriptedAllies: tier.composition.map(c => ({ key: c.key, count: c.count, dim: c.dim })) },
    };
    const result = await runMatch2(
      {
        name: agent.name,
        controllers: new Map([
          ["R-tank", agent.squad.tank],
          ["R-fighter", agent.squad.fighter],
          ["R-ranged", agent.squad.ranged],
        ]),
      },
      { name: `tier-${tier.level}`, controllers: new Map() },
      config,
      { maxTurns: tier.maxTurns },
    );
    if (result.outcome === "red") seedLevel = tier.level;
    else break;
  }
  return seedLevel;
}

async function runSkirmishUnit(redName: string, blueName: string, seed: number) {
  const red = AGENTS2[redName]!, blue = AGENTS2[blueName]!;
  const config: ArenaConfig = {
    seed,
    red: {
      heroes: [
        { id: "R-tank", role: "tank", template: TANK_TEMPLATE },
        { id: "R-fighter", role: "fighter", template: FIGHTER_TEMPLATE },
        { id: "R-ranged", role: "ranged", template: RANGED_TEMPLATE },
      ],
      scriptedAllies: [],
    },
    blue: {
      heroes: [
        { id: "B-tank", role: "tank", template: TANK_TEMPLATE },
        { id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE },
        { id: "B-ranged", role: "ranged", template: RANGED_TEMPLATE },
      ],
      scriptedAllies: [],
    },
  };
  const result = await runMatch2(
    {
      name: red.name,
      controllers: new Map([["R-tank", red.squad.tank], ["R-fighter", red.squad.fighter], ["R-ranged", red.squad.ranged]]),
    },
    {
      name: blue.name,
      controllers: new Map([["B-tank", blue.squad.tank], ["B-fighter", blue.squad.fighter], ["B-ranged", blue.squad.ranged]]),
    },
    config,
  );
  return { outcome: result.outcome, hpRed: result.hpFrac.red, hpBlue: result.hpFrac.blue };
}

async function runBossUnit(bossName: string, raidName: string, seed: number) {
  const boss = AGENTS2[bossName]!, raid = AGENTS2[raidName]!;
  const config: ArenaConfig = {
    seed,
    red: {
      heroes: [{ id: "R-boss", role: "boss", template: BOSS_TEMPLATE }],
      scriptedAllies: BOSS_MINIONS,
    },
    blue: {
      heroes: [
        { id: "B-tank", role: "tank", template: TANK_TEMPLATE },
        { id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE },
        { id: "B-ranged", role: "ranged", template: RANGED_TEMPLATE },
      ],
      scriptedAllies: [],
    },
  };
  const result = await runMatch2(
    { name: `${boss.name}(boss)`, controllers: new Map([["R-boss", boss.boss]]) },
    {
      name: `${raid.name}(raid)`,
      controllers: new Map([["B-tank", raid.raid.tank], ["B-fighter", raid.raid.fighter], ["B-ranged", raid.raid.ranged]]),
    },
    config,
  );
  return { outcome: result.outcome, hpRed: result.hpFrac.red, hpBlue: result.hpFrac.blue };
}

const path = process.argv[2];
const progressPath = process.argv[3]; // optional: progress file written after each unit
if (!path) { console.error("usage: tournament2-worker.ts <units.json> [progress-file]"); process.exit(1); }
const units: Unit[] = JSON.parse(readFileSync(path, "utf-8"));
const results: UnitResult[] = [];

function reportProgress(done: number) {
  if (!progressPath) return;
  try {
    writeFileSync(progressPath + ".tmp", String(done));
    renameSync(progressPath + ".tmp", progressPath);
  } catch {}
}
reportProgress(0);

for (let unitIdx = 0; unitIdx < units.length; unitIdx++) {
  const u = units[unitIdx]!;
  if (u.kind === "solo") {
    const bestLevel = await runSoloUnit(u.agent, u.seed);
    results.push({ kind: "solo", agent: u.agent, seed: u.seed, bestLevel });
  } else if (u.kind === "squad") {
    const bestLevel = await runSquadUnit(u.agent, u.seed);
    results.push({ kind: "squad", agent: u.agent, seed: u.seed, bestLevel });
  } else if (u.kind === "skirmish") {
    const r = await runSkirmishUnit(u.redAgent, u.blueAgent, u.seed);
    results.push({ kind: "skirmish", redAgent: u.redAgent, blueAgent: u.blueAgent, seed: u.seed, ...r });
  } else if (u.kind === "boss") {
    const r = await runBossUnit(u.bossAgent, u.raidAgent, u.seed);
    results.push({ kind: "boss", bossAgent: u.bossAgent, raidAgent: u.raidAgent, seed: u.seed, ...r });
  }
  process.stderr.write(".");
  reportProgress(unitIdx + 1);
}

process.stdout.write(JSON.stringify(results));
