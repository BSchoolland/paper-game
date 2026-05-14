import type { MultiFormatAgent, ArenaConfig } from "./types.js";
import { BOSS_TEMPLATE, TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { runMatch2 } from "./match2.js";

const BOSS_MINIONS: Array<{ key: string; count: number; dim: 0 }> = [
  { key: "goblin-spear", count: 1, dim: 0 },
  { key: "goblin-archer", count: 1, dim: 0 },
  { key: "goblin-shield", count: 1, dim: 0 },
  { key: "slime", count: 1, dim: 0 },
  { key: "big-slime", count: 1, dim: 0 },
];

export interface BossTally {
  pts: number; w: number; d: number; l: number; hpMargin: number;
}

export async function runBossChallenge(
  agents: MultiFormatAgent[],
  seeds: number[],
): Promise<Record<string, BossTally>> {
  const tally: Record<string, BossTally> = {};
  for (const a of agents) tally[a.name] = { pts: 0, w: 0, d: 0, l: 0, hpMargin: 0 };

  for (let i = 0; i < agents.length; i++) {
    for (let j = 0; j < agents.length; j++) {
      if (i === j) continue;
      const bossAgent = agents[i]!;
      const raidAgent = agents[j]!;

      for (const seed of seeds) {
        // Boss (red) vs Raid team (blue)
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
          {
            name: `${bossAgent.name}(boss)`,
            controllers: new Map([["R-boss", bossAgent.boss]]),
          },
          {
            name: `${raidAgent.name}(raid)`,
            controllers: new Map([
              ["B-tank", raidAgent.raid.tank],
              ["B-fighter", raidAgent.raid.fighter],
              ["B-ranged", raidAgent.raid.ranged],
            ]),
          },
          config,
        );

        const bossWon = result.outcome === "red";
        const raidWon = result.outcome === "blue";

        // Boss agent gets credit for the boss side
        credit(tally[bossAgent.name]!, result.hpFrac.red, result.hpFrac.blue, bossWon ? "W" : raidWon ? "L" : "D");
        // Raid agent gets credit for the raid side
        credit(tally[raidAgent.name]!, result.hpFrac.blue, result.hpFrac.red, raidWon ? "W" : bossWon ? "L" : "D");
      }
      process.stderr.write(`  boss: ${bossAgent.name}(boss) vs ${raidAgent.name}(raid) done\n`);
    }
  }
  return tally;
}

function credit(t: BossTally, hpMine: number, hpTheirs: number, outcome: "W" | "D" | "L") {
  t.hpMargin += hpMine - hpTheirs;
  if (outcome === "W") { t.w++; t.pts += 3; }
  else if (outcome === "D") { t.d++; t.pts += 1; }
  else t.l++;
}
