import type { AimDirection, AttackAbility, AttackHit, DamageRider, Entity, GameState, GridState } from "../core/types.js";
import { entitiesInShape } from "../geometry/index.js";
import { CELL_WALL } from "../map/collision-grid.js";
import { hasStatus } from "./status-modifiers.js";

export interface DamageResult {
  readonly state: GameState;
  readonly hits: readonly AttackHit[];
}

export function resolveWeaponAttack(
  attacker: Entity,
  aimDirection: AimDirection,
  entities: ReadonlyMap<string, Entity>,
  ability: Pick<AttackAbility, "shape" | "ignoreCoverRange">,
  grid: GridState
): Entity[] {
  const hits = entitiesInShape(
    attacker.position,
    aimDirection,
    ability.shape,
    entities,
    grid,
    attacker.id,
    ability.ignoreCoverRange
  );
  return hits.filter((e) => e.teamId !== attacker.teamId);
}

/** True if any wall cell's centre lies within `within` px of `pos`. */
export function nearWall(grid: GridState, pos: { x: number; y: number }, within: number): boolean {
  const cs = grid.cellSize;
  const minCx = Math.max(0, Math.floor((pos.x - within) / cs));
  const maxCx = Math.min(grid.width - 1, Math.floor((pos.x + within) / cs));
  const minCy = Math.max(0, Math.floor((pos.y - within) / cs));
  const maxCy = Math.min(grid.height - 1, Math.floor((pos.y + within) / cs));
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (grid.walls[cy * grid.width + cx] !== CELL_WALL) continue;
      const px = (cx + 0.5) * cs;
      const py = (cy + 0.5) * cs;
      if ((px - pos.x) ** 2 + (py - pos.y) ** 2 <= within * within) return true;
    }
  }
  return false;
}

export interface RiderBonus {
  readonly amount: number;
  readonly labels: readonly string[];
}

function riderLabel(rider: DamageRider): string {
  if (rider.label) return rider.label;
  switch (rider.when) {
    case "target-has-status": return rider.status.toUpperCase();
    case "target-below-hp": return "EXECUTE";
    case "target-at-full-hp": return "FIRST BLOOD";
    case "target-near-wall": return "CORNERED";
  }
}

/** Evaluate an attack's conditional riders against a target's pre-damage state. */
export function evaluateRiders(
  riders: readonly DamageRider[],
  target: Entity,
  grid: GridState
): RiderBonus {
  let amount = 0;
  const labels: string[] = [];
  for (const rider of riders) {
    let fires = false;
    switch (rider.when) {
      case "target-has-status":
        fires = hasStatus(target, rider.status);
        break;
      case "target-below-hp":
        fires = target.hp / target.maxHp < rider.pct;
        break;
      case "target-at-full-hp":
        fires = target.hp >= target.maxHp && target.barrier === 0;
        break;
      case "target-near-wall":
        fires = nearWall(grid, target.position, rider.within);
        break;
    }
    if (fires) {
      amount += rider.amount;
      labels.push(riderLabel(rider));
    }
  }
  return { amount, labels };
}

export function applyDamage(
  state: GameState,
  targets: Entity[],
  damage: number,
  defenseMap?: ReadonlyMap<string, number>,
  riderBonuses?: ReadonlyMap<string, RiderBonus>
): DamageResult {
  const entities = new Map(state.entities);

  const hits: AttackHit[] = [];
  for (const target of targets) {
    const defenseMult = defenseMap?.get(target.id) ?? 1;
    const bonus = riderBonuses?.get(target.id);
    const effectiveDamage = Math.round((damage + (bonus?.amount ?? 0)) * defenseMult);
    const barrierAbsorbed = Math.min(target.barrier, effectiveDamage);
    const remainingDamage = effectiveDamage - barrierAbsorbed;
    const newBarrier = target.barrier - barrierAbsorbed;
    const newHp = target.hp - remainingDamage;
    const killed = newHp <= 0;
    const defenseTier: AttackHit["defenseTier"] =
      defenseMult === 0 ? "perfect" :
      defenseMult < 1 ? "decent" :
      undefined;
    hits.push({
      targetId: target.id,
      damage: effectiveDamage,
      killed,
      ...(defenseTier ? { defenseTier } : {}),
      ...(bonus && bonus.labels.length > 0 ? { riderLabels: bonus.labels } : {}),
    });
    if (killed) {
      entities.set(target.id, { ...target, hp: 0, barrier: 0, dead: true });
    } else {
      entities.set(target.id, { ...target, hp: newHp, barrier: newBarrier });
    }
  }
  return { state: { ...state, entities }, hits };
}
