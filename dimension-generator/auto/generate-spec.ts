import {
  client,
  SMART_MODEL,
  tool,
  hasToolCall,
  z,
  createStepLog,
  appendStepLog,
} from "./llm.js";
// @ts-expect-error - friendly-words has no types
import fw from "friendly-words";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ---------------------------------------------------------------------------
// The game's voice — dim 0 is the gold standard, the model should hew to it.
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
- No "The ___" proper-noun constructions ("The Caravan King" → "Caravan Captain").
- Variants scale by plain size: Slime → Big Slime → Massive Slime.
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
// Schemas
// ---------------------------------------------------------------------------

const dimensionSpecSchema = z.object({
  id: z.number(),
  name: z.string().describe("Dimension name. One or two words."),
  description: z
    .string()
    .describe(
      "2-3 sentence world description — scale of a whole planet, not a single room.",
    ),
  palette: z.object({
    primary: z.string().describe("Hex color"),
    secondary: z.string(),
    accent: z.string(),
  }),
  mood: z
    .string()
    .describe("1-2 sentences capturing the feel of the dimension."),
  biome: z
    .string()
    .describe(
      "Short biome tag, e.g. 'scrub flatlands pocked with meteor craters'.",
    ),
  droppedNoun: z
    .string()
    .describe("Which of the 5 inspiration nouns you dropped entirely."),
  negatedNoun: z
    .string()
    .describe(
      "Which of the 5 inspiration nouns you NEGATED (the world is explicitly NOT this).",
    ),
  enemies: z.string().describe(
    [
      "All 16 enemies as a single freeform string, grouped into 4 tiers (fodder, standard, elite, boss) with 4 enemies each.",
      "For each enemy include: name, role (1-line mechanical description), and a brief visual description.",
      "Example format:",
      "FODDER (cost 1-2, swarms):",
      "- Spear Runner — fast melee, runs in packs. A wiry desert nomad with a crude spear.",
      "(...continue through STANDARD, ELITE, BOSS tiers)",
    ].join("\n"),
  ),
  items: z.string().describe(
    [
      "All 16 items as a single freeform string. Mix of weapons (sword/spear/bow/staff/two-handed), shields, accessories, consumables.",
      "For each item include: name, type, rarity (common/uncommon/rare), and a brief description.",
      "Example format:",
      "- Spear (weapon (spear), common): A long polearm with superior reach.",
      "- Lasso (weapon (utility), uncommon): A rawhide rope; pulls enemies in on hit.",
    ].join("\n"),
  ),
});

export type DimensionSpec = z.infer<typeof dimensionSpecSchema>;

