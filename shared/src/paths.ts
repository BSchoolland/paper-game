import { resolve } from "node:path";

// Single source of truth for the game's on-disk asset roots. Resolved from this file's
// location (<repo>/shared/src/paths.ts), so every consumer gets the same absolute paths
// regardless of its own directory depth.
//
// Node/Bun only — these are filesystem paths. Deliberately NOT re-exported from shared's
// barrel (src/index.ts) so browser bundles (web, client-legacy) can't pull node:path in.
const REPO_ROOT = resolve(import.meta.dir, "..", "..");

/** Shared static asset store: sprites, encounter maps, collision masks, item art. Served by the
 *  web UI (via its public/sprites symlink) and read directly by the game server. */
export const ASSETS_DIR = resolve(REPO_ROOT, "public");

/** Enemy sprite store, served dynamically by the game server at /api/sprites/ and written by the
 *  art agent. Separate from ASSETS_DIR because these are generated per-dimension, not static. */
export const SERVER_SPRITES_DIR = resolve(REPO_ROOT, "server", "sprites");

/** The archived Pixi client's asset dir. Holds legacy combat replays that only its ?mode=replay
 *  viewer consumes (written by sim-battle and the hero-arena replay presets). */
export const LEGACY_PUBLIC_DIR = resolve(REPO_ROOT, "client-legacy", "public");

/** Built web frontend (`vite build` output). In production the server serves this as the single
 *  origin for static + /api + /ws; empty in dev, where Vite serves the frontend on its own port. */
export const WEB_DIST_DIR = resolve(REPO_ROOT, "web", "dist");
