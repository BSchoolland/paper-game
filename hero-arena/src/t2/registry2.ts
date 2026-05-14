import type { MultiFormatAgent } from "./types.js";

import { agent as agent01 } from "../../agents/agent-01/index.js";
import { agent as agent02 } from "../../agents/agent-02/index.js";
import { agent as agent03 } from "../../agents/agent-03/index.js";
import { agent as agent04 } from "../../agents/agent-04/index.js";

export const AGENTS2: Record<string, MultiFormatAgent> = {
  "agent-01": agent01,
  "agent-02": agent02,
  "agent-03": agent03,
  "agent-04": agent04,
};

export const COMPETITOR_NAMES = Object.keys(AGENTS2);
