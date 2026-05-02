import { Container, Graphics, Text } from "pixi.js";
import type { Entity } from "shared";

const TEAM_COLORS = {
  red: 0xcc4444,
  blue: 0x4488cc,
} as const;

const TEAM_COLORS_DIM = {
  red: 0x883333,
  blue: 0x335577,
} as const;

const HEALTH_BAR_WIDTH = 36;
const HEALTH_BAR_HEIGHT = 4;
const HEALTH_BAR_OFFSET = -28;

export function createEntityGraphics(
  entity: Entity,
  isSelected: boolean
): Container {
  const container = new Container();
  container.position.set(entity.position.x, entity.position.y);

  const canAct =
    entity.actionsRemaining > 0 || entity.movementRemaining > 1;
  const bodyColor = canAct
    ? TEAM_COLORS[entity.teamId]
    : TEAM_COLORS_DIM[entity.teamId];

  const body = new Graphics();
  body.circle(0, 0, entity.collisionRadius);
  body.fill({ color: bodyColor });

  if (isSelected) {
    body.circle(0, 0, entity.collisionRadius + 3);
    body.stroke({ color: 0xffcc00, width: 2 });
  }

  container.addChild(body);

  const hpBg = new Graphics();
  hpBg.rect(
    -HEALTH_BAR_WIDTH / 2,
    HEALTH_BAR_OFFSET,
    HEALTH_BAR_WIDTH,
    HEALTH_BAR_HEIGHT
  );
  hpBg.fill({ color: 0x333333 });
  container.addChild(hpBg);

  const hpFill = new Graphics();
  const hpRatio = entity.hp / entity.maxHp;
  const hpColor =
    hpRatio > 0.5 ? 0x44bb44 : hpRatio > 0.25 ? 0xccaa22 : 0xcc3333;
  hpFill.rect(
    -HEALTH_BAR_WIDTH / 2,
    HEALTH_BAR_OFFSET,
    HEALTH_BAR_WIDTH * hpRatio,
    HEALTH_BAR_HEIGHT
  );
  hpFill.fill({ color: hpColor });
  container.addChild(hpFill);

  const label = new Text({
    text: entity.name,
    style: { fontSize: 10, fill: 0xcccccc },
  });
  label.anchor.set(0.5);
  label.position.set(0, entity.collisionRadius + 10);
  container.addChild(label);

  return container;
}
