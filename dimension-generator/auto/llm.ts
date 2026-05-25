import { OpenRouter } from "@openrouter/sdk";
import { tool } from "@openrouter/sdk/lib/tool";
import { hasToolCall, stepCountIs } from "@openrouter/sdk/lib/stop-conditions";
import { z } from "zod/v4";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const FAST_MODEL = "anthropic/claude-sonnet-4.6";
export const SMART_MODEL = "anthropic/claude-sonnet-4.6";

const ROOT = join(import.meta.dir, "..", "..");

export function createStepLog(dimId: number, stepName: string): string {
  const path = join(ROOT, `dim-${dimId}-${stepName}.jsonl`);
  writeFileSync(path, "");
  return path;
}

export function appendStepLog(path: string, message: unknown): void {
  appendFileSync(path, JSON.stringify(message) + "\n");
}

export { tool, hasToolCall, stepCountIs, z };

/**
 * Wrap an agentic callModel + stream-consumption block in a single retry on
 * transient OpenRouter SDK stream errors (e.g. "Stream ended without completion
 * event", "Follow-up stream ended without a completed response").
 *
 * On retry the model starts fresh; any tool-call side effects (DB upserts) from
 * the failed attempt remain and will simply be overwritten on the next attempt.
 */
export async function callWithRetry(name: string, fn: () => Promise<void>): Promise<void> {
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransientStreamError = msg.includes("Stream ended") || msg.includes("Follow-up stream ended");
      if (!isTransientStreamError || attempt >= MAX_ATTEMPTS) throw err;
      console.log(`  [${name}] Transient SDK stream error on attempt ${attempt}/${MAX_ATTEMPTS}, retrying once: ${msg}`);
    }
  }
}
