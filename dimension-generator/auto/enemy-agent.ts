import { client, SMART_MODEL, tool, hasToolCall, stepCountIs, z, createStepLog, appendStepLog, callWithRetry } from "./llm.js";
import type { DimensionSpec } from "./generate-spec.js";
import { join } from "node:path";
import { enemyTemplate, upsertEnemySchema } from "./schemas.js";
import type { EnemyTemplate } from "./schemas.js";
import { withEnemySprites } from "./enemy-sprites.js";

const ROOT = join(import.meta.dir, "..", "..");
const HERO_ARENA = join(ROOT, "hero-arena/src/t2");
const TAG = "[enemy-agent]";

function log(...args: unknown[]) { console.log(`  ${TAG}`, ...args); }

async function runBalanceTest(dimId: number, seeds: number = 3): Promise<string> {
  const nproc = navigator.hardwareConcurrency ?? 4;
  const cmd = `cd ${ROOT}/server && bun ${HERO_ARENA}/balance-test.ts ${dimId} --seeds ${seeds} --workers ${nproc}`;
  log(`Spawning: balance-test.ts dim=${dimId} seeds=${seeds} workers=${nproc}`);
  const t0 = Date.now();
  const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });

  // Stream stderr for progress
  const stderrReader = proc.stderr.getReader();
  let stderrBuf = "";
  (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const text = decoder.decode(value);
      stderrBuf += text;
      for (const line of text.split("\n").filter(l => l.trim())) {
        log(`  test: ${line.trim()}`);
      }
    }
  })();

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const reportPath = join(ROOT, `balance-report-dim-${dimId}.json`);
  try {
    const report = JSON.parse(await Bun.file(reportPath).text());
    const summary = report.summary;
    log(`Balance test done: ${report.totalGames} games in ${elapsed}s`);
    if (summary?.overall) {
      log(`  Expert solo: ${summary.overall.expertSoloWin}%  Dumb solo: ${summary.overall.dumbSoloWin}%  Skill gap: ${summary.overall.skillGap}`);
    }
    if (summary?.perEnemy) {
      for (const e of summary.perEnemy) {
        log(`  ${e.name}: expert=${e.expertSoloWin}% dumb=${e.dumbSoloWin}% gap=${e.skillGap} party-exp=${e.expertPartyWin}%`);
      }
    }
    return JSON.stringify({
      status: "ok",
      totalGames: report.totalGames,
      summary,
      enemies: report.enemies,
    }, null, 2);
  } catch {
    log(`Balance test FAILED after ${elapsed}s`);
    return JSON.stringify({ status: "error", stdout: stdout.slice(-2000), stderr: stderrBuf.slice(-2000) });
  }
}

async function runDrilldown(dimId: number, enemyKey: string): Promise<string> {
  log(`Drilldown: ${enemyKey}`);
  const logDir = join(ROOT, `balance-logs-dim-${dimId}`);
  const cmd = `cd ${ROOT}/server && bun ${HERO_ARENA}/balance-drill.ts ${logDir}/ 2>&1 | grep -A 30 "${enemyKey}" | head -80`;
  const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout || "(no matching logs found)";
}

