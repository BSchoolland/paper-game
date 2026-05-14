import type { MultiFormatAgent, ArenaConfig, MultiMatchResult } from "./types.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { runMatch2 } from "./match2.js";

export interface SkirmishTally {
  pts: number; w: number; d: number; l: number; hpMargin: number;
}

export async function runSkirmishChallenge(
  agents: MultiFormatAgent[],
  seeds: number[],
): Promise<Record<string, SkirmishTally>> {
  const tally: Record<string, SkirmishTally> = {};
  for (const a of agents) tally[a.name] = { pts: 0, w: 0, d: 0, l: 0, hpMargin: 0 };

  function makeHeroes(prefix: string) {
    return [
      { id: `${prefix}-tank`, role: "tank" as const, template: TANK_TEMPLATE },
      { id: `${prefix}-fighter`, role: "fighter" as const, template: FIGHTER_TEMPLATE },
      { id: `${prefix}-ranged`, role: "ranged" as const, template: RANGED_TEMPLATE },
    ];
  }

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const A = agents[i]!, B = agents[j]!;
      for (const seed of seeds) {
        for (const [redAgent, blueAgent] of [[A, B], [B, A]] as [MultiFormatAgent, MultiFormatAgent][]) {
          const config: ArenaConfig = {
            seed,
            red: { heroes: makeHeroes("R"), scriptedAllies: [] },
            blue: { heroes: makeHeroes("B"), scriptedAllies: [] },
          };

          const result = await runMatch2(
            {
              name: redAgent.name,
              controllers: new Map([
                ["R-tank", redAgent.squad.tank],
                ["R-fighter", redAgent.squad.fighter],
                ["R-ranged", redAgent.squad.ranged],
              ]),
            },
            {
              name: blueAgent.name,
              controllers: new Map([
                ["B-tank", blueAgent.squad.tank],
                ["B-fighter", blueAgent.squad.fighter],
                ["B-ranged", blueAgent.squad.ranged],
              ]),
            },
            config,
          );

          const redWon = result.outcome === "red";
          const blueWon = result.outcome === "blue";

          credit(tally[redAgent.name]!, result.hpFrac.red, result.hpFrac.blue, redWon ? "W" : blueWon ? "L" : "D");
          credit(tally[blueAgent.name]!, result.hpFrac.blue, result.hpFrac.red, blueWon ? "W" : redWon ? "L" : "D");
        }
      }
      process.stderr.write(`  skirmish: ${A.name} vs ${B.name} done\n`);
    }
  }
  return tally;
}

function credit(t: SkirmishTally, hpMine: number, hpTheirs: number, outcome: "W" | "D" | "L") {
  t.hpMargin += hpMine - hpTheirs;
  if (outcome === "W") { t.w++; t.pts += 3; }
  else if (outcome === "D") { t.d++; t.pts += 1; }
  else t.l++;
}
