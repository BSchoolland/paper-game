import { Container } from "pixi.js";
import type { Entity, GameState } from "shared";
import { EntityVisual } from "./entity-renderer.js";

const FOOT_OFFSET = 272 * 0.2 * (1 - 0.75);

export class EntityManager {
  private visuals = new Map<string, EntityVisual>();
  private previousEntities = new Map<string, Entity>();

  constructor(private layer: Container) {}

  setLayer(layer: Container) {
    for (const visual of this.visuals.values()) {
      this.layer.removeChild(visual.container);
      layer.addChild(visual.container);
    }
    this.layer = layer;
  }

  sync(state: GameState, selectedEntityId: string | null) {
    const currentEntities = state.entities;

    for (const [id, visual] of this.visuals) {
      if (!currentEntities.has(id)) {
        this.layer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        this.visuals.delete(id);
      }
    }

    for (const [id, entity] of currentEntities) {
      let visual = this.visuals.get(id);

      if (!visual) {
        visual = new EntityVisual(entity);
        this.visuals.set(id, visual);
        this.layer.addChild(visual.container);
      }

      const prev = this.previousEntities.get(id);
      if (prev) {
        this.triggerAnimations(visual, prev, entity, currentEntities);
      }

      visual.update(entity, entity.id === selectedEntityId, 0);
    }

    this.previousEntities = new Map(currentEntities);
  }

  tick(state: GameState, selectedEntityId: string | null, dt: number) {
    for (const [id, visual] of this.visuals) {
      const entity = state.entities.get(id);
      if (!entity) continue;
      visual.update(entity, id === selectedEntityId, dt);
    }
  }

  depthSort() {
    for (const visual of this.visuals.values()) {
      visual.container.zIndex = visual.container.position.y + FOOT_OFFSET;
    }
  }

  private triggerAnimations(
    visual: EntityVisual,
    prev: Entity,
    entity: Entity,
    entities: ReadonlyMap<string, Entity>
  ) {
    const dx = entity.position.x - prev.position.x;
    const dy = entity.position.y - prev.position.y;
    if (dx * dx + dy * dy > 1) {
      visual.triggerMove(
        prev.position.x,
        prev.position.y,
        entity.position.x,
        entity.position.y
      );
    }

    if (entity.hp < prev.hp) {
      visual.triggerHit();
    }

    if (
      entity.actionsRemaining < prev.actionsRemaining &&
      prev.actionsRemaining > 0
    ) {
      const aimX = this.findAttackTarget(entity, entities);
      visual.triggerAttack(aimX);
    }
  }

  private findAttackTarget(
    attacker: Entity,
    entities: ReadonlyMap<string, Entity>
  ): number {
    let closestDist = Infinity;
    let closestX = attacker.position.x + 100;
    for (const e of entities.values()) {
      if (e.teamId === attacker.teamId || e.id === attacker.id) continue;
      const dx = e.position.x - attacker.position.x;
      const dy = e.position.y - attacker.position.y;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closestX = e.position.x;
      }
    }
    return closestX;
  }
}
