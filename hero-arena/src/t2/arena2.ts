import { join } from "node:path";
import {
  buildScenarioMap, createGameState, makeEntity, findWalkablePosition, setTemplateRegistry,
  ITEM_SUMMON_TEMPLATES,
} from "../../../shared/src/index.js";
import type { Entity, EntityId, GameState, TeamId, UnitTemplate } from "../../../shared/src/index.js";
import type { ArenaConfig } from "./types.js";

export interface Arena2 {
  state: GameState;
  heroIds: { red: EntityId[]; blue: EntityId[] };
  seed: number;
}

let serverLoadersPromise: Promise<{
  loadEnemyTemplateRegistry: (dim: number) => Record<string, UnitTemplate>;
  loadCollisionGrid: (grid: GameState["grid"], objects: GameState["mapDefinition"]["objects"]) => Promise<void>;
}> | null = null;

function serverLoaders() {
  if (!serverLoadersPromise) {
    process.chdir(join(import.meta.dir, "..", "..", "..", "server"));
    serverLoadersPromise = (async () => {
      const { loadEnemyTemplateRegistry } = await import("../../../server/src/db.js");
      const { loadCollisionGrid } = await import("../../../server/src/collision-loader.js");
      return { loadEnemyTemplateRegistry, loadCollisionGrid };
    })();
  }
  return serverLoadersPromise;
}

export async function buildArena2(config: ArenaConfig): Promise<Arena2> {
  const { loadEnemyTemplateRegistry, loadCollisionGrid } = await serverLoaders();
  const { grid, mapDefinition } = buildScenarioMap(config.seed);
  await loadCollisionGrid(grid, mapDefinition.objects);

  // Load all needed dimension registries and merge them
  const neededDims = new Set<number>();
  for (const side of [config.red, config.blue]) {
    for (const ally of side.scriptedAllies) neededDims.add(ally.dim);
  }
  const combined: Record<string, UnitTemplate> = {};
  for (const dim of neededDims) {
    const reg = loadEnemyTemplateRegistry(dim);
    Object.assign(combined, reg);
  }
  // Item summons must resolve in the sim exactly as in live encounters.
  Object.assign(combined, ITEM_SUMMON_TEMPLATES);
  setTemplateRegistry(combined);

  const worldW = grid.width * grid.cellSize;
  const worldH = grid.height * grid.cellSize;
  const entities = new Map<string, Entity>();
  const heroIds: { red: EntityId[]; blue: EntityId[] } = { red: [], blue: [] };

  const place = (target: { x: number; y: number }, radius: number) =>
    findWalkablePosition(grid, target, radius);

  for (const [team, xFrac, prefix] of [["red", 0.12, "R"], ["blue", 0.88, "B"]] as const) {
    const comp = team === "red" ? config.red : config.blue;

    // Place heroes vertically spaced
    const heroCount = comp.heroes.length;
    comp.heroes.forEach((h, i) => {
      const yFrac = heroCount === 1 ? 0.5 : (i + 1) / (heroCount + 1);
      const pos = place({ x: worldW * xFrac, y: worldH * yFrac }, h.template.collisionRadius);
      entities.set(h.id, makeEntity(h.id, h.role, pos.x, pos.y, team as TeamId, h.template));
      heroIds[team as TeamId].push(h.id);
    });

    // Place scripted allies behind the heroes
    const allyXFrac = team === "red" ? xFrac - 0.05 : xFrac + 0.05;
    let allyIdx = 0;
    const totalAllies = comp.scriptedAllies.reduce((n, a) => n + a.count, 0);
    for (const allySpec of comp.scriptedAllies) {
      const tmpl = combined[allySpec.key];
      if (!tmpl) {
        console.error(`  warning: template "${allySpec.key}" not found in dim-${allySpec.dim} registry — skipping`);
        continue;
      }
      for (let j = 0; j < allySpec.count; j++) {
        const id = `${prefix}-${allySpec.key}-${allyIdx}`;
        const yFrac = totalAllies <= 1 ? 0.5 : (allyIdx + 1) / (totalAllies + 1);
        const pos = place({ x: Math.max(0.02, Math.min(0.98, allyXFrac)) * worldW, y: worldH * yFrac }, tmpl.collisionRadius);
        entities.set(id, makeEntity(id, allySpec.key, pos.x, pos.y, team as TeamId, tmpl));
        allyIdx++;
      }
    }
  }

  return { state: createGameState({ entities, grid, mapDefinition }), heroIds, seed: config.seed };
}
