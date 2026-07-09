export const meta = {
  name: "generate-and-stage-fable",
  description:
    "Generate a complete v2 dimension (spec -> art -> balanced enemies & items -> baked image maps -> overworld art -> QA) and flip it to in_review. v2-only: every encounter renders from a generated map image (coverage is asserted), so no runtime structures are registered. Opus does all design reasoning; thin Haiku shims run the deterministic generator scripts; gpt-image-2 makes the art.",
  phases: [
    { title: "Spec" },
    { title: "Generate" },
    { title: "Overworld" },
    { title: "QA" },
    { title: "Stage" },
  ],
};

// --- args (the harness may deliver `args` as a JSON string or an object) ---
const input = typeof args === "string" ? JSON.parse(args) : (args ?? {});
const dimId = input.dimId ?? 600;
const dbPath = input.dbPath;
const seed = input.seed;
if (!seed) {
  throw new Error(
    "seed is REQUIRED: a short world-concept description to build the dimension from.",
  );
}
if (!dbPath) {
  throw new Error(
    "dbPath is REQUIRED (absolute path). Generator and server must share ONE db; pass it explicitly.",
  );
}
if (!dbPath.startsWith("/")) {
  throw new Error(`dbPath must be an absolute path, got: ${dbPath}`);
}

// --- paths ---
const ROOT = "/home/ben/Projects/turn-based-game";
const GEN = `${ROOT}/dimension-generator`;
const AUTO = `${GEN}/auto`;
const T2 = `${ROOT}/hero-arena/src/t2`;
const DB_TS = `${ROOT}/server/src/db.ts`;
const ENV = `GAME_DB_PATH=${dbPath}`;
const specPath = `${GEN}/dimension-${dimId}-spec.json`;

// Same slugify used by build-diffusion-bundles.ts and art-agent.ts.
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ---------------------------------------------------------------------------
// Shared design voice — copied verbatim from generate-spec.ts so the workflow
// produces specs in the same grounded register as the original pipeline.
// ---------------------------------------------------------------------------
const VOICE_GUIDE = `
THE GAME'S VOICE — read carefully and follow strictly:

Name things like a tabletop GM running a fast session, not an MMO marketing department.
Names label the thing — they don't advertise it.

REFERENCE (dimension 0 "Greenlands" — this is the gold standard):
  Enemies: Goblin Spear, Goblin Archer, Goblin Shield, Goblin Brute, Stone Golem,
           Slime, Big Slime, Massive Slime
  Items:   Short Sword, Long Sword, Spear, Axe, Bow, Broadsword, Battle Axe, Mace,
           Round Shield, Kite Shield, Buckler, Quiver, Staff, Spellbook,
           Health Potion, Bomb
  Abilities: Slash, Stab, Thrust, Shaft Strike, Shot, Volley, Wall Slam,
             Lunge Strike, Half-sword, Cross-cut, Chop, Hack, Sweep,
             Pommel Strike, Cleave, Hook, Rend, Crush, Shield Bash,
             Arcane Blast, Arcane Bolt

RULES:
- One or two word names. Three only if absolutely necessary.
- [creature] [role] or [verb] [noun]. Never "Noun of Noun" constructions.
- No "The ___" proper-noun constructions ("The Caravan King" -> "Caravan Captain").
- Variants scale by plain size: Slime -> Big Slime -> Massive Slime.
  Never Lesser / Greater / Apex / Elder / Primordial.
- Recognizable archetypes presented straight. A child should know what most things are.
- Concrete physical things you could point at — bodies, materials, behaviors, sounds.
  Not concepts or feelings.
- Real-world / D&D-baseline vocabulary. Goblin, slime, golem, axe, spear, potion.
  Not motes, sigils, wardens, arbiters, sovereigns, wisps, veils, lexicons.
- Ability names: short verb-noun. Slash, Stab, Spear Thrust, Shield Bash.
  Never "Reaping Arc" or "Crescent Strike of the Sun."
- Descriptions: one short sentence, ~10 words. What it is + what it does.
  No history, no atmosphere, no character.

BANNED DESCRIPTORS: Ancient, Primordial, Eternal, Sanguine, Resplendent, Verdant,
                    Eldritch, Crystalline (unless literally crystal), Lexical.
BANNED SUFFIXES:    -touched, -bound, -spawn, -forged.
BANNED CONCEPTS:    Anything that sounds like a band name. Anything that requires
                    a paragraph of lore to understand. Anything where the name
                    is the FEELING rather than the THING.
`.trim();

