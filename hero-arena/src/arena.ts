import { join } from "node:path";
import {
  buildScenarioMap, createGameState, makeEntity, findWalkablePosition, setTemplateRegistry,
} from "../../shared/src/index.js";
import type { Entity, EntityId, GameState, TeamId, UnitTemplate } from "../../shared/src/index.js";
import { HERO_TEMPLATE } from "./loadout.js";

export interface Arena {
  state: GameState;
  /** The hero entity id on each side. */
  heroIds: Record<TeamId, EntityId>;
  seed: number;
  /** The five World-1 enemy template keys both sides field as dumb allies (for logging/replay). */
  allyKeys: string[];
}

/** How many scripted World-1 allies stand behind each hero. */
const ALLIES_PER_SIDE = 5;

// `loadEnemyTemplateRegistry` opens the server's sqlite relative to cwd, so run from `server/`.
// (ESM hoists imports above statements — hence the dynamic import after chdir, like sim-battle.ts.)
let serverLoadersPromise: Promise<{
  loadEnemyTemplateRegistry: (dim: number) => Record<string, UnitTemplate>;
  loadCollisionGrid: (grid: GameState["grid"], objects: GameState["mapDefinition"]["objects"]) => Promise<void>;
}> | null = null;
function serverLoaders() {
  if (!serverLoadersPromise) {
    process.chdir(join(import.meta.dir, "..", "..", "server"));
    serverLoadersPromise = (async () => {
      const { loadEnemyTemplateRegistry } = await import("../../server/src/db.js");
      const { loadCollisionGrid } = await import("../../server/src/collision-loader.js");
      return { loadEnemyTemplateRegistry, loadCollisionGrid };
    })();
  }
  return serverLoadersPromise;
}

/** A nice "couple of goblins, a shield, a couple of slimes" comp, in spawn order. Anything here
 *  that isn't seeded is skipped; if fewer than five survive the filter we top up from whatever
 *  other non-boss World-0 templates exist. */
const PREFERRED_ALLIES = ["goblin-spear", "goblin-archer", "goblin-shield", "slime", "big-slime"];

/**
 * Build a fresh, mirrored arena for `seed`: a map with its obstacles rasterised in, two heroes
 * (same {@link HERO_TEMPLATE}) on opposite sides, each backed by the same five plain World-0
 * (Greenlands) enemies — goblins and slimes, never the bosses (Stone Golem / Massive Slime) —
 * running their own scripted strategies. Red spawns west and takes the first turn.
 */
export async function buildArena(seed: number): Promise<Arena> {
  const { loadEnemyTemplateRegistry, loadCollisionGrid } = await serverLoaders();
  const { grid, mapDefinition } = buildScenarioMap(seed);
  await loadCollisionGrid(grid, mapDefinition.objects);

  const reg = loadEnemyTemplateRegistry(0);
  // The engine's onDeath spawns (e.g. a big slime splitting into two slimes) look up the spawn
  // template by key from this global registry — set it, or the split silently no-ops.
  setTemplateRegistry(reg);
  const nonBoss = Object.keys(reg).filter(k => !(reg[k]!.tags ?? []).includes("boss")).sort();
  if (nonBoss.length === 0) throw new Error("dimension 0 has no (non-boss) enemy templates seeded — run the server seed first");
  const allyKeys = [...PREFERRED_ALLIES.filter(k => nonBoss.includes(k)), ...nonBoss.filter(k => !PREFERRED_ALLIES.includes(k))].slice(0, ALLIES_PER_SIDE);

  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const entities = new Map<string, Entity>();
  const heroIds = {} as Record<TeamId, EntityId>;

  const place = (target: { x: number; y: number }, radius: number) => findWalkablePosition(grid, target, radius);

  for (const [team, xFrac, prefix] of [["red", 0.12, "R"], ["blue", 0.88, "B"]] as const) {
    // hero at mid-height
    const heroId = `${prefix}-hero`;
    const heroPos = place({ x: worldW * xFrac, y: worldH * 0.5 }, HERO_TEMPLATE.collisionRadius);
    entities.set(heroId, makeEntity(heroId, "Hero", heroPos.x, heroPos.y, team as TeamId, HERO_TEMPLATE));
    heroIds[team as TeamId] = heroId;
    // allies fanned out vertically, slightly behind the hero (deeper toward their own edge)
    const allyXFrac = team === "red" ? xFrac - 0.05 : xFrac + 0.05;
    allyKeys.forEach((key, i) => {
      const id = `${prefix}-${key}-${i}`;
      const yFrac = (i + 1) / (allyKeys.length + 1);
      const tmpl = reg[key]!;
      const pos = place({ x: Math.max(0.02, Math.min(0.98, allyXFrac)) * worldW, y: worldH * yFrac }, tmpl.collisionRadius);
      entities.set(id, makeEntity(id, key, pos.x, pos.y, team as TeamId, tmpl));
    });
  }

  return { state: createGameState({ entities, grid, mapDefinition }), heroIds, seed, allyKeys };
}
