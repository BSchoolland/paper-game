import type { MultiFormatAgent } from "./types.js";

import { agent as agent01 } from "../../agents/agent-01/index.js";
import { agent as agent02 } from "../../agents/agent-02/index.js";
import { agent as agent03 } from "../../agents/agent-03/index.js";
import { agent as agent04 } from "../../agents/agent-04/index.js";
import { agent as agent05 } from "../../agents/agent-05/index.js";
import { agent as agent06 } from "../../agents/agent-06/index.js";
import { agent as agent07 } from "../../agents/agent-07/index.js";
import { agent as agent08 } from "../../agents/agent-08/index.js";
export const AGENTS2: Record<string, MultiFormatAgent> = {
  "agent-01": agent01,
  "agent-02": agent02,
  "agent-03": agent03,
  "agent-04": agent04,
  "agent-05": agent05,
  "agent-06": agent06,
  "agent-07": agent07,
  "agent-08": agent08,
};

export const COMPETITOR_NAMES = Object.keys(AGENTS2);
