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

export type StatusEffectType = "slowed" | "winded" | "suppressed" | "rooted";

export interface StatusEffect {
  readonly type: StatusEffectType;
  readonly duration: number;
  readonly value: number;
}

export type WeaponEffect =
  | { type: "pull"; distance: number }
  | { type: "applyStatus"; status: StatusEffectType; duration: number; value: number }
  /** Attacker and target trade places (both spots must be standable). Meant for point-shape single-target abilities. */
  | { type: "swap" };

/**
 * Conditional bonus damage evaluated per target against the pre-damage state. `label` surfaces
 * as floating text on hits where the rider fired, so the condition reads on screen.
 */
export type DamageRider =
  | { readonly when: "target-has-status"; readonly status: StatusEffectType; readonly amount: number; readonly label?: string }
  | { readonly when: "target-below-hp"; readonly pct: number; readonly amount: number; readonly label?: string }
  | { readonly when: "target-at-full-hp"; readonly amount: number; readonly label?: string }
  | { readonly when: "target-near-wall"; readonly within: number; readonly amount: number; readonly label?: string };

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
  /** Charges per encounter. Remaining counts live in `Entity.abilityUses`; omit for unlimited. */
  readonly uses?: number;
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
  /** Bonus damage dealt to a knocked-back target whose knockback was cut short by a wall, edge, or another entity. */
  readonly wallSlamDamage?: number;
  readonly ignoreCoverRange?: number;
  readonly onHit?: readonly WeaponEffect[];
  /** Conditional bonus damage, evaluated per target before the hit lands. */
  readonly riders?: readonly DamageRider[];
  /** Energy refunded to the attacker per kill this attack scores. */
  readonly onKill?: EnergyCost;
  readonly visual?: AttackVisual;
}

export interface MoveAbility extends AbilityBase {
  readonly kind: "move";
  readonly distance: number;
  /** "blink" teleports straight to the destination (must be standable), ignoring walls and bodies in between. */
  readonly mode?: "walk" | "blink";
}

export interface BarrierAbility extends AbilityBase {
  readonly kind: "barrier";
  readonly barrierHp: number;
}

/**
 * A persistent area effect dropped on the battlefield. Named purely by what it does, not by
 * theme — give it a `color` and a "fire" zone is a "toxic" zone. `damage`/`heal`/`addBarrier`/
 * `drainRed`/`drainBlue` apply to every entity standing inside at the start of each turn;
 * `cover` and `wall` stamp the collision grid for as long as the zone lives (a `wall` may not
 * be dropped on top of an entity or an existing wall, the others may go anywhere).
 */
export type ZoneEffectKind =
  | "damage"
  | "heal"
  | "addBarrier"
  | "drainRed"
  | "drainBlue"
  | "cover"
  | "wall";

/**
 * Decorative motif painted over a zone disc to telegraph its intent — purely cosmetic, like
 * `AttackVisual.trailEffect`. If omitted the renderer falls back to a sensible default for the
 * zone's effect kind, but it can be overridden freely (a green "spikes" zone reads as poison).
 */
export type ZonePattern = "spikes" | "pulse" | "shield" | "drain" | "lattice" | "solid";

export interface ZoneSpec {
  readonly effect: ZoneEffectKind;
  readonly radius: number;
  /** Turns the zone persists (decremented at the start of every turn). */
  readonly duration: number;
  /** Damage / heal / barrier amount, or the status `value` for drain zones. Ignored by `cover`/`wall`. */
  readonly magnitude: number;
  /** Rendering tint only — the mechanic is fixed, the look is not. */
  readonly color: number;
  /** Decorative motif; defaults per effect kind if unset. */
  readonly pattern?: ZonePattern;
}

export interface ZoneAbility extends AbilityBase {
  readonly kind: "zone";
  /** How far from the caster the zone's centre may be placed. */
  readonly range: number;
  readonly zone: ZoneSpec;
}

/** Spawn `count` allied units of `templateKey` around a point within `range`. The template must
 *  exist in the active template registry — resolution throws on a missing key (content bug). */
export interface SummonAbility extends AbilityBase {
  readonly kind: "summon";
  readonly templateKey: string;
  readonly count: number;
  readonly range: number;
}

/** Pay `cost`, credit `gain` to the caster's pools (clamped to the bank caps). */
export interface ConvertAbility extends AbilityBase {
  readonly kind: "convert";
  readonly gain: EnergyCost;
}

/** Instantly restore the caster's own hp and/or energy (clamped to caps). */
export interface RestoreAbility extends AbilityBase {
  readonly kind: "restore";
  readonly hp?: number;
  readonly red?: number;
  readonly blue?: number;
}

export type AbilityDefinition =
  | AttackAbility
  | MoveAbility
  | BarrierAbility
  | ZoneAbility
  | SummonAbility
  | ConvertAbility
  | RestoreAbility;

/** Zone effects an aura may carry — everything except the grid-stamping kinds. */
export type AuraEffectKind = Exclude<ZoneEffectKind, "cover" | "wall">;

/**
 * A zone glued to its owner: every turn-start it applies `effect` to living entities within
 * `radius` of the owner. `affects: "allies"` includes the owner; `"enemies"` is the other team.
 */
export interface AuraSpec {
  readonly effect: AuraEffectKind;
  readonly radius: number;
  readonly magnitude: number;
  readonly color: number;
  readonly pattern?: ZonePattern;
  readonly affects: "allies" | "enemies";
}

/**
 * Always-on rules an item grants its wearer. `maxHp`/`regen` are baked into the entity at
 * encounter build; `aura`/`onKillEnergy` ride on the entity and act during resolution.
 */
