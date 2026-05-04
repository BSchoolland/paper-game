import { Container } from "pixi.js";
import type { Entity, GameEvent, GameState } from "shared";
import { EntityVisual } from "./entity-renderer.js";

const FOOT_OFFSET = 272 * 0.2 * (1 - 0.75);

export class EntityManager {
  private visuals = new Map<string, EntityVisual>();
  private pendingEvents: GameEvent[] = [];

  constructor(private layer: Container) {}

  setLayer(layer: Container) {
    for (const visual of this.visuals.values()) {
      this.layer.removeChild(visual.container);
      layer.addChild(visual.container);
    }
    this.layer = layer;
  }

  pushEvents(events: readonly GameEvent[]) {
    this.pendingEvents.push(...events);
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

      visual.update(entity, entity.id === selectedEntityId, 0);
    }

    for (const event of this.pendingEvents) {
      this.applyEvent(event, state);
    }
    this.pendingEvents.length = 0;
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

  private applyEvent(event: GameEvent, state: GameState) {
    switch (event.type) {
      case "move": {
        const visual = this.visuals.get(event.entityId);
        if (visual) {
          visual.triggerMove(event.from.x, event.from.y, event.to.x, event.to.y);
        }
        break;
      }
      case "attack": {
        const visual = this.visuals.get(event.attackerId);
        if (visual) {
          const firstHit = event.hits[0];
          const targetEntity = firstHit ? state.entities.get(firstHit.targetId) : null;
          const aimX = targetEntity
            ? targetEntity.position.x
            : visual.container.position.x + 100;
          visual.triggerAttack(aimX);
        }

        for (const hit of event.hits) {
          const targetVisual = this.visuals.get(hit.targetId);
          if (targetVisual) {
            targetVisual.triggerHit();
          }
        }
        break;
      }
    }
  }
}
