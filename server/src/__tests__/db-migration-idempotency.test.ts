import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const DB_TS = resolve(import.meta.dir, "../db.ts");

/**
 * The v6 block must be re-runnable against a populated DB. Module cache makes an in-process
 * re-import meaningless, so run db.ts in TWO subprocesses against the same file-backed DB:
 * the first migrates a fresh DB v3->v6, the second must no-op cleanly at user_version 6.
 */
describe("db migration idempotency (v6)", () => {
  it("importing db.ts twice against the same DB exits 0 both times and lands on user_version 6", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coop-migration-"));
    const dbPath = join(dir, "migrate.sqlite");
    try {
      for (let round = 0; round < 2; round++) {
        const proc = Bun.spawn({
          cmd: ["bun", "-e", `await import(${JSON.stringify(DB_TS)})`],
          cwd: resolve(import.meta.dir, "../.."),
          env: { ...process.env, GAME_DB_PATH: dbPath, GAME_SKIP_SEED: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          console.error(`[migration round ${round}] stderr:`, await new Response(proc.stderr).text());
        }
        expect(exitCode).toBe(0);
      }

      const check = new Database(dbPath);
      const { user_version } = check.query("PRAGMA user_version").get() as { user_version: number };
      expect(user_version).toBe(6);
      // Spot-check the v6 surface actually exists.
      const tables = (
        check.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => t.name);
      for (const required of ["accounts", "account_sessions", "profiles", "friends", "titles", "account_titles", "account_stats", "account_dimensions"]) {
        expect(tables).toContain(required);
      }
      const seatCols = (check.query("PRAGMA table_info(run_seats)").all() as { name: string }[]).map((c) => c.name);
      expect(seatCols).toContain("account_id");
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
