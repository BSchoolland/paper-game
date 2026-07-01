// The sprite convention for auto-generated enemies: sprites are extracted flat to
// server/sprites/enemies/dimension-<id>/<enemyId>-<state>.png and the game serves them at
// /api/sprites/... reading only template.sprites. Every save path for a generated enemy must stamp
// this on, or the enemy renders blank in-game. One definition, used by every writer.
import type { EnemyTemplate } from "./schemas.js";

const STATES = ["idle", "attack", "hit", "move"] as const;

export function withEnemySprites<T extends EnemyTemplate>(
  dimId: number,
  id: string,
  template: T,
): T & { sprites: Record<(typeof STATES)[number], string> } {
  const base = `/api/sprites/enemies/dimension-${dimId}/${id}`;
  return {
    ...template,
    sprites: Object.fromEntries(STATES.map((s) => [s, `${base}-${s}.png`])) as Record<
      (typeof STATES)[number],
      string
    >,
  };
}
