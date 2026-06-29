export const meta = {
  name: "generate-and-stage",
  description:
    "Generate a complete v2 dimension (spec -> art -> balanced enemies & items -> baked image maps -> overworld art -> QA) and flip it to in_review. v2-only: every encounter renders from a generated map image (coverage is asserted), so no runtime structures are registered. Opus does all design reasoning; thin Haiku shims run the deterministic generator scripts; gpt-image-2 makes the art.",
  phases: [
    { title: "Spec" },
    { title: "Art" },
    { title: "Enemies + Items" },
    { title: "Maps" },
    { title: "Overworld" },
    { title: "QA" },
    { title: "Stage" },
  ],
};

// --- args (the harness may deliver `args` as a JSON string or an object) ---
const input = typeof args === "string" ? JSON.parse(args) : (args ?? {});
const dimId = input.dimId ?? 600;
const dbPath = input.dbPath;
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

// 1a. Haiku prep shim: seed reference dimensions 0-3 into the shared db, list
//     existing dimensions (for contrast), and pick 5 random inspiration nouns.
const prep = await agent(
  [
    "You are a deterministic setup shim. Run exactly the commands described, then return the requested data. Do not design anything.",
    "",
    "STEP 1 — Seed the reference dimensions 0-3 into the shared game db (the balance tests reference dim-0 enemies and the design agents copy dim-3 templates). Run this single command verbatim:",
    "",
    `  cd ${ROOT}/server && ${ENV} bun -e 'import { seedDiscovery } from "./src/db.ts"; import { seedDimension0 } from "./src/seed.ts"; import { seedDimension1 } from "./src/seed-dimension-1.ts"; import { seedDimension2 } from "./src/seed-dimension-2.ts"; import { seedDimension3 } from "./src/seed-dimension-3.ts"; seedDiscovery(0, 15); seedDimension0(); seedDimension1(); seedDimension2(); seedDimension3(); console.log("seeded");'`,
    "",
    "STEP 2 — List the dimensions already in the db (so the spec can contrast against them). Run:",
    "",
    `  cd ${ROOT}/server && ${ENV} bun -e 'import { listDimensions } from "./src/db.ts"; console.log(JSON.stringify(listDimensions()));'`,
    "",
    `  Format the result as lines like: 'Dimension <id> — "<name>"', excluding dimension ${dimId}.`,
    "",
    "STEP 3 — Pick 5 distinct random inspiration nouns. Run:",
    "",
    `  cd ${GEN} && bun -e 'import fw from "friendly-words"; const p = fw.objects; const s = new Set(); while (s.size < 5) s.add(p[Math.floor(Math.random()*p.length)]); console.log(JSON.stringify([...s]));'`,
    "",
    "Return existingDimensions (the formatted multi-line string) and nouns (the 5-element array). Fail loud if any command errors — do not invent data.",
  ].join("\n"),
  {
    label: "prep-seed-and-nouns",
    phase: "Spec",
    model: "haiku",
    schema: {
      type: "object",
      required: ["existingDimensions", "nouns"],
      additionalProperties: false,
      properties: {
        existingDimensions: { type: "string" },
        nouns: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 },
      },
    },
  },
);

// 1b. Opus spec agent: draft -> self-critique -> revise, return the full spec.
const spec = await agent(
  [
    "You are a game designer creating a new dimension for a turn-based tactical combat game, AND your own toughest critic. Do the full draft -> critique -> revise loop yourself in one pass, then output only the final revised spec.",
    "",
    'A dimension is a whole world — an entire planet with diverse biomes, cultures, and ecosystems, not a single room. "Underwater caves" is too narrow; "an ocean world with reefs, trenches and floating kelp cities" is the right scale.',
    "",
    "Existing dimensions (contrast with these so this one does not feel like a re-skin):",
    prep.existingDimensions,
    "",
    VOICE_GUIDE,
    "",
    "INSPIRATION PROCESS:",
    `Inspiration nouns: ${prep.nouns.join(", ")}`,
    "  1. Pick ONE noun to DROP entirely — ignore it, don't reference it.",
    "  2. Pick ONE noun to NEGATE — the world is explicitly NOT this; its absence helps define the world.",
    "  3. Use the remaining 3 as mood seeds — not literal constraints, starting points.",
    "Record the dropped and negated nouns in the spec fields.",
    "",
    "SELF-CRITIQUE PASS (do this before finalizing):",
    "Go through every enemy name and item name. For each, decide if it fits the voice or if it's slop.",
    "Be concrete. Fix the worst offenders with grounded replacements. Keep what already reads like the dim-0 gold standard.",
    "",
    "OUTPUT REQUIREMENTS:",
    `- id MUST be ${dimId}.`,
    "- enemies: a single freeform string covering all 16 enemies, grouped into 4 tiers (FODDER, STANDARD, ELITE, BOSS) of 4 each. For each: name, a 1-line mechanical role, and a brief visual description. Example line: '- Spear Runner — fast melee, runs in packs. A wiry desert nomad with a crude spear.'",
    "- items: a single freeform string covering all 16 items (mostly weapons: sword/spear/bow/staff/two-handed; plus shields, accessories, consumables). For each: name, type, rarity (common/uncommon/rare), brief description. Example line: '- Spear (weapon (spear), common): A long polearm with superior reach.'",
    "- palette: three hex colors (primary, secondary, accent).",
    "- description: 2-3 sentences at the scale of a whole planet.",
    "- mood: 1-2 sentences. biome: a short tag, e.g. 'scrub flatlands pocked with meteor craters'.",
    "",
    "Output the final spec object only.",
  ].join("\n"),
  {
    label: "spec-design",
    phase: "Spec",
    model: "opus",
    schema: {
      type: "object",
      required: [
        "id", "name", "description", "palette", "mood", "biome",
        "droppedNoun", "negatedNoun", "enemies", "items",
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
        enemies: { type: "string" },
        items: { type: "string" },
      },
    },
  },
);
spec.id = dimId;
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
// Phase 2 — ART (gpt-image-2 + python sprite extraction)
// ---------------------------------------------------------------------------
phase("Art");

