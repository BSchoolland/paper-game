import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Dev-only replay browser backend for the dev hub: GET /__dev/replays lists the repo-level
// replays/ dir (written by sim-battle / hero-arena), GET /__dev/replays/<name> serves one file.
function devReplays(): Plugin {
  const replaysDir = fileURLToPath(new URL("../replays", import.meta.url));
  return {
    name: "dev-replays",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/replays", (req, res) => {
        const name = decodeURIComponent((req.url ?? "/").split("?")[0]!.replace(/^\//, ""));
        res.setHeader("content-type", "application/json");
        if (!name) {
          const files = existsSync(replaysDir)
            ? readdirSync(replaysDir).filter((f) => f.endsWith(".json"))
            : [];
          const list = files
            .map((f) => {
              const st = statSync(join(replaysDir, f));
              return { name: f, mtimeMs: st.mtimeMs, size: st.size };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
          res.end(JSON.stringify(list));
          return;
        }
        if (!/^[\w.-]+\.json$/.test(name) || !existsSync(join(replaysDir, name))) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `no such replay: ${name}` }));
          return;
        }
        res.end(readFileSync(join(replaysDir, name)));
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), devReplays()],
  server: { port: 5173, hmr: false },
  // Sprites live in the top-level public/ store (symlinked into web/public for dev). Don't copy that
  // ~1GB tree into the build — the server serves /sprites/* from the same store in production.
  build: { copyPublicDir: false },
});
