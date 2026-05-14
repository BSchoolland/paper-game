#!/usr/bin/env bun
/**
 * Run the Solo gauntlet for agent-02 and agent-04 using their FIGHTER configs
 * (not their dedicated solo configs). Side-by-side with the default solo() result.
 */
import { generateRandomLoadout } from "./loadouts.js";
import { LADDER } from "./enemy-ladder.js";
import { runMatch2 } from "./match2.js";
import type { ArenaConfig, MultiFormatAgent } from "./types.js";
import type { HeroController } from "../types.js";
import { agent as agent02 } from "../../agents/agent-02/index.js";
import { agent as agent04 } from "../../agents/agent-04/index.js";
import { makeSovereign, FIGHTER_WEIGHTS, DEFAULT_PARAMS } from "../../agents/agent-02/sovereign.js";
import { makeVanguard, FIGHTER_CONFIG } from "../../agents/agent-04/vanguard.js";

const SEEDS = [1, 7, 42];

async function runSolo(name: string, controllerFor: (abilities: ReturnType<typeof generateRandomLoadout>["abilities"]) => HeroController): Promise<number> {
  let bestLevel = 0;
  for (const seed of SEEDS) {
    const { template, abilities } = generateRandomLoadout(seed);
    const controller = controllerFor(abilities);
    let seedLevel = 0;
    for (const tier of LADDER) {
      const config: ArenaConfig = {
        seed,
        red:  { heroes: [{ id: "R-solo", role: "solo", template }], scriptedAllies: [] },
        blue: { heroes: [], scriptedAllies: tier.composition.map(c => ({ key: c.key, count: c.count, dim: c.dim })) },
      };
      const result = await runMatch2(
        { name, controllers: new Map([["R-solo", controller]]) },
        { name: `tier-${tier.level}`, controllers: new Map() },
        config,
        { maxTurns: tier.maxTurns },
      );
      if (result.outcome === "red") seedLevel = tier.level; else break;
    }
    console.log(`  ${name} seed ${seed}: tier ${seedLevel}`);
    if (seedLevel > bestLevel) bestLevel = seedLevel;
  }
  return bestLevel;
}

const fighter02: MultiFormatAgent["solo"] = () => makeSovereign(FIGHTER_WEIGHTS, DEFAULT_PARAMS);
const fighter04: MultiFormatAgent["solo"] = () => makeVanguard(FIGHTER_CONFIG);

console.log("=== agent-02 ===");
const a02_solo    = await runSolo("agent-02 (solo cfg)",    abilities => agent02.solo(abilities));
const a02_fighter = await runSolo("agent-02 (fighter cfg)", abilities => fighter02(abilities));
console.log(`  best:  solo cfg=${a02_solo}  fighter cfg=${a02_fighter}`);

console.log("\n=== agent-04 ===");
const a04_solo    = await runSolo("agent-04 (solo cfg)",    abilities => agent04.solo(abilities));
const a04_fighter = await runSolo("agent-04 (fighter cfg)", abilities => fighter04(abilities));
console.log(`  best:  solo cfg=${a04_solo}  fighter cfg=${a04_fighter}`);