const artResult = await agent(
  [
    "You are a deterministic shim around the art generator. It calls gpt-image-2 on every diffusion bundle and runs the python sprite-extraction scripts. Run it once, then report.",
    "",
    "Run this command (it can take several minutes — wait for it to finish):",
    "",
    `  ${ENV} bun ${AUTO}/art-agent.ts ${slug}`,
    "",
    "The agent reads the spec file by matching its slug, generates one image per bundle, and extracts sprites to:",
    `  - server/sprites/enemies/dimension-${dimId}/`,
    `  - client/public/sprites/items/dimension-${dimId}/`,
    `  - client/public/sprites/map-objects/dimension-${dimId}/ (background.png + decoration sprites + manifest.json)`,
    `  - client/public/sprites/map-decorations/dimension-${dimId}/`,
    "",
    "Return a one-paragraph summary of which bundles were generated and which sprite directories were written. Fail loud if the command errors or no images are produced.",
  ].join("\n"),
  { label: "art-generate", phase: "Art", model: "haiku" },
);

// ---------------------------------------------------------------------------
// Phase 3 — ENEMIES + ITEMS (two Opus agentic loops, in parallel)
// ---------------------------------------------------------------------------
phase("Enemies + Items");

const enemyPrompt = [
  "You are a game balance designer. Your job is to create and balance all 16 enemies for a new dimension in a turn-based tactical combat game, iterating against an automated balance test until they feel right. You have a Bash terminal; the generator scripts are your tools.",
  "",
  "DIMENSION SPEC:",
  `Name: ${dimName}`,
  `Biome: ${spec.biome}`,
  `Mood: ${spec.mood}`,
  "",
  "ENEMY BATCHES FROM SPEC:",
  spec.enemies,
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
  spec.items,
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

const [enemySummary, itemSummary] = await parallel([
  () =>
    agent(enemyPrompt, {
      label: "enemy-balance-loop",
      phase: "Enemies + Items",
      model: "opus",
    }),
  () =>
    agent(itemPrompt, {
      label: "item-balance-loop",
      phase: "Enemies + Items",
      model: "opus",
    }),
]);

// ---------------------------------------------------------------------------
// Phase 4 — MAPS (gpt-image-2; mandatory — v2 dimensions render every encounter
// from a baked image, so full coverage is required and asserted)
// ---------------------------------------------------------------------------
phase("Maps");

const mapsResult = await agent(
  [
    "You are a deterministic shim around the map generator. Run three commands in order, then report. Do not design anything.",
    "",
    `IMPORTANT: cd into ${GEN} first — the generator's .env (OpenRouter + OpenAI keys for the rewrite and collision passes) is loaded from that working directory. Running from elsewhere fails auth.`,
    "",
    "STEP 1 — Generate the encounter maps + collision masks (codex image_gen for art, OpenAI for collision; takes several minutes — wait for completion):",
    "",
    `  cd ${GEN} && ${ENV} bun ${AUTO}/map-agent.ts --new ${dimId} ${JSON.stringify(dimName)} ${JSON.stringify(spec.description)}`,
    "",
    `  It writes maps + manifest.json + collision masks to client/public/sprites/maps/dimension-${dimId}/.`,
    "",
    "STEP 2 — Assert full coverage. v2 dimensions have no structure fallback, so every encounter type MUST have a map. This exits non-zero if any are missing:",
    "",
    `  cd ${GEN} && ${ENV} bun ${AUTO}/assert-map-coverage.ts ${dimId}`,
    "",
    "STEP 3 — Upload the map art to the CDN bucket. Masks + manifest stay local (the server reads masks for collision); only the large PNGs are pushed:",
    "",
    `  cd ${GEN} && ${ENV} bun ${AUTO}/upload-maps-s3.ts ${dimId}`,
    "",
    "Set coverageOk=true ONLY if all three commands succeeded and STEP 2 printed its OK line. If anything errored, set coverageOk=false and put the failing command's error in note. Do not invent success.",
  ].join("\n"),
  {
    label: "maps-generate",
    phase: "Maps",
    model: "haiku",
    schema: {
      type: "object",
      required: ["coverageOk", "mapCount", "note"],
      additionalProperties: false,
      properties: {
        coverageOk: { type: "boolean" },
        mapCount: { type: "number" },
        note: { type: "string" },
      },
    },
  },
);

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
  `${ROOT}/client/public/sprites/items/dimension-${dimId}`,
  `${ROOT}/client/public/sprites/map-objects/dimension-${dimId}`,
  `${ROOT}/client/public/sprites/map-decorations/dimension-${dimId}`,
  `${ROOT}/client/public/sprites/maps/dimension-${dimId}`,
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