export type PassiveEffect =
  | { readonly type: "aura"; readonly aura: AuraSpec }
  | { readonly type: "onKillEnergy"; readonly red?: number; readonly blue?: number }
  | { readonly type: "maxHp"; readonly amount: number }
  | { readonly type: "regen"; readonly red?: number; readonly blue?: number };

export interface Zone {
  readonly id: string;
  readonly effect: ZoneEffectKind;
  readonly center: Vec2;
  readonly radius: number;
  /** Turns left before the zone disappears. */
  readonly remaining: number;
  readonly magnitude: number;
  readonly color: number;
  readonly pattern?: ZonePattern;
  /**
   * For `cover`/`wall` zones: the grid cells this zone stamped and the value each held before,
   * so the stamp can be reverted when the zone expires.
   */
  readonly stampedCells?: readonly { readonly index: number; readonly previous: number }[];
}


export interface EntityCore {
  readonly id: EntityId;
  readonly name: string;
  readonly position: Vec2;
  /** Hurtbox radius: what attack shapes hit, and the body's physical size. */
  readonly collisionRadius: number;
  /** Optional smaller radius used only for movement/occupancy (pathing, standing, click-snapping),
   *  so a unit can slip through gaps and stop in spots tighter than its hurtbox. Defaults to
   *  `collisionRadius` when unset — resolve via `moveRadiusOf`. */
  readonly moveRadius?: number;
  readonly teamId: TeamId;
  /**
   * The co-op seat that controls this hero (`"s0".."s3"`). Undefined for enemies and for
   * legacy single-seat play. Orthogonal to {@link teamId} (`"red"` is the whole player party).
   * The pure combat resolver never reads this — it is ownership metadata for the server Room
   * and the client, and round-trips through serialization for free (entities are copied whole).
   */
  readonly controllerId?: string;
}

export interface EntityCombat {
  readonly hp: number;
  readonly maxHp: number;
  readonly barrier: number;
  readonly energy: EnergyPool;
  readonly abilities: readonly AbilityDefinition[];
  readonly effects?: readonly EntityEffect[];
  readonly statusEffects?: readonly StatusEffect[];
  /** Remaining charges for abilities that declare `uses`, keyed by ability id. */
  readonly abilityUses?: Readonly<Record<string, number>>;
  /** Always-on rules from equipped items (auras, on-kill refunds). */
  readonly passives?: readonly PassiveEffect[];
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
  readonly zones: readonly Zone[];
  readonly nextZoneId: number;
}

export type PlayerAction =
  | { type: "ability"; entityId: EntityId; abilityId: string; aimDirection?: AimDirection; destination?: Vec2; power?: number }
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
  | { type: "barrier"; entityId: EntityId; barrierHp: number; ability: BarrierAbility }
  | { type: "endTurn"; nextTeam: TeamId }
  | { type: "turnStart"; team: TeamId }
  | { type: "spawn"; entityId: EntityId; position: Vec2; templateKey: string }
  | { type: "knockback"; entityId: EntityId; from: Vec2; to: Vec2 }
  | { type: "pull"; entityId: EntityId; from: Vec2; to: Vec2 }
  | { type: "statusApplied"; entityId: EntityId; status: StatusEffect }
  /** A knockback/pull was cut short by an obstacle and the entity slammed into it for `damage`. */
  | { type: "collision"; entityId: EntityId; at: Vec2; damage: number; killed: boolean }
  | { type: "zoneCreated"; zone: Zone }
  | { type: "zoneExpired"; zoneId: string }
  /** A zone applied its per-turn effect to an entity standing inside it. */
  | { type: "zoneTick"; zoneId: string; entityId: EntityId; effect: ZoneEffectKind; magnitude: number }
  /** Instant relocation (blink move, swap) — renderers fade rather than walk. */
  | { type: "blink"; entityId: EntityId; from: Vec2; to: Vec2 }
  /** The entity recovered hp/energy (consumable, conversion, on-kill refund). */
  | { type: "restore"; entityId: EntityId; hp: number; red: number; blue: number; reason: "consume" | "convert" | "onKill" }
  /** An aura applied its per-turn effect to an entity within its owner's radius. */
  | { type: "auraTick"; ownerId: EntityId; entityId: EntityId; effect: AuraEffectKind; magnitude: number };

export interface AttackHit {
  readonly targetId: EntityId;
  readonly damage: number;
  readonly killed: boolean;
  /** When set, the target's timed-defense tier — "perfect" fully negates, "decent" reduces. */
  readonly defenseTier?: "perfect" | "decent";
  /** Labels of damage riders that fired on this hit, for on-screen callouts. */
  readonly riderLabels?: readonly string[];
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

export type AiStrategyType = "rush" | "kite" | "threat" | "smart" | "crazy" | "crafty" | "genius";

export interface UnitTemplate {
  readonly abilities: readonly AbilityDefinition[];
  readonly hp: number;
  readonly energy: { red: number; blue: number };
  readonly collisionRadius: number;
  /** Optional movement/occupancy radius (see {@link EntityCore.moveRadius}). Defaults to
   *  `collisionRadius`. */
  readonly moveRadius?: number;
  readonly className: string;
  readonly sprites?: SpriteSet;
  readonly spriteScale?: number;
  readonly heightMeters?: number;
  readonly strategy?: AiStrategyType;
  readonly effects?: readonly EntityEffect[];
  readonly cost?: number;
  readonly tags?: readonly EnemyTag[];
  /** Multiplier on per-turn regen to compute the bank cap. Default 2 (= bank 2 turns' worth).
   *  Set to 1 for "use-it-or-lose-it" energy — entities can't stockpile across turns. */
  readonly energyBankFactor?: number;
}
