import type { MultiFormatAgent, ArenaConfig, EscalationResult } from "./types.js";
import { generateRandomLoadout } from "./loadouts.js";
import { LADDER } from "./enemy-ladder.js";
import { runMatch2 } from "./match2.js";

export async function runSoloChallenge(
  agent: MultiFormatAgent,
  seeds: number[],
): Promise<EscalationResult> {
  let bestLevel = 0;
  let totalTurns = 0;
  const log: string[] = [`=== Solo Challenge: ${agent.name} ===`];

  for (const seed of seeds) {
    const { template, abilities } = generateRandomLoadout(seed);
    const controller = agent.solo(abilities);
    const abilityNames = abilities.filter(a => a.kind === "attack").map(a => a.name).join(", ");
    log.push(`\n--- seed ${seed}: ${abilityNames} ---`);

    let seedLevel = 0;
    for (const tier of LADDER) {
      const config: ArenaConfig = {
        seed,
        red: {
          heroes: [{ id: "R-solo", role: "solo", template }],
          scriptedAllies: [],
        },
        blue: {
          heroes: [],
          scriptedAllies: tier.composition.map(c => ({ key: c.key, count: c.count, dim: c.dim })),
        },
      };

      const result = await runMatch2(
        { name: agent.name, controllers: new Map([["R-solo", controller]]) },
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

  log.push(`\nSolo result: ${agent.name} — highest tier ${bestLevel}`);
  return { agentName: agent.name, highestLevelCleared: bestLevel, totalTurns, log };
}