// ---------------------------------------------------------------------------
// Phase 1 — SPEC
// ---------------------------------------------------------------------------
phase("Spec");

// 1a. Opus spec agent: runs its own setup (seed refs, list dims, pick nouns) via Bash,
//     then draft -> self-critique -> revise, and returns the full structured spec.
const spec = await agent(
  [
    "You are a game designer building out a given world concept into a full dimension for a turn-based tactical combat game, AND your own toughest critic. You have a Bash terminal. Run the SETUP command, then do the full draft -> critique -> revise loop in one pass, and output only the final revised spec.",
    "",
    "SETUP — run this command first; fail loud if it errors, and do not invent its output:",
    `     cd ${ROOT}/server && ${ENV} bun -e 'import { seedDiscovery } from "./src/db.ts"; import { seedDimension0 } from "./src/seed.ts"; import { seedDimension1 } from "./src/seed-dimension-1.ts"; import { seedDimension2 } from "./src/seed-dimension-2.ts"; import { seedDimension3 } from "./src/seed-dimension-3.ts"; seedDiscovery(0, 15); seedDimension0(); seedDimension1(); seedDimension2(); seedDimension3(); console.log("seeded");'`,
    "",
    "WORLD CONCEPT — build the dimension faithfully from this; stay true to it, fill in the details it leaves open:",
    seed,
    "",
    "The enemies are the threat and they come from this world's concept; the land is an interesting place to fight, not the thing killing the player.",
    "",
    VOICE_GUIDE,
    "",
    "SELF-CRITIQUE PASS (do this before finalizing):",
    "Go through every enemy name and item name. For each, decide if it fits the voice or if it's slop.",
    "Be concrete. Fix the worst offenders with grounded replacements. Keep what already reads like the dim-0 gold standard.",
    "",
    "OUTPUT REQUIREMENTS:",
    `- id MUST be ${dimId}.`,
    `- droppedNoun and negatedNoun: set both to "" (unused).`,
    "- enemyBatches: an array of EXACTLY 4 batches, in order FODDER, STANDARD, ELITE, BOSS. Each batch is { name: the tier word, description: a short cost note (e.g. 'cost 1-2, swarms'), enemies: an array of EXACTLY 4 enemies }. Each enemy is { name, role: a 1-line mechanical role, description: a brief visual description (~1 sentence) }. 16 enemies total. Example enemy: { \"name\": \"Spear Runner\", \"role\": \"fast melee that runs in packs and closes distance\", \"description\": \"A wiry desert nomad with a crude spear.\" }",
    "- items: an array of EXACTLY 16 WEAPONS (no shields/accessories/consumables — the item system only supports weapons). Each item is { name, type: one of sword/spear/bow/staff/two-handed, rarity: common/uncommon/rare, description: brief (~1 sentence) }. Spread the types and rarities. Example: { \"name\": \"Spear\", \"type\": \"spear\", \"rarity\": \"common\", \"description\": \"A long polearm with superior reach.\" }",
    "- palette: three hex colors (primary, secondary, accent).",
    "- description: 2-3 sentences at the scale of a whole planet.",
    "- mood: 1-2 sentences. biome: a short tag, e.g. 'scrub flatlands pocked with meteor craters'.",
    "",
    "Output the final spec object only.",
  ].join("\n"),
  {
    label: "spec-design",
    phase: "Spec",
    model: "fable",
    schema: {
      type: "object",
      required: [
        "id", "name", "description", "palette", "mood", "biome",
        "droppedNoun", "negatedNoun", "enemyBatches", "items",
      ],
      additionalProperties: false,
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        description: { type: "string" },
        palette: {
          type: "object",
          required: ["primary", "secondary", "accent"],
          additionalProperties: false,
          properties: {
            primary: { type: "string" },
            secondary: { type: "string" },
            accent: { type: "string" },
          },
        },
        mood: { type: "string" },
        biome: { type: "string" },
        droppedNoun: { type: "string" },
        negatedNoun: { type: "string" },
        enemyBatches: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            required: ["name", "description", "enemies"],
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              enemies: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: {
                  type: "object",
                  required: ["name", "role", "description"],
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    role: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
        },
        items: {
          type: "array",
          minItems: 16,
          maxItems: 16,
          items: {
            type: "object",
            required: ["name", "type", "rarity", "description"],
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              rarity: { type: "string" },
              description: { type: "string" },
            },
          },
        },
      },
    },
  },
);
spec.id = dimId;
// Flatten the structured roster into readable text for the design-agent prompts below (the prompts
// want guidance, not JSON; build-diffusion-bundles + art-agent consume the structured arrays directly).
const enemyRoster = spec.enemyBatches
  .map((b) => `${b.name} (${b.description}):\n` + b.enemies.map((e) => `- ${e.name} — ${e.role}. ${e.description}`).join("\n"))
  .join("\n\n");
