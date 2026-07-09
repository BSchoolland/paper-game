import type { Entity, GameEvent, GameState, GridState, StatusEffect, StatusEffectType, Vec2, Zone, ZoneEffectKind, ZoneSpec } from "../core/types.js";
import { CELL_WALL, CELL_COVER } from "../map/collision-grid.js";
import { distance } from "../core/vec2.js";

/** Zones whose effect is "stamp the collision grid" rather than "act on entities each turn". */
export function isGridZone(effect: ZoneEffectKind): boolean {
  return effect === "wall" || effect === "cover";
}

function gridCellValue(effect: ZoneEffectKind): number {
  return effect === "wall" ? CELL_WALL : CELL_COVER;
}

export function entityInZone(zone: Zone, entity: Pick<Entity, "position" | "collisionRadius">): boolean {
  return distance(zone.center, entity.position) <= zone.radius + entity.collisionRadius;
}

/** The grid-cell indices whose centre falls within `radius` of `center`. */
function circleCellIndices(grid: GridState, center: Vec2, radius: number): number[] {
  const cs = grid.cellSize;
  const minCx = Math.max(0, Math.floor((center.x - radius) / cs));
  const maxCx = Math.min(grid.width - 1, Math.floor((center.x + radius) / cs));
  const minCy = Math.max(0, Math.floor((center.y - radius) / cs));
  const maxCy = Math.min(grid.height - 1, Math.floor((center.y + radius) / cs));
  const out: number[] = [];
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const px = (cx + 0.5) * cs;
      const py = (cy + 0.5) * cs;
      if ((px - center.x) ** 2 + (py - center.y) ** 2 <= radius * radius) {
        out.push(cy * grid.width + cx);
      }
    }
  }
  return out;
}

/**
 * Whether a `wall` zone may be dropped here: the area must contain no existing wall cell and
 * overlap no living entity. (Every other zone kind may be placed anywhere.)
 */
export function canPlaceWallZone(state: GameState, center: Vec2, radius: number): boolean {
  for (const idx of circleCellIndices(state.grid, center, radius)) {
    if (state.grid.walls[idx] === CELL_WALL) return false;
  }
  for (const e of state.entities.values()) {
    if (e.dead) continue;
    if (distance(center, e.position) < radius + e.collisionRadius) return false;
  }
  return true;
}

/** Returns a grid with `value` written into `center±radius`, plus the cells changed and their old values. */
export function stampGridZone(
  grid: GridState,
  center: Vec2,
  radius: number,
  value: number
): { grid: GridState; stampedCells: { index: number; previous: number }[] } {
  const walls = Uint8Array.from(grid.walls);
  const stampedCells: { index: number; previous: number }[] = [];
  for (const idx of circleCellIndices(grid, center, radius)) {
    if (walls[idx] === value) continue;
    stampedCells.push({ index: idx, previous: walls[idx]! });
    walls[idx] = value;
  }
  return { grid: { ...grid, walls }, stampedCells };
}

function unstampGridZone(grid: GridState, stampedCells: readonly { index: number; previous: number }[]): GridState {
  if (stampedCells.length === 0) return grid;
  const walls = Uint8Array.from(grid.walls);
  for (const { index, previous } of stampedCells) walls[index] = previous;
  return { ...grid, walls };
}

/** Create the zone a `ZoneAbility` drops at `center`, stamping the grid for `cover`/`wall` kinds. */
export function createZone(
  state: GameState,
  center: Vec2,
  spec: ZoneSpec
): { state: GameState; zone: Zone } {
  const id = `zone-${state.nextZoneId + 1}`;
  let grid = state.grid;
  let stampedCells: { index: number; previous: number }[] | undefined;
  if (isGridZone(spec.effect)) {
    const stamped = stampGridZone(grid, center, spec.radius, gridCellValue(spec.effect));
    grid = stamped.grid;
    stampedCells = stamped.stampedCells;
  }
  const zone: Zone = {
    id, effect: spec.effect, center, radius: spec.radius,
    remaining: spec.duration, magnitude: spec.magnitude, color: spec.color, pattern: spec.pattern, stampedCells,
  };
  return {
    state: { ...state, grid, zones: [...state.zones, zone], nextZoneId: state.nextZoneId + 1 },
    zone,
  };
}

const DRAIN_STATUS: Partial<Record<ZoneEffectKind, StatusEffectType>> = {
  drainRed: "suppressed",
  drainBlue: "winded",
};
const DRAIN_DURATION = 2;

function withStatus(entity: Entity, status: StatusEffect): Entity {
  const kept = (entity.statusEffects ?? []).filter(s => s.type !== status.type);
  return { ...entity, statusEffects: [...kept, status] };
}

