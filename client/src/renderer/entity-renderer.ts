import { Container, Graphics, Text } from "pixi.js";
import type { Entity } from "shared";

const TEAM_FILLS = {
  red: { body: 0xc0392b, rim: 0xe74c3c, dim: 0x7b2420 },
  blue: { body: 0x2980b9, rim: 0x3498db, dim: 0x1a5276 },
} as const;

const WEAPON_ICONS: Record<string, { symbol: string; color: number }> = {
  "short-sword": { symbol: "⚔", color: 0xffcc00 },
  spear: { symbol: "↑", color: 0xff8844 },
  bow: { symbol: "→", color: 0x44ccff },
};

const HP_BAR_W = 40;
const HP_BAR_H = 5;
const HP_BAR_Y = -30;

export function createEntityGraphics(
  entity: Entity,
  isSelected: boolean
): Container {
  const container = new Container();
  container.position.set(entity.position.x, entity.position.y);

  const canAct = entity.actionsRemaining > 0 || entity.movementRemaining > 1;
  const team = TEAM_FILLS[entity.teamId];
  const bodyColor = canAct ? team.body : team.dim;
  const r = entity.collisionRadius;

  const shadow = new Graphics();
  shadow.ellipse(1, 3, r + 1, r * 0.5);
  shadow.fill({ color: 0x000000, alpha: 0.25 });
  container.addChild(shadow);

  const body = new Graphics();
  const weaponId = entity.weapon.id;

  if (weaponId === "spear") {
    body.roundRect(-r, -r, r * 2, r * 2, 4);
    body.fill({ color: bodyColor });
    body.roundRect(-r, -r, r * 2, r * 2, 4);
    body.stroke({ color: team.rim, width: 1.5, alpha: 0.6 });
  } else if (weaponId === "bow") {
    body.moveTo(0, -r);
    body.lineTo(r * 0.87, r * 0.5);
    body.lineTo(-r * 0.87, r * 0.5);
    body.closePath();
    body.fill({ color: bodyColor });
    body.moveTo(0, -r);
    body.lineTo(r * 0.87, r * 0.5);
    body.lineTo(-r * 0.87, r * 0.5);
    body.closePath();
    body.stroke({ color: team.rim, width: 1.5, alpha: 0.6 });
  } else {
    body.circle(0, 0, r);
    body.fill({ color: bodyColor });
    body.circle(0, 0, r);
    body.stroke({ color: team.rim, width: 1.5, alpha: 0.6 });
  }

  if (isSelected) {
    body.circle(0, 0, r + 4);
    body.stroke({ color: 0xf1c40f, width: 2.5 });
  }

  container.addChild(body);

  const icon = WEAPON_ICONS[weaponId];
  if (icon) {
    const iconText = new Text({
      text: icon.symbol,
      style: { fontSize: 12, fill: icon.color, fontFamily: "serif" },
    });
    iconText.anchor.set(0.5);
    iconText.position.set(0, -1);
    container.addChild(iconText);
  }

  const hpBg = new Graphics();
  hpBg.roundRect(-HP_BAR_W / 2 - 1, HP_BAR_Y - 1, HP_BAR_W + 2, HP_BAR_H + 2, 2);
  hpBg.fill({ color: 0x1a1a1a, alpha: 0.8 });
  container.addChild(hpBg);

  const hpRatio = entity.hp / entity.maxHp;
  const hpColor = hpRatio > 0.6 ? 0x27ae60 : hpRatio > 0.3 ? 0xf39c12 : 0xe74c3c;

  const hpFill = new Graphics();
  hpFill.roundRect(-HP_BAR_W / 2, HP_BAR_Y, HP_BAR_W * hpRatio, HP_BAR_H, 1);
  hpFill.fill({ color: hpColor });
  container.addChild(hpFill);

  const label = new Text({
    text: entity.name,
    style: {
      fontSize: 9,
      fill: 0xbfae98,
      fontFamily: "monospace",
    },
  });
  label.anchor.set(0.5);
  label.position.set(0, r + 12);
  container.addChild(label);

  return container;
}
