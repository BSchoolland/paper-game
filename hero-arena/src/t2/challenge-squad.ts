import type { MultiFormatAgent, ArenaConfig, EscalationResult } from "./types.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { LADDER } from "./enemy-ladder.js";
import { runMatch2 } from "./match2.js";

export async function runSquadChallenge(
  agent: MultiFormatAgent,
  seeds: number[],
): Promise<EscalationResult> {
  let bestLevel = 0;
  let totalTurns = 0;
  const log: string[] = [`=== Squad Challenge: ${agent.name} ===`];

  for (const seed of seeds) {
    log.push(`\n--- seed ${seed} ---`);
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
        blue: {
          heroes: [],
          scriptedAllies: tier.composition.map(c => ({ key: c.key, count: c.count, dim: c.dim })),
        },
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
      totalTurns += result.turns;

      if (result.outcome === "red") {
        seedLevel = tier.level;
        log.push(`  tier ${tier.level} (${tier.label}): CLEARED in ${result.turns}t, HP ${(result.hpFrac.red * 100).toFixed(0)}%`);
      } else {
        log.push(`  tier ${tier.level} (${tier.label}): FAILED at ${result.turns}t, HP ${(result.hpFrac.red * 100).toFixed(0)}%`);
        break;
      }
    }
    if (seedLevel > bestLevel) bestLevel = seedLevel;
    log.push(`  best this seed: tier ${seedLevel}`);
  }

  log.push(`\nSquad result: ${agent.name} — highest tier ${bestLevel}`);
  return { agentName: agent.name, highestLevelCleared: bestLevel, totalTurns, log };
}
