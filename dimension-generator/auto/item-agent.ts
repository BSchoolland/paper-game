import { client, SMART_MODEL, tool, hasToolCall, stepCountIs, z, createStepLog, appendStepLog, callWithRetry } from "./llm.js";
import { weaponItemSchema } from "./schemas.js";
import type { WeaponItem } from "./schemas.js";
import type { DimensionSpec } from "./generate-spec.js";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const HERO_ARENA = join(ROOT, "hero-arena/src/t2");
const TAG = "[item-agent]";

function log(...args: unknown[]) { console.log(`  ${TAG}`, ...args); }

async function runItemTest(dimId: number, seeds: number = 3): Promise<string> {
  const nproc = navigator.hardwareConcurrency ?? 4;
  const cmd = `cd ${ROOT}/server && bun ${HERO_ARENA}/item-test.ts ${dimId} --seeds ${seeds} --workers ${nproc}`;
  log(`Spawning: item-test.ts dim=${dimId} seeds=${seeds} workers=${nproc}`);
  const t0 = Date.now();
  const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });

  const stderrReader = proc.stderr.getReader();
  (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n").filter(l => l.trim())) {
        log(`  test: ${line.trim()}`);
      }
    }
  })();

  const stdout = await new Response(proc.stdout).text();
  const stderr = "";
  await proc.exited;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const reportPath = join(ROOT, `item-report-dim-${dimId}.json`);
  try {
    const report = JSON.parse(await Bun.file(reportPath).text());
    log(`Item test done: ${Object.keys(report.items).length} items tested in ${elapsed}s`);
    return JSON.stringify({ status: "ok", itemCount: Object.keys(report.items).length, results: report.results }, null, 2);
  } catch {
    log(`Item test FAILED after ${elapsed}s`);
    return JSON.stringify({ status: "error", stdout: stdout.slice(-2000), stderr });
  }
}

async function runItemRank(dimId: number): Promise<string> {
  log("Running item rank...");
  const reportPath = join(ROOT, `item-report-dim-${dimId}.json`);
  const cmd = `cd ${ROOT}/server && bun ${HERO_ARENA}/item-rank.ts ${reportPath} 2>&1`;
  const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  log("Item rank complete.");
  return stdout || "(no output)";
}