const itemRoster = spec.items.map((i) => `- ${i.name} (${i.type}, ${i.rarity}) — ${i.description}`).join("\n");
const dimName = spec.name;
const slug = slugify(dimName);
const bundlesRoot = `${GEN}/diffusion-bundles/${slug}`;
log(`Spec: "${dimName}" (slug=${slug}, biome=${spec.biome})`);

// 1c. Haiku shim: persist the spec, create the dimension shell row, build bundles.
const specJson = JSON.stringify(spec, null, 2);
await agent(
  [
    "You are a deterministic shim. Write the file exactly, run the two commands, report what happened. Do not change the spec content.",
    "",
    `STEP 1 — Write the following JSON VERBATIM (byte-for-byte, no edits) to ${specPath}:`,
    "",
    specJson,
    "",
    `STEP 2 — Create the dimension shell row so later steps can find it. Run:`,
    `  cd ${ROOT}/server && ${ENV} bun -e 'import { saveDimension } from "./src/db.ts"; saveDimension(${dimId}, ${JSON.stringify(dimName)}, []); console.log("shell saved");'`,
    "",
    `STEP 3 — Build the diffusion bundles from the spec. Run:`,
    `  ${ENV} bun ${GEN}/build-diffusion-bundles.ts ${specPath}`,
    "",
    `Confirm the bundle directory ${bundlesRoot} now exists and list its bundle subdirectories. Fail loud on any error.`,
  ].join("\n"),
  { label: "write-spec-and-build-bundles", phase: "Spec", model: "haiku" },
);

// ---------------------------------------------------------------------------
// Phases 2-4 — ART, ENEMIES + ITEMS, and MAPS all run CONCURRENTLY. Every one of them depends only on
// the spec (Phase 1), never on each other, so they share a single parallel() barrier. The two Opus
// balance loops are the long pole (~20 min); art and maps (gpt-image-2, fast) finish well inside that,
// so all image generation is effectively free wall-clock. Overworld/QA (which need the art + maps) come
// after the barrier.
// ---------------------------------------------------------------------------
phase("Generate");

const artPrompt = [
  "You are a deterministic shim around the art generator. It generates one sprite sheet per diffusion bundle via gpt-image-2 and runs the python sprite-extraction scripts.",
  "",
  `IMPORTANT: the generator's .env (OPENAI_API_KEY for gpt-image-2) is loaded from ${GEN}, so the command below cd's there first. Running from anywhere else fails with "Missing credentials".`,
  "",
  "Run this command in the FOREGROUND (it takes a few minutes; set the Bash tool's timeout to 600000 ms so it isn't cut off). Do NOT background it.",
  "",
  `  cd ${GEN} && ${ENV} bun ${AUTO}/art-agent.ts ${slug}`,
  "",
  `On success the sprites are extracted to server/sprites/enemies/dimension-${dimId}/, public/sprites/items/dimension-${dimId}/, public/sprites/map-objects/dimension-${dimId}/, and public/sprites/map-decorations/dimension-${dimId}/.`,
  "",
  "Return a one-paragraph summary of which bundles were generated and which sprite directories were written. Fail loud if the command errors or no images are produced.",
].join("\n");

