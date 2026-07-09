/**
 * Spawn N game-worker subprocesses, dispatch jobs dynamically (each worker pulls the next
 * job as soon as it's idle), collect results. Naturally load-balances across game durations.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ArenaConfig } from "./types.js";

export type ControllerType = "sovereign" | "rush" | "kite";

export interface GameJob {
  gameIndex: number;
  config: ArenaConfig;
  controllers: { entityId: string; type: ControllerType }[];
  logFile: string;
}

export interface GameResult { winner: string | null; turns: number; redHpPct: number; blueHpPct: number; }

const WORKER_SCRIPT = join(import.meta.dir, "game-worker.ts");

export async function runJobsParallel(
  jobs: GameJob[],
  workerCount: number,
  onResult?: (gameIndex: number, result: GameResult) => void,
): Promise<Map<number, GameResult>> {
  const results = new Map<number, GameResult>();
  let nextJob = 0;

  const workers = Array.from({ length: workerCount }, () =>
    spawn("bun", [WORKER_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] }),
  );

  // Capture stderr per worker so failures are debuggable
  for (let i = 0; i < workers.length; i++) {
    workers[i]!.stderr?.on("data", d => process.stderr.write(`[worker ${i}] ${d}`));
  }

  const killAll = () => { for (const w of workers) try { w.kill("SIGKILL"); } catch {} };
  process.on("SIGINT", () => { killAll(); process.exit(130); });

  await Promise.all(workers.map((worker, idx) => new Promise<void>((resolve, reject) => {
    let buffer = "";
    const send = (job: GameJob): boolean => {
      try { worker.stdin!.write(JSON.stringify(job) + "\n"); return true; }
      catch (e) { reject(new Error(`worker ${idx} stdin write failed: ${(e as Error).message}`)); return false; }
    };

    const dispatchNext = () => {
      if (nextJob >= jobs.length) {
        worker.stdin!.end();
        return;
      }
      send(jobs[nextJob++]!);
    };

    worker.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        // Server-boot imports inside the worker log to stdout ([equip-defaults] etc.) — pass
        // anything that isn't a protocol line through to stderr instead of dying on it.
        if (!line.startsWith("{")) { process.stderr.write(`[worker ${idx}] ${line}\n`); continue; }
        const { gameIndex, result } = JSON.parse(line) as { gameIndex: number; result: GameResult };
        results.set(gameIndex, result);
        if (onResult) onResult(gameIndex, result);
        dispatchNext();
      }
    });

    worker.on("close", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`worker ${idx} exited ${code}`));
      else resolve();
    });

    worker.on("error", reject);

    // Prime the worker with its first job
    dispatchNext();
  })));

  return results;
}