export async function runItemAgent(dimId: number, spec: DimensionSpec): Promise<Record<string, WeaponItem>> {
  const items: Record<string, WeaponItem> = {};
  let upsertCount = 0;
  let iterationCount = 0;

  const prefix = `d${dimId}-`;
  const prefixId = (id: string) => id.startsWith(prefix) ? id : `${prefix}${id}`;

  const upsertItem = tool({
    name: "upsert_item",
    description: "Create or update a weapon item. Saves it to the game database immediately.",
    inputSchema: weaponItemSchema,
    execute: async (weapon) => {
      // Auto-prefix item and ability IDs with d{dimId}- to prevent cross-dimension collisions
      const namespacedId = prefixId(weapon.id);
      const namespacedAbilities = weapon.abilities.map(a => ({ ...a, id: prefixId(a.id) }));
      const namespaced = { ...weapon, id: namespacedId, sprite: weapon.id, abilities: namespacedAbilities };

      items[namespacedId] = namespaced;
      const { saveItems } = await import("../../server/src/db.js");
      const itemDef = { ...namespaced, type: "weapon" as const };
      saveItems(dimId, { [namespacedId]: itemDef as any });
      upsertCount++;
      const abilityNames = namespaced.abilities.map(a => a.name).join(", ");
      log(`Upserted [${upsertCount}]: ${namespacedId} (${weapon.rarity}, ${weapon.animSet}, hand=${weapon.slotCost.hand}, abilities=[${abilityNames}])`);
      return { saved: namespacedId, rarity: weapon.rarity, abilities: namespaced.abilities.length };
    },
  });

  const itemTest = tool({
    name: "run_item_test",
    description: "Run item balance tests — equips each weapon on a baseline hero and fights dim-0 enemies. Returns win rates per item.",
    inputSchema: z.object({
      seeds: z.number().min(1).max(5).optional().describe("Number of seeds per scenario (default 3, max 5)."),
    }),
    execute: async ({ seeds }) => {
      const clamped = Math.min(Math.max(seeds ?? 3, 1), 5);
      iterationCount++;
      log(`=== Item test iteration ${iterationCount} (seeds=${clamped}) ===`);
      return await runItemTest(dimId, clamped);
    },
  });

  const itemRank = tool({
    name: "run_item_rank",
    description: "Rank all items and flag outliers (worse-than-baseline, rarity inversions). Run after item_test.",
    inputSchema: z.object({}),
    execute: async () => {
      return await runItemRank(dimId);
    },
  });

  const listItems = tool({
    name: "list_items",
    description: "List all weapon items currently in the database for this dimension",
    inputSchema: z.object({}),
    execute: async () => {
      log(`Listing ${Object.keys(items).length} items`);
      return Object.entries(items).map(([id, w]) => ({
        id, name: w.name, rarity: w.rarity, animSet: w.animSet, slotCost: w.slotCost,
        abilities: w.abilities.map(a => `${a.name}: dmg=${a.damage}, shape=${a.shape.kind}`),
      }));
    },
  });

  const finish = tool({
    name: "finish",
    description: "Call when satisfied with item balance. Provide a brief summary.",
    inputSchema: z.object({ summary: z.string() }),
    execute: async ({ summary }) => {
      log(`FINISHED after ${iterationCount} test iterations: ${summary}`);
      return { done: true, summary };
    },
  });

  // Load reference data the skills point to
  const { loadItems: loadDbItems } = await import("../../server/src/db.js");
  const refItems = loadDbItems(3);
  const refExamples = ["scorpion-spear", "raiders-twinblade", "pharaohs-crescent"]
    .filter(k => refItems[k])
    .map(k => `"${k}": ${JSON.stringify(refItems[k], null, 2)}`)
    .join(",\n\n");

  const weaponSpecs = spec.items;

  const logPath = createStepLog(dimId, "item-agent");
  log(`Starting item agent for dim ${dimId} "${spec.name}"`);
  log(`Model: ${SMART_MODEL}`);
  log(`Log: ${logPath}`);
  const agentT0 = Date.now();

  await callWithRetry("item-agent", async () => {
  const result = client.callModel({
    model: SMART_MODEL,
    instructions: [
      "You are a game balance designer. Your job is to create and balance WEAPON items for a new dimension.",
      "",
      "DIMENSION:",
      `Name: ${spec.name}`,
      `Biome: ${spec.biome}`,
      "",
      "WEAPON SPECS FROM THE DIMENSION DESIGN:",
      weaponSpecs,
      "",
      "REFERENCE WEAPON DEFINITIONS (from dimension 3, \"The Gilt Barrens\" — copy this format):",
      refExamples,
      "",
      "ABILITY DESIGN:",
      "To players, does this weapon feel full of depth or is it kind of a single strategy weapon? For each ability, think \"when will users have fun using this, and what is this ability for?\"",
      "All weapons should have at least 2 abilities. Uncommon and above (or any weapon that would genuinely benefit from a third tactical option) should have 3. Don't throw in a third ability if a weapon already feels great, but if there's a genuine gap in strategy, feel free to add in a third.",
      "",
      "FIXING BALANCE:",
      "Note that the item baseline is not barehanded, it gives the player essentially a simple starter kit. Being worse than it is bad, but not the end of the world.",
      "Prefer mechanical fixes (strategy, move speed, energy, shape size, cost tier) over raw stat bumps, though sometimes a pure stat change can be the right solution. Re-test after each round of changes.",
      "Binary search: Change things more than you'd think you would need to to get a feel for how things work. Iteration 2 should be an overcorrection for learning purposes, then iteration 3 is where you really lock in what feels balanced.",
      "",
      "WORKFLOW:",
      "1. Create all weapons using upsert_item. Only create WEAPONS (shields/accessories/consumables are not yet supported by the item system; skip them).",
      "2. Run run_item_test to see how they perform against dim-0 enemies.",
      "3. Run run_item_rank to see rankings and outliers (worse-than-baseline, rarity inversions, punch fallbacks).",
      "4. Always drill before changing — understand WHY before fixing.",
      "5. Make changes with upsert_item and re-test.",
      "6. Call finish when satisfied.",
      "",
      `dimensionId for all items: ${dimId}`,
      "",
      "IMPORTANT: ability IDs must be globally unique kebab-case strings (prefix with weapon id).",
    ].join("\n"),
    input: `Create and balance all weapons for dimension ${dimId} ("${spec.name}"). Start by creating them, then test and iterate.`,
    tools: [upsertItem, itemTest, itemRank, listItems, finish],
    stopWhen: [hasToolCall("finish"), stepCountIs(25)],
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

  for await (const _tc of result.getToolCallsStream()) {
    // logging happens inside tool execute functions
  }

  await textPromise;
  await msgPromise;
  });

  const elapsed = ((Date.now() - agentT0) / 1000).toFixed(1);
  log(`Item agent completed in ${elapsed}s — ${Object.keys(items).length} items, ${iterationCount} test iterations`);
  return items;
}