const enemyPrompt = [
  "You are a game balance designer. Your job is to create and balance all 16 enemies for a new dimension in a turn-based tactical combat game, iterating against an automated balance test until they feel right. You have a Bash terminal; the generator scripts are your tools.",
  "",
  "DIMENSION SPEC:",
  `Name: ${dimName}`,
  `Biome: ${spec.biome}`,
  `Mood: ${spec.mood}`,
  "",
  "ENEMY BATCHES FROM SPEC:",
  enemyRoster,
  "",
  "REFERENCE DATA TO LOAD FIRST (run these before designing):",
  `  - Enemy template format (copy this shape exactly): dump dimension 3's reference enemies with:`,
  `      cd ${ROOT}/server && ${ENV} bun -e 'import { loadEnemyTemplateRegistry } from "./src/db.ts"; const r = loadEnemyTemplateRegistry(3); for (const k of ["sand-skitter","gilt-viper","dune-reaver","sunscorch-wyrm"]) if (r[k]) console.log(k, JSON.stringify(r[k], null, 2));'`,
  `  - The authoritative zod schema your JSON must satisfy: read ${AUTO}/schemas.ts (enemyTemplate).`,
  `  - The dim-0 balance baseline to target: read the "summary" of ${ROOT}/balance-report-dim-0.json (this is the gold-standard range to match).`,
  "",
  "ENEMY DESIGN:",
  "Use ability-balance principles for weapons (2+ abilities each, uncommon+ gets 3). Set heightMeters thematically: 1.0=tiny, 2.0=normal/player, 5.0=colossal.",
  "Re-read each enemy description and think about which ability kinds (attack / barrier / zone) actually fit its role. A roster of 16 all-attack enemies feels flat — barrier and zone exist precisely because some designs need defense or persistent area effects.",
  "",
  "ABILITY DESIGN:",
  'To players, does this weapon feel full of depth or is it a single-strategy weapon? For each ability ask "when will users have fun using this, and what is this ability for?"',
  "All enemies have at least 2 abilities. Uncommon and above (or any design with a genuine tactical gap) get 3. Don't add a third ability if the design already feels great.",
  "",
  "FIXING BALANCE:",
  "Compare against the reference dimension (dim 0). Key metrics: cost-tier expert-solo averages, scenario aggregates, and skill gap (expert solo win% minus dumb solo win% — higher = more skill-expressive).",
  "Always drill before changing — find the mechanical root cause. Prefer mechanical fixes (strategy, move speed, energy, shape size, cost tier) over raw stat bumps, though a pure stat change is sometimes right. Re-test after each round.",
  'About the "dumb" baseline: it is not a novice — it is literally "run in, never block, never dodge, attack the closest target." No real player is this bad. If dumb does well, that is a RED FLAG: the encounter is too easy or requires no skill.',
  "If dumb players do better than in dim 0 and/or smart players do worse, that is a problem — levels will feel arbitrary and unrewarding. Skill must matter, even more so for later levels (dim 0 is the starting world).",
  "Binary search: change things more than you'd think to get a feel for the system. Make iteration 2 a deliberate overcorrection for learning, then lock it in on iteration 3.",
  "After finishing, re-evaluate whether the enemies should still look the same after these mechanical updates.",
  "",
  "HOW TO USE THE SCRIPTS (every command MUST be prefixed with the env var below so it writes the shared db):",
  `  ENV PREFIX: ${ENV}`,
  "  1. Create/update one enemy — write its JSON to a temp file (avoids shell-quoting issues with apostrophes), then:",
  `       ${ENV} bun ${AUTO}/cli/upsert-enemy.ts ${dimId} <enemyId> < /path/to/enemy.json`,
  `     (equivalently: echo '<json>' | ${ENV} bun ${AUTO}/cli/upsert-enemy.ts ${dimId} <enemyId>)`,
  "  2. Run the full balance test (writes balance-report-dim-" + dimId + ".json + per-game logs):",
  `       cd ${ROOT}/server && ${ENV} bun ${T2}/balance-test.ts ${dimId} --seeds 3 --workers $(nproc)`,
  `     Then read the report: ${ROOT}/balance-report-dim-${dimId}.json (inspect summary.overall and summary.perEnemy).`,
  "  3. Drill into a problematic enemy to find the mechanical cause:",
  `       cd ${ROOT}/server && ${ENV} bun ${T2}/balance-drill.ts ${ROOT}/balance-logs-dim-${dimId}/ 2>&1 | grep -A 30 "<enemyKey>" | head -80`,
  "",
  "IMPORTANT:",
  "  - ability IDs must be globally unique kebab-case strings.",
  "  - the FIRST ability in every enemy MUST be a move ability.",
  "  - onDeath spawn templateKeys must reference other enemies you created in THIS dimension.",
  "",
  "WORKFLOW:",
  `  1. Load the reference data above. 2. Create ALL 16 enemies (4 tiers x 4) with upsert-enemy. 3. Run the balance test. 4. Drill the problem enemies. 5. Fix with upsert-enemy and re-test. Repeat until the summary sits in the dim-0 band with a healthy skill gap and no runaway dumb-win rates. Aim for ~3 test iterations.`,
  "",
  "When done, return a brief summary of the final roster (the 16 enemy ids by tier) and what you tuned and why.",
].join("\n");

