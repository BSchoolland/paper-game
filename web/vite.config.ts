import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173, hmr: false },
  // Sprites live in the top-level public/ store (symlinked into web/public for dev). Don't copy that
  // ~1GB tree into the build — the server serves /sprites/* from the same store in production.
  build: { copyPublicDir: false },
});
