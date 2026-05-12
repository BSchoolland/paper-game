export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Raw (unnormalized) vector from entity to target. Consumers normalize internally. */
export type AimDirection = Vec2;

export type TeamId = "red" | "blue";
export type EntityId = string;

export interface GridState {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly walls: Uint8Array;
}

export const enum ShapeKind {
  Sector = "sector",
  Rectangle = "rectangle",
  Circle = "circle",
  Point = "point",
}

export type CombatShapeDefinition =
  | { kind: ShapeKind.Sector; radius: number; halfAngle: number }
  | { kind: ShapeKind.Rectangle; length: number; width: number }
  | { kind: ShapeKind.Circle; radius: number; range: number }
  | { kind: ShapeKind.Point; range: number };

export type StatusEffectType = "slowed" | "winded" | "suppressed";

export interface StatusEffect {
  readonly type: StatusEffectType;
  readonly duration: number;
  readonly value: number;
}

export type WeaponEffect =
  | { type: "pull"; distance: number }
  | { type: "applyStatus"; status: StatusEffectType; duration: number; value: number };

// --- Attack Visuals (client-side rendering hints, fully JSON-serializable) ---

export type TrailEffect = "slash" | "thrust" | "projectile" | "explosion" | "splash";

export interface AttackVisual {
  readonly color?: number;
  readonly trailEffect?: TrailEffect;
  readonly screenShake?: number;
}

// --- Ability System ---

export interface EnergyCost {
  readonly red?: number;
  readonly blue?: number;
}

export interface EnergyPool {
  readonly red: number;
  readonly blue: number;
  /** Amount added to each pool at the start of the owner's turn (clamped to the cap). */
  readonly regenRed: number;
  readonly regenBlue: number;
  /** Cap each pool can bank up to. */
  readonly maxRed: number;
  readonly maxBlue: number;
}

interface AbilityBase {
  readonly id: string;
  readonly name: string;
  readonly cost: EnergyCost;
  readonly variableCost?: boolean;
}

export interface AttackAbility extends AbilityBase {
  readonly kind: "attack";
  readonly shape: CombatShapeDefinition;
  readonly damage: number;
  /** Distance the target is pushed away from the attacker on hit. Set to 0 for no knockback. */
  readonly knockback: number;
  /** Distance the attacker is shoved backward (opposite the aim direction) after the attack, hit or not. */
  readonly recoil?: number;
  /** If the attack connects, the attacker advances this far along the aim line — lunging past the target. */
  readonly lungeThrough?: number;
  readonly ignoreCoverRange?: number;
  readonly onHit?: readonly WeaponEffect[];
  readonly visual?: AttackVisual;
}

export interface MoveAbility extends AbilityBase {
  readonly kind: "move";
  readonly distance: number;
}

export interface BarrierAbility extends AbilityBase {
  readonly kind: "barrier";
  readonly barrierHp: number;
}

export type AbilityDefinition = AttackAbility | MoveAbility | BarrierAbility;


export interface EntityCore {
  readonly id: EntityId;
  readonly name: string;
  readonly position: Vec2;
  readonly collisionRadius: number;
  readonly teamId: TeamId;
}

export interface EntityCombat {
  readonly hp: number;
  readonly maxHp: number;
  readonly barrier: number;
  readonly energy: EnergyPool;
  readonly abilities: readonly AbilityDefinition[];
  readonly effects?: readonly EntityEffect[];
  readonly statusEffects?: readonly StatusEffect[];
  readonly dead?: boolean;
}

export interface SpriteSet {
  readonly idle: string;
  readonly attack: string;
  readonly hit: string;
  readonly move: string;
}

export interface EntityVisuals {
  readonly sprites?: SpriteSet;
  readonly playerAnimSet?: import("./items.js").AnimSet;
  readonly spriteScale?: number;
  readonly heightMeters?: number;
}

export interface EntityAi {
  readonly strategy?: AiStrategyType;
}

export interface EntityEquipment {
  readonly equipped?: readonly import("./items.js").ItemDefinition[];
  readonly attachments?: Record<string, import("../core/inventory.js").AttachmentData>;
}

export interface Entity extends EntityCore, EntityCombat, EntityVisuals, EntityAi, EntityEquipment {}

export interface GameState {
  readonly entities: ReadonlyMap<EntityId, Entity>;
  readonly grid: GridState;
  readonly mapDefinition: import("../map/map-definition.js").MapDefinition;
  readonly activeTeam: TeamId;
  readonly turnNumber: number;
  readonly winner: TeamId | null;
  readonly nextSpawnId: number;
  readonly actionCount: number;
}

export type PlayerAction =
  | { type: "ability"; entityId: EntityId; abilityId: string; aimDirection?: AimDirection; destination?: Vec2 }
  | { type: "endTurn" };

export type GameEvent =
  | { type: "move"; entityId: EntityId; from: Vec2; to: Vec2 }
  | {
      type: "attack";
      attackerId: EntityId;
      attackerPosition: Vec2;
      aimDirection: AimDirection;
      ability: AttackAbility;
      hits: readonly AttackHit[];
    }
  | { type: "barrier"; entityId: EntityId; barrierHp: number }
  | { type: "endTurn"; nextTeam: TeamId }
  | { type: "turnStart"; team: TeamId }
  | { type: "spawn"; entityId: EntityId; position: Vec2; templateKey: string }
  | { type: "knockback"; entityId: EntityId; from: Vec2; to: Vec2 }
  | { type: "pull"; entityId: EntityId; from: Vec2; to: Vec2 }
  | { type: "statusApplied"; entityId: EntityId; status: StatusEffect };

export interface AttackHit {
  readonly targetId: EntityId;
  readonly damage: number;
  readonly killed: boolean;
}

export type EffectTrigger = "onDeath";

export type EffectAction =
  | { type: "spawn"; templateKey: string; count: number };

export interface EntityEffect {
  readonly trigger: EffectTrigger;
  readonly action: EffectAction;
}

export interface ActionResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export const ENEMY_TAGS = [
  "melee",
  "ranged",
  "tank",
  "swarm",
  "elite",
  "boss",
] as const;

export type EnemyTag = (typeof ENEMY_TAGS)[number];

export type AiStrategyType = "rush" | "kite" | "threat";

export interface UnitTemplate {
  readonly abilities: readonly AbilityDefinition[];
  readonly hp: number;
  readonly energy: { red: number; blue: number };
  readonly collisionRadius: number;
  readonly className: string;
  readonly sprites?: SpriteSet;
  readonly spriteScale?: number;
  readonly heightMeters?: number;
  readonly strategy?: AiStrategyType;
  readonly effects?: readonly EntityEffect[];
  readonly cost?: number;
  readonly tags?: readonly EnemyTag[];
}