function applyAreaEffectToEntity(
  effect: ZoneEffectKind,
  magnitude: number,
  entity: Entity
): { entity: Entity; event: Omit<Extract<GameEvent, { type: "zoneTick" }>, "type" | "zoneId"> | null } {
  switch (effect) {
    case "damage": {
      const absorbed = Math.min(entity.barrier, magnitude);
      const hp = entity.hp - (magnitude - absorbed);
      const killed = hp <= 0;
      const next: Entity = killed
        ? { ...entity, hp: 0, barrier: 0, dead: true }
        : { ...entity, hp, barrier: entity.barrier - absorbed };
      return { entity: next, event: { entityId: entity.id, effect: "damage", magnitude } };
    }
    case "heal": {
      if (entity.hp >= entity.maxHp) return { entity, event: null };
      return {
        entity: { ...entity, hp: Math.min(entity.maxHp, entity.hp + magnitude) },
        event: { entityId: entity.id, effect: "heal", magnitude },
      };
    }
    case "addBarrier":
      return {
        entity: { ...entity, barrier: entity.barrier + magnitude },
        event: { entityId: entity.id, effect: "addBarrier", magnitude },
      };
    case "drainRed":
    case "drainBlue": {
      const type = DRAIN_STATUS[effect]!;
      return {
        entity: withStatus(entity, { type, duration: DRAIN_DURATION, value: magnitude }),
        event: { entityId: entity.id, effect, magnitude },
      };
    }
    case "cover":
    case "wall":
      return { entity, event: null };
  }
}

/**
 * The start-of-turn zone pass: every living entity standing in a non-grid zone takes that
 * zone's effect, then every zone's `remaining` ticks down and any that hit zero are removed —
 * un-stamping the grid for `cover`/`wall` zones. Called from `startTurn`, after the active
 * team's energy regen / barrier clear / status tick, so barrier zones can top players back up.
 */
export function tickZones(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.zones.length === 0) return { state, events: [] };
  const events: GameEvent[] = [];
  const entities = new Map(state.entities);

  for (const zone of state.zones) {
    if (isGridZone(zone.effect)) continue;
    for (const entity of entities.values()) {
      if (entity.dead || !entityInZone(zone, entity)) continue;
      const { entity: next, event } = applyAreaEffectToEntity(zone.effect, zone.magnitude, entity);
      if (event) {
        entities.set(entity.id, next);
        if (next.dead) {
          // A lethal tick reads as a collision-style hit so the renderer plays the death beat.
          events.push({ type: "collision", entityId: entity.id, at: entity.position, damage: zone.magnitude, killed: true });
        } else {
          events.push({ type: "zoneTick", zoneId: zone.id, ...event });
        }
      }
    }
  }

  let grid = state.grid;
  const survivors: Zone[] = [];
  for (const zone of state.zones) {
    const remaining = zone.remaining - 1;
    if (remaining > 0) {
      survivors.push({ ...zone, remaining });
    } else {
      if (zone.stampedCells) grid = unstampGridZone(grid, zone.stampedCells);
      events.push({ type: "zoneExpired", zoneId: zone.id });
    }
  }

  return { state: { ...state, entities, grid, zones: survivors }, events };
}

/**
 * The aura pass: each living entity's aura passives act as a zone centred on it — allies-auras
 * (owner included) or enemies-auras by team, same beat as `tickZones`. Auras live on the entity,
 * so they need no duration bookkeeping and vanish with their owner.
 */
export function tickAuras(state: GameState): { state: GameState; events: GameEvent[] } {
  const owners: Entity[] = [];
  for (const e of state.entities.values()) {
    if (!e.dead && e.passives?.some((p) => p.type === "aura")) owners.push(e);
  }
  if (owners.length === 0) return { state, events: [] };

  const events: GameEvent[] = [];
  const entities = new Map(state.entities);
  for (const owner of owners) {
    for (const passive of owner.passives!) {
      if (passive.type !== "aura") continue;
      const aura = passive.aura;
      for (const entity of entities.values()) {
        if (entity.dead) continue;
        const isAlly = entity.teamId === owner.teamId;
        if (aura.affects === "allies" ? !isAlly : isAlly) continue;
        // Radius is measured from the owner's live position this turn.
        const anchor = entities.get(owner.id)!;
        if (distance(anchor.position, entity.position) > aura.radius + entity.collisionRadius) continue;
        const { entity: next, event } = applyAreaEffectToEntity(aura.effect, aura.magnitude, entity);
        if (!event) continue;
        entities.set(entity.id, next);
        if (next.dead) {
          events.push({ type: "collision", entityId: entity.id, at: entity.position, damage: aura.magnitude, killed: true });
        } else {
          events.push({ type: "auraTick", ownerId: owner.id, entityId: entity.id, effect: aura.effect, magnitude: aura.magnitude });
        }
      }
    }
  }
  return { state: { ...state, entities }, events };
}