const itemPrompt = [
  "You are a game balance designer. Your job is to create and balance all the WEAPON items for a new dimension, iterating against an automated item test until they feel right. You have a Bash terminal; the generator scripts are your tools.",
  "",
  "DIMENSION:",
  `Name: ${dimName}`,
  `Biome: ${spec.biome}`,
  "",
  "WEAPON SPECS FROM THE DIMENSION DESIGN:",
  itemRoster,
  "",
  "REFERENCE DATA TO LOAD FIRST (run these before designing):",
  `  - Weapon definition format (copy this shape exactly): dump dimension 3's reference items with:`,
  `      cd ${ROOT}/server && ${ENV} bun -e 'import { loadItems } from "./src/db.ts"; const r = loadItems(3); for (const k of ["scorpion-spear","raiders-twinblade","pharaohs-crescent"]) if (r[k]) console.log(k, JSON.stringify(r[k], null, 2));'`,
  `  - The authoritative zod schema your JSON must satisfy: read ${AUTO}/schemas.ts (weaponItemSchema).`,
  "",
  "ABILITY DESIGN:",
  'To players, does this weapon feel full of depth or a single-strategy weapon? For each ability ask "when will users have fun using this, and what is this ability for?"',
  "All weapons have at least 2 abilities. Uncommon and above (or any weapon with a genuine tactical gap) get 3. Don't add a third if the weapon already feels great.",
  "",
  "FIXING BALANCE:",
  "The item baseline is not barehanded — it is a simple starter kit. Being worse than it is bad but not catastrophic.",
  "Prefer mechanical fixes (strategy, move speed, energy, shape size, cost tier) over raw stat bumps, though a pure stat change is sometimes right. Re-test after each round.",
  "Binary search: change things more than you'd think to get a feel; make iteration 2 a deliberate overcorrection, then lock it in on iteration 3. Always understand WHY before fixing.",
  "",
  "HOW TO USE THE SCRIPTS (every command MUST be prefixed with the env var below so it writes the shared db):",
  `  ENV PREFIX: ${ENV}`,
  `  CRITICAL: every item id AND every ability id MUST be prefixed with "d${dimId}-" (e.g. d${dimId}-dune-cleaver) — upsert-item rejects unprefixed ids to prevent cross-dimension collisions.`,
  "  1. Create/update one weapon — write its JSON to a temp file, then:",
  `       ${ENV} bun ${AUTO}/cli/upsert-item.ts ${dimId} d${dimId}-<name> < /path/to/item.json`,
  "     Only create WEAPONS (shields/accessories/consumables are not supported by the item system — skip them).",
  "  2. Run the item balance test (equips each weapon on a baseline hero vs dim-0 enemies; writes item-report-dim-" + dimId + ".json):",
  `       cd ${ROOT}/server && ${ENV} bun ${T2}/item-test.ts ${dimId} --seeds 3 --workers $(nproc)`,
  "  3. Rank items and flag outliers (worse-than-baseline, rarity inversions):",
  `       cd ${ROOT}/server && ${ENV} bun ${T2}/item-rank.ts ${ROOT}/item-report-dim-${dimId}.json`,
  "",
  "IMPORTANT: ability IDs must be globally unique kebab-case strings (prefix with the d" + dimId + "- item id).",
  "",
  "WORKFLOW:",
  "  1. Load the reference data above. 2. Create all weapons with upsert-item. 3. Run item-test. 4. Run item-rank to see rankings and outliers. 5. Understand the cause, fix with upsert-item, re-test. Repeat until rankings track rarity with no worse-than-baseline weapons. Aim for ~3 test iterations.",
  "",
  "When done, return a brief summary of the final weapon ids (all d" + dimId + "- prefixed) and what you tuned and why.",
].join("\n");

