import type { HeroController } from "./types.js";
import { baselineHero } from "./reference-bot.js";

import { hero as agent01 } from "../agents/agent-01/index.js";
import { hero as agent02 } from "../agents/agent-02/index.js";
import { hero as agent03 } from "../agents/agent-03/index.js";
import { hero as agent04 } from "../agents/agent-04/index.js";
import { hero as agent05 } from "../agents/agent-05/index.js";
import { hero as agent06 } from "../agents/agent-06/index.js";
import { hero as agent07 } from "../agents/agent-07/index.js";
import { hero as agent08 } from "../agents/agent-08/index.js";

/** The eight competitors. Order here is just the display order in the standings. */
export const AGENTS: Record<string, HeroController> = {
  "agent-01": agent01, "agent-02": agent02, "agent-03": agent03, "agent-04": agent04,
  "agent-05": agent05, "agent-06": agent06, "agent-07": agent07, "agent-08": agent08,
};

/** Not a competitor — a dead-simple "charge the nearest foe" bot, available for smoke tests. */
export const BASELINE: HeroController = baselineHero;

export const AGENT_NAMES = Object.keys(AGENTS);

export function controllerByName(name: string): HeroController {
  if (name === "baseline") return BASELINE;
  const c = AGENTS[name];
  if (!c) throw new Error(`unknown agent "${name}". Known: ${AGENT_NAMES.join(", ")}, baseline`);
  return c;
}