const submitSpec = tool({
  name: "submit_dimension_spec",
  description: "Submit the completed dimension specification.",
  inputSchema: dimensionSpecSchema,
  execute: async (spec) => spec,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getExistingDimensions(excludeId: number): Promise<string> {
  const { Database } = await import("bun:sqlite");
  const db = new Database("hex-discovery.sqlite", { readonly: true });
  const rows = db
    .prepare("SELECT id, name FROM dimensions WHERE id != ? ORDER BY id")
    .all(excludeId) as { id: number; name: string }[];
  db.close();
  return rows.map((r) => `Dimension ${r.id} — "${r.name}"`).join("\n");
}

async function consumeAndLog(
  result: ReturnType<typeof client.callModel>,
  logPath: string,
  textPrefix: string,
): Promise<DimensionSpec | null> {
  const msgPromise = (async () => {
    for await (const msg of result.getNewMessagesStream()) {
      appendStepLog(logPath, msg);
    }
  })();
  const textPromise = (async () => {
    let hasText = false;
    for await (const delta of result.getTextStream()) {
      if (!hasText) {
        process.stdout.write(textPrefix);
        hasText = true;
      }
      process.stdout.write(delta);
    }
    if (hasText) process.stdout.write("\n");
  })();
  let spec: DimensionSpec | null = null;
  for await (const tc of result.getToolCallsStream()) {
    if (tc.name === "submit_dimension_spec") {
      spec = tc.arguments as DimensionSpec;
    }
  }
  await textPromise;
  await msgPromise;
  return spec;
}

// ---------------------------------------------------------------------------
// Pass 1 — initial spec generation
// ---------------------------------------------------------------------------

async function generateDraft(
  dimId: number,
  nouns: string[],
  existing: string,
  logPath: string,
): Promise<DimensionSpec> {
  const t0 = Date.now();
  const result = client.callModel({
    model: SMART_MODEL,
    instructions: [
      "You are a game designer creating a new dimension for a turn-based tactical combat game.",
      "",
      'A dimension is a whole world — an entire planet with diverse biomes, cultures, and ecosystems, not a single room. "Underwater caves" is too narrow; "an ocean world with reefs, trenches and floating kelp cities" is the right scale.',
      "",
      "Existing dimensions (contrast with these to avoid every dimension feeling the same):",
      existing,
      "",
      VOICE_GUIDE,
      "",
      "INSPIRATION PROCESS:",
      "You will be given 5 random inspiration nouns. Process them like this:",
      "  1. Pick ONE noun to DROP entirely — ignore it, don't reference it.",
      "  2. Pick ONE noun to NEGATE — the world is explicitly NOT this. Its absence helps define the world.",
      "  3. Use the remaining 3 as mood seeds — not literal constraints, but starting points.",
      "Record the dropped and negated nouns in the spec fields.",
      "",
      "Call the submit_dimension_spec tool with your complete spec.",
    ].join("\n"),
    input: `Create dimension ${dimId}. Inspiration nouns: ${nouns.join(", ")}`,
    tools: [submitSpec],
    stopWhen: [hasToolCall("submit_dimension_spec")],
  });

  const spec = await consumeAndLog(result, logPath, "  DRAFT: ");
  if (!spec) {
    const response = await result.getResponse();
    throw new Error(
      "Draft generation failed. Response: " + JSON.stringify(response),
    );
  }
  console.log(
    `  Draft received in ${((Date.now() - t0) / 1000).toFixed(1)}s (dropped: ${spec.droppedNoun}, negated: ${spec.negatedNoun})`,
  );
  return spec;
}

// ---------------------------------------------------------------------------
// Pass 2 — critic / judge
// ---------------------------------------------------------------------------

async function critiqueDraft(
  spec: DimensionSpec,
  logPath: string,
): Promise<string> {
  const t0 = Date.now();
  const result = client.callModel({
    model: SMART_MODEL,
    instructions: [
      "You are a critic reviewing a draft dimension for a turn-based tactical combat game.",
      "The game's voice is deliberately grounded — like a tabletop GM running a fast session, not an MMO marketing department.",
      "",
      VOICE_GUIDE,
      "",
      "YOUR JOB:",
      "Go through every enemy name and item name. For each one, decide if it fits the voice or if it's slop.",
      "Be specific and concrete. Don't waffle. If something is fine, say so briefly and move on.",
      "Save your words for things worth flagging.",
      "",
      "At the end, list:",
      "  - TOP PROBLEMS (the worst offenders, with concrete suggested replacements)",
      "  - TOP STRENGTHS (the best fits)",
      "",
      "Output your critique as plain text. Do not call any tools. Under 400 words.",
    ].join("\n"),
    input: [
      `DIMENSION: ${spec.name}`,
      `Biome: ${spec.biome}`,
      `Mood: ${spec.mood}`,
      `Description: ${spec.description}`,
      "",
      "ENEMIES:",
      spec.enemies,
      "",
      "ITEMS:",
      spec.items,
    ].join("\n"),
  });

  // Stream + log
  const msgPromise = (async () => {
    for await (const msg of result.getNewMessagesStream()) {
      appendStepLog(logPath, msg);
    }
  })();
  let text = "";
  const textPromise = (async () => {
    let started = false;
    for await (const delta of result.getTextStream()) {
      text += delta;
      if (!started) {
        process.stdout.write("  CRITIC: ");
        started = true;
      }
      process.stdout.write(delta);
    }
    if (started) process.stdout.write("\n");
  })();
  await textPromise;
  await msgPromise;
  console.log(`  Critique received in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return text;
}

// ---------------------------------------------------------------------------
// Pass 3 — revise based on critique
// ---------------------------------------------------------------------------

async function reviseDraft(
  dimId: number,
  draft: DimensionSpec,
  critique: string,
  existing: string,
  logPath: string,
): Promise<DimensionSpec> {
  const t0 = Date.now();
  const result = client.callModel({
    model: SMART_MODEL,
    instructions: [
      "You are revising a draft dimension spec based on critic feedback.",
      "",
      "Existing dimensions (still contrast with these):",
      existing,
      "",
      VOICE_GUIDE,
      "",
      "Your job: take the draft and the critique. Fix the problems the critic flagged.",
      "Keep what the critic praised. Re-submit the full spec via the tool.",
      "Preserve droppedNoun and negatedNoun from the draft.",
    ].join("\n"),
    input: [
      "DRAFT SPEC:",
      JSON.stringify(draft, null, 2),
      "",
      "CRITIQUE:",
      critique,
      "",
      "Now submit the revised spec.",
    ].join("\n"),
    tools: [submitSpec],
    stopWhen: [hasToolCall("submit_dimension_spec")],
  });

  const spec = await consumeAndLog(result, logPath, "  REVISE: ");
  if (!spec) {
    const response = await result.getResponse();
    throw new Error(
      "Revision failed. Response: " + JSON.stringify(response),
    );
  }
  console.log(
    `  Revision received in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  return spec;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateSpec(dimId: number): Promise<DimensionSpec> {
  // Pick 5 distinct random inspiration nouns from friendly-words.
  const pool: string[] = fw.objects;
  const nouns: string[] = [];
  while (nouns.length < 5) {
    const n = pick(pool);
    if (!nouns.includes(n)) nouns.push(n);
  }
  console.log(`  Inspiration nouns: ${nouns.join(", ")}`);
  console.log(`  Calling ${SMART_MODEL}...`);
  const existing = await getExistingDimensions(dimId);
  const logPath = createStepLog(dimId, "spec");
  console.log(`  Log: ${logPath}`);

  const draft = await generateDraft(dimId, nouns, existing, logPath);
  const critique = await critiqueDraft(draft, logPath);
  const revised = await reviseDraft(dimId, draft, critique, existing, logPath);

  return revised;
}
