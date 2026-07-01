#!/usr/bin/env bun
/**
 * balance-verdict.ts <dimId>
 *
 * Reads balance-report-dim-<dimId>.json + baseline balance-report-dim-0.json and
 * emits a JSON verdict: { verdict, summary, flags }.
 *
 * Usage: bun balance-verdict.ts <dimId>
 */

import { join } from "node:path";

// ---- Tunable bands ----
const EXPERT_SOLO_WIN_MIN = 30;     // % — below this, enemy is too hard solo
const EXPERT_SOLO_WIN_MAX = 85;     // % — above this, enemy is too easy solo
const SKILL_GAP_MIN = 10;           // points — below this, no meaningful skill expression
const DUMB_WIN_RED_FLAG_MARGIN = 15; // points — dumbSoloWin > baseline + this triggers a flag

// ---- Types ----

interface PerEnemy {
  name: string;
  cost: number;
  expertSoloWin: number | null;
  dumbSoloWin: number | null;
  skillGap: number | null;
  expertPartyWin: number | null;
  dumbPartyWin: number | null;
}

interface Overall {
  expertSoloWin: number | null;
  dumbSoloWin: number | null;
  skillGap: number | null;
}

interface BalanceReport {
  dimensionId: number;
  dimensionName: string;
  summary?: {
    perEnemy: Record<string, unknown>[];
    overall: Record<string, unknown>;
  };
  results?: Array<{ scenario: string; result: { winner: string | null } }>;
}

type Verdict = "pass" | "warn" | "fail";

interface Flag {
  enemy: string;
  issue: string;
  value: number | null;
}

interface VerdictOutput {
  verdict: Verdict;
  summary: {
    dimensionName: string;
    overallExpertSoloWin: number | null;
    overallDumbSoloWin: number | null;
    overallSkillGap: number | null;
    dim0DumbBaseline: number;
    flagCount: number;
  };
  flags: Flag[];
}

// ---- Normalize field-name drift ----
// Older reports use noviceSoloWin / novicePartyWin; newer use dumbSoloWin / dumbPartyWin.

function normalizePerEnemy(raw: Record<string, unknown>): PerEnemy {
  return {
    name: raw.name as string,
    cost: raw.cost as number,
    expertSoloWin: (raw.expertSoloWin ?? null) as number | null,
    dumbSoloWin: ((raw.dumbSoloWin ?? raw.noviceSoloWin) ?? null) as number | null,
    skillGap: (raw.skillGap ?? null) as number | null,
    expertPartyWin: (raw.expertPartyWin ?? null) as number | null,
    dumbPartyWin: ((raw.dumbPartyWin ?? raw.novicePartyWin) ?? null) as number | null,
  };
}

function normalizeOverall(raw: Record<string, unknown>): Overall {
  return {
    expertSoloWin: (raw.expertSoloWin ?? null) as number | null,
    dumbSoloWin: ((raw.dumbSoloWin ?? raw.noviceSoloWin) ?? null) as number | null,
    skillGap: (raw.skillGap ?? null) as number | null,
  };
}

// ---- Dim-0 baseline computation ----
// Dim-0 has no summary section. The raw results use winner:"red"/"blue" (red = heroes).
// Scenarios: solo-expert-* = expert, solo-dumb-* = dumb. Exclude encounter-* rows.

function computeDim0DumbBaseline(
  results: Array<{ scenario: string; result: { winner: string | null } }>,
): number {
  let dumbW = 0, dumbT = 0;
  for (const r of results) {
    if (r.scenario.startsWith("encounter-")) continue;
    if (r.scenario.startsWith("solo-dumb-")) {
      dumbT++;
      if (r.result.winner === "red") dumbW++;
    }
  }
  if (dumbT === 0) throw new Error("dim-0 report has no solo-dumb-* results to compute baseline");
  return Math.round((dumbW / dumbT) * 1000) / 10;
}

// ---- Main ----

const dimId = Number(process.argv[2]);
if (isNaN(dimId)) {
  console.error("usage: bun balance-verdict.ts <dimId>");
  process.exit(2);
}

const ROOT = join(import.meta.dir, "..", "..");
const targetPath = join(ROOT, `balance-report-dim-${dimId}.json`);
const baselinePath = join(ROOT, "balance-report-dim-0.json");

const targetFile = Bun.file(targetPath);
const baselineFile = Bun.file(baselinePath);

if (!(await targetFile.exists())) {
  throw new Error(`Report not found: ${targetPath}`);
}
if (!(await baselineFile.exists())) {
  throw new Error(`Baseline report not found: ${baselinePath}`);
}

const target = (await targetFile.json()) as BalanceReport;
const baseline = (await baselineFile.json()) as BalanceReport;

if (!target.summary) throw new Error(`balance-report-dim-${dimId}.json has no summary section`);
if (!baseline.results) throw new Error("balance-report-dim-0.json has no results section");

const dim0DumbBaseline = computeDim0DumbBaseline(baseline.results);

const perEnemies = target.summary.perEnemy.map(e => normalizePerEnemy(e as Record<string, unknown>));
const overall = normalizeOverall(target.summary.overall as Record<string, unknown>);

// ---- Flag computation ----

const flags: Flag[] = [];

for (const e of perEnemies) {
  if (e.expertSoloWin !== null && e.expertSoloWin < EXPERT_SOLO_WIN_MIN) {
    flags.push({ enemy: e.name, issue: "expert-win-low", value: e.expertSoloWin });
  }
  if (e.expertSoloWin !== null && e.expertSoloWin > EXPERT_SOLO_WIN_MAX) {
    flags.push({ enemy: e.name, issue: "expert-win-high", value: e.expertSoloWin });
  }
  if (e.skillGap !== null && e.skillGap < SKILL_GAP_MIN) {
    flags.push({ enemy: e.name, issue: "skill-gap-low", value: e.skillGap });
  }
  if (e.dumbSoloWin !== null && e.dumbSoloWin > dim0DumbBaseline + DUMB_WIN_RED_FLAG_MARGIN) {
    flags.push({ enemy: e.name, issue: "dumb-win-high", value: e.dumbSoloWin });
  }
}

// ---- Overall verdict ----
// fail  → overall expertSoloWin is outside the healthy band
// warn  → per-enemy flags exist but overall is within band
// pass  → no flags

let verdict: Verdict;
const overallExpert = overall.expertSoloWin;
if (
  overallExpert === null ||
  overallExpert < EXPERT_SOLO_WIN_MIN ||
  overallExpert > EXPERT_SOLO_WIN_MAX
) {
  verdict = "fail";
} else if (flags.length > 0) {
  verdict = "warn";
} else {
  verdict = "pass";
}

const output: VerdictOutput = {
  verdict,
  summary: {
    dimensionName: target.dimensionName,
    overallExpertSoloWin: overall.expertSoloWin,
    overallDumbSoloWin: overall.dumbSoloWin,
    overallSkillGap: overall.skillGap,
    dim0DumbBaseline,
    flagCount: flags.length,
  },
  flags,
};

console.log(JSON.stringify(output, null, 2));