export async function runEnemyAgent(dimId: number, spec: DimensionSpec, modelOverride?: string): Promise<Record<string, EnemyTemplate>> {
  const model = modelOverride ?? SMART_MODEL;
  const enemies: Record<string, EnemyTemplate> = {};
  let upsertCount = 0;
  let iterationCount = 0;

  const upsertEnemy = tool({
    name: "upsert_enemy",
    description: "Create or update an enemy template. Saves it to the game database immediately.",
    inputSchema: upsertEnemySchema,
    execute: async ({ id, template }) => {
      enemies[id] = template;
      const { saveEnemyTemplate, saveDimension } = await import("../../server/src/db.js");
      saveDimension(dimId, spec.name, [], undefined, undefined);
      saveEnemyTemplate(id, dimId, withEnemySprites(dimId, id, template) as any);
      upsertCount++;
      const abilityNames = template.abilities.filter(a => a.kind !== "move").map(a => a.name).join(", ");
      log(`Upserted [${upsertCount}]: ${id} (cost=${template.cost} hp=${template.hp} strategy=${template.strategy} abilities=[${abilityNames}])`);
      return { saved: id, hp: template.hp, cost: template.cost, abilities: template.abilities.length };
    },
  });

  const balanceTest = tool({
    name: "run_balance_test",
    description: "Run the full balance test suite for this dimension. Returns win rates, skill gaps, and per-enemy stats. Takes ~30-60s.",
    inputSchema: z.object({
      seeds: z.number().min(1).max(5).optional().describe("Number of seeds per scenario (default 3, max 5). More = more confident but slower."),
    }),
    execute: async ({ seeds }) => {
      const clamped = Math.min(Math.max(seeds ?? 3, 1), 5);
      iterationCount++;
      log(`=== Balance test iteration ${iterationCount} (seeds=${clamped}) ===`);
      return await runBalanceTest(dimId, clamped);
    },
  });

  const drilldown = tool({
    name: "drilldown",
    description: "Get detailed per-ability combat stats for a specific enemy from the last balance test. Use to understand WHY something is over/undertuned.",
    inputSchema: z.object({
      enemyKey: z.string().describe("Enemy key to drill into, e.g. 'sand-skitter'"),
    }),
    execute: async ({ enemyKey }) => {
      return await runDrilldown(dimId, enemyKey);
    },
  });

  const listEnemies = tool({
    name: "list_enemies",
    description: "List all enemies currently in the database for this dimension",
    inputSchema: z.object({}),
    execute: async () => {
      log(`Listing ${Object.keys(enemies).length} enemies`);
      return Object.entries(enemies).map(([id, t]) => ({
        id, hp: t.hp, cost: t.cost, strategy: t.strategy, tags: t.tags,
        abilities: t.abilities.map(a => a.kind === "move" ? `move(${a.distance})` : `${a.name} (${a.kind})`),
      }));
    },
  });

  const finish = tool({
    name: "finish",
    description: "Call when you are satisfied with the balance. Provide a brief summary of what you tuned.",
    inputSchema: z.object({ summary: z.string() }),
    execute: async ({ summary }) => {
      log(`FINISHED after ${iterationCount} test iterations: ${summary}`);
      return { done: true, summary };
    },
  });

  // Load reference data the skills point to
  const refReport = await Bun.file(join(ROOT, "balance-report-dim-0.json")).text().catch(() => "{}");
  const refSummary = JSON.parse(refReport).summary ?? {};

  const { loadEnemyTemplateRegistry } = await import("../../server/src/db.js");
  const refEnemies = loadEnemyTemplateRegistry(3);
  const refExamples = ["sand-skitter", "gilt-viper", "dune-reaver", "sunscorch-wyrm"]
    .filter(k => refEnemies[k])
    .map(k => `"${k}": ${JSON.stringify(refEnemies[k], null, 2)}`)
    .join(",\n\n");

  const specContext = spec.enemies;

  const logPath = createStepLog(dimId, "enemy-agent");
  log(`Starting enemy agent for dim ${dimId} "${spec.name}"`);
  log(`Model: ${model}`);
  log(`Log: ${logPath}`);
  const agentT0 = Date.now();

  await callWithRetry("enemy-agent", async () => {
  const result = client.callModel({
    model,
    instructions: [
      "You are a game balance designer. Your job is to create and balance enemies for a new dimension in a turn-based tactical combat game.",
      "",
      "DIMENSION SPEC:",
      `Name: ${spec.name}`,
      `Biome: ${spec.biome}`,
      `Mood: ${spec.mood}`,
      "",
      "ENEMY BATCHES FROM SPEC:",
      specContext,
      "",
      "REFERENCE ENEMY TEMPLATES (from dimension 3, \"The Gilt Barrens\" — copy this format):",
      refExamples,
      "",
      "REFERENCE — Dimension 0 balance summary (target these ranges):",
      JSON.stringify(refSummary, null, 2),
      "",
      "ENEMY DESIGN:",
      "Use /ability-balance skill principles for weapons (2+ abilities each, uncommon+ gets 3). Set heightMeters thematically: 1.0=tiny, 2.0=normal/player, 5.0=colossal.",
      "",
      "ABILITY DESIGN:",
      "To players, does this weapon feel full of depth or is it kind of a single strategy weapon? For each ability, think \"when will users have fun using this, and what is this ability for?\"",
      "All weapons should have at least 2 abilities. Uncommon and above (or any weapon that would genuinely benefit from a third tactical option) should have 3. Don't throw in a third ability if a weapon already feels great, but if there's a genuine gap in strategy, feel free to add in a third.",
      "",
      "FIXING BALANCE:",
      "Compare against the reference dimension (dim 0). Key cross-dimension metrics: cost-tier sovereign-solo averages, scenario aggregates, and skill gap (sovereign solo win% minus bad solo win% — higher = more skill-expressive).",
      "Always drill before changing. Use the drilldown tool to find the mechanical root cause.",
      "Prefer mechanical fixes (strategy, move speed, energy, shape size, cost tier) over raw stat bumps, though sometimes a pure stat change can be the right solution. Re-test after each round of changes.",
      "",
      "About the \"dumb\" baseline: this isn't a novice player. It's literally \"run in, never block, never dodge, attack the closest target.\" No real player will be this bad. So if dumb does well, that's a RED FLAG — it means the encounter is either too easy or requires no skill at all.",
      "If dumb players do better than they did in dim 0 and/or smart players do worse, that's a problem and will make the levels feel like they are arbitrary and don't reward skill. We want skill to matter a lot in this game, even more so for later levels (dim 0 is the starting world).",
      "",
      "Binary search: Change things more than you'd think you would need to to get a feel for how things work. Iteration 2 should be an overcorrection for learning purposes, then iteration 3 is where you really lock in what feels balanced.",
      "",
      "After finishing all changes, re-evaluate whether enemies should still look the same after these updates.",
      "",
      "WORKFLOW:",
      "0. Re-read each enemy description and think about which ability kinds (attack / barrier / zone) actually fit its role. A roster of 16 all-attack enemies tends to feel flat — barrier and zone exist precisely because some designs need defense or persistent area effects rather than just another swing.",
      "1. Create ALL 16 enemies using upsert_enemy (4 batches x 4 enemies).",
      "2. Run run_balance_test to see how they perform.",
      "3. Always drill before changing. Use drilldown on problematic enemies.",
      "4. Make changes with upsert_enemy and re-test.",
      "5. Call finish when satisfied.",
      "",
      "IMPORTANT: ability IDs must be globally unique kebab-case strings.",
      "IMPORTANT: first ability in every enemy MUST be a move ability.",
      "IMPORTANT: onDeath spawn templateKeys must reference other enemies you've created in this dimension.",
    ].join("\n"),
    input: `Create and balance all 16 enemies for dimension ${dimId} ("${spec.name}"). Start by creating them all, then test and iterate.`,
    tools: [upsertEnemy, balanceTest, drilldown, listEnemies, finish],
    stopWhen: [hasToolCall("finish"), stepCountIs(30)],
  });

  // Stream all messages to log file
  const msgPromise = (async () => {
    for await (const msg of result.getNewMessagesStream()) {
      appendStepLog(logPath, msg);
    }
  })();

  // Stream LLM text in real time
  const textPromise = (async () => {
    for await (const delta of result.getTextStream()) {
      process.stdout.write(delta);
    }
  })();

  // Also consume tool calls (mainly for awaiting completion)
  for await (const _tc of result.getToolCallsStream()) {
    // logging happens inside tool execute functions
  }

  await textPromise;
  await msgPromise;
  });

  const elapsed = ((Date.now() - agentT0) / 1000).toFixed(1);
  log(`Enemy agent completed in ${elapsed}s — ${Object.keys(enemies).length} enemies, ${iterationCount} test iterations`);
  return enemies;
}