// All four jobs depend only on the spec, so they share ONE barrier. The two Opus balance loops are the
// long pole (~20 min); gpt-image-2 art and maps finish well inside that window, so image generation is
// effectively free wall-clock. Overworld/QA (which need art + maps) come after this barrier.
const mapsPrompt = [
  "You are a deterministic shim around the map generator. Run three commands in order (all FOREGROUND; set the Bash tool's timeout to 600000 ms), then report. Do not design anything.",
  "",
  `IMPORTANT: the generator's .env (OpenRouter + OpenAI keys for the rewrite and collision passes) is loaded from ${GEN}, so every command below cd's there first.`,
  "",
  "STEP 1 — Generate the dimension reference + encounter maps + collision masks (gpt-image-2 for the maps, OpenAI for collision; takes a few minutes):",
  `  cd ${GEN} && ${ENV} bun ${AUTO}/map-agent.ts --new ${dimId} ${JSON.stringify(dimName)} ${JSON.stringify(spec.description)}`,
  `  It writes maps + manifest.json + collision masks to public/sprites/maps/dimension-${dimId}/.`,
  "",
  "STEP 2 — Assert full coverage. v2 dimensions have no structure fallback, so every encounter type MUST have a map. Exits non-zero if any are missing:",
  `  cd ${GEN} && ${ENV} bun ${AUTO}/assert-map-coverage.ts ${dimId}`,
  "",
  "STEP 3 — Upload the map art to the CDN bucket. Masks + manifest stay local (the server reads masks for collision); only the large PNGs are pushed:",
  `  cd ${GEN} && ${ENV} bun ${AUTO}/upload-maps-s3.ts ${dimId}`,
  "",
  "Set coverageOk=true ONLY if all three commands succeeded and STEP 2 printed its OK line. Otherwise coverageOk=false with the failing command's error in note. Do not invent success.",
].join("\n");

const mapsSchema = {
  type: "object",
  required: ["coverageOk", "mapCount", "note"],
  additionalProperties: false,
  properties: {
    coverageOk: { type: "boolean" },
    mapCount: { type: "number" },
    note: { type: "string" },
  },
};

const [artResult, enemySummary, itemSummary, mapsResult] = await parallel([
  () => agent(artPrompt, { label: "art-generate", phase: "Generate", model: "haiku" }),
  () => agent(enemyPrompt, { label: "enemy-balance-loop", phase: "Generate", model: "fable" }),
  () => agent(itemPrompt, { label: "item-balance-loop", phase: "Generate", model: "fable" }),
  () => agent(mapsPrompt, { label: "maps-generate", phase: "Generate", model: "haiku", schema: mapsSchema }),
]);

// Fail the whole workflow if maps did not fully generate — a v2 dimension with
// missing maps is unplayable, so it must never reach Overworld/QA/Stage.
if (!mapsResult.coverageOk) {
  throw new Error(`Maps phase failed for dimension ${dimId}: ${mapsResult.note}`);
}

// ---------------------------------------------------------------------------
// Phase 5 — OVERWORLD (register the overworld background + hex decorations; v2
// dimensions register NO encounter structures — encounters use image maps)
// ---------------------------------------------------------------------------
phase("Overworld");

const structuresResult = await agent(
  [
    "You are a deterministic shim. Register the dimension's overworld background + hex decorations from the art step. v2 dimensions register zero encounter structures (--decorations-only), since encounters render from baked map images. Run the command, report the result.",
    "",
    `  ${ENV} bun ${AUTO}/register-structures.ts ${dimId} --decorations-only`,
    "",
    `It updates the dimension row with the overworld background + decoration paths and writes an empty structures list. Return its stdout. Fail loud if it errors.`,
  ].join("\n"),
  { label: "register-overworld", phase: "Overworld", model: "haiku" },
);

// ---------------------------------------------------------------------------
// Phase 6 — QA (final balance test + deterministic verdict)
// ---------------------------------------------------------------------------
phase("QA");

const verdict = await agent(
  [
    "You are a deterministic QA shim. Run the final balance test, then compute the verdict. Return the verdict JSON exactly as produced — do not editorialize or change any numbers.",
    "",
    "STEP 1 — Re-run the full balance test so the report reflects the final enemy roster:",
    `  cd ${ROOT}/server && ${ENV} bun ${T2}/balance-test.ts ${dimId} --seeds 3 --workers $(nproc)`,
    "",
    "STEP 2 — Compute the verdict (compares against the dim-0 baseline and bands):",
    `  cd ${ROOT}/server && ${ENV} bun ${AUTO}/balance-verdict.ts ${dimId}`,
    "",
    "Return the parsed verdict object (verdict: pass|warn|fail, summary, flags) from STEP 2's JSON stdout. Fail loud if either command errors.",
  ].join("\n"),
  {
    label: "qa-verdict",
    phase: "QA",
    model: "haiku",
    schema: {
      type: "object",
      required: ["verdict", "summary", "flags"],
      additionalProperties: true,
      properties: {
        verdict: { type: "string", enum: ["pass", "warn", "fail"] },
        summary: { type: "object", additionalProperties: true },
        flags: { type: "array", items: { type: "object", additionalProperties: true } },
      },
    },
  },
);
log(`QA verdict: ${verdict.verdict} (${verdict.summary?.flagCount ?? 0} flags)`);

// ---------------------------------------------------------------------------
// Phase 6.5 — PLAYABLE GATE (every enemy/item sprite resolves on disk)
// Balance-tested is not the same as loadable. This is the check whose absence let dims ship with
// blank enemy images; it must pass before we flip to in_review.
// ---------------------------------------------------------------------------
phase("QA");

const playable = await agent(
  [
    "You are a deterministic shim. Assert the dimension is actually playable — every enemy template has sprite files on disk and every item sprite exists. Run exactly this command and return its JSON stdout verbatim:",
    "",
    `  cd ${ROOT}/server && ${ENV} bun ${AUTO}/assert-dimension-playable.ts ${dimId}`,
    "",
    "The command exits non-zero and lists `problems` if anything is missing. If it fails, DO NOT swallow the error — return the report with playable:false so the run stops before staging a broken dimension.",
  ].join("\n"),
  {
    label: "qa-playable",
    phase: "QA",
    model: "haiku",
    schema: {
      type: "object",
      required: ["playable", "problems"],
      additionalProperties: true,
      properties: {
        playable: { type: "boolean" },
        problems: { type: "array", items: { type: "string" } },
      },
    },
  },
);
if (!playable.playable) {
  throw new Error(`Dimension ${dimId} is not playable — refusing to stage:\n  - ${playable.problems.join("\n  - ")}`);
}
log(`Playable gate: passed (${playable.enemies ?? "?"} enemies, ${playable.items ?? "?"} items)`);

// ---------------------------------------------------------------------------
// Phase 7 — STAGE (flip status to in_review)
// ---------------------------------------------------------------------------
phase("Stage");

await agent(
  [
    "You are a deterministic shim. Flip the dimension's lifecycle status to in_review. Run exactly this command:",
    "",
    `  ${ENV} bun -e 'import { setDimensionStatus } from "${DB_TS}"; setDimensionStatus(${dimId}, "in_review"); console.log(JSON.stringify({ dimId: ${dimId}, status: "in_review" }));'`,
    "",
    "Return its stdout. Fail loud if it errors.",
  ].join("\n"),
  { label: "stage-in-review", phase: "Stage", model: "haiku" },
);

// ---------------------------------------------------------------------------
// Review packet
// ---------------------------------------------------------------------------
const assetDirs = [
  `${ROOT}/server/sprites/enemies/dimension-${dimId}`,
  `${ROOT}/public/sprites/items/dimension-${dimId}`,
  `${ROOT}/public/sprites/map-objects/dimension-${dimId}`,
  `${ROOT}/public/sprites/map-decorations/dimension-${dimId}`,
  `${ROOT}/public/sprites/maps/dimension-${dimId}`,
  bundlesRoot,
];

return {
  dimId,
  name: dimName,
  spec,
  verdict,
  playUrl: `?dim=${dimId}`,
  assetDirs,
  notes: [
    `Status flipped to in_review. Shared db: ${dbPath}.`,
    `Art: ${artResult}`,
    `Maps: ${mapsResult.mapCount} maps, coverage ${mapsResult.coverageOk ? "OK" : "FAILED"} — ${mapsResult.note}`,
    `Overworld: ${structuresResult}`,
    `Enemy agent: ${enemySummary}`,
    `Item agent: ${itemSummary}`,
  ].join("\n\n"),
};
