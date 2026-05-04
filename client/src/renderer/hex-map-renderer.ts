import { Application, Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { HexCoord, HexMapState, HexStatus } from "shared";
import { hexToPixel, parseHexKey, pixelToHex, hexKey, isAdjacent } from "shared";
import { PENCIL, PENCIL_LIGHT, seededRand } from "./sketch-utils.js";
import { getSpriteTexture } from "./sprite-assets.js";

const HEX_SIZE = 48;
const SPRITE_SCALE = 0.27;
const MOVE_SPEED = 1.2;

const PLAYER_COLOR = 0x8b6d30;
const HOVER_COLOR = 0xd4a850;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

function coordSeed(q: number, r: number): number {
  return ((q * 7919 + r * 104729 + 31) & 0xffffffff) >>> 0;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

const PATH_COLOR = 0x8b3a3a;
const DASH_LENGTH = 8;
const GAP_LENGTH = 6;

export class HexMapRenderer {
  private bgSprite: Sprite | null = null;
  private worldContainer = new Container();
  private pathLayer = new Graphics();
  private hexContainer = new Container();
  private playerSprite: Sprite;
  private playerMoveSprite: Sprite;
  private hoverCoord: HexCoord | null = null;
  private mapState: HexMapState | null = null;
  private onHexClickCallback: ((coord: HexCoord) => void) | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private pathHistory: { x: number; y: number }[] = [];

  private tweenFrom: { x: number; y: number } | null = null;
  private tweenTo: { x: number; y: number } | null = null;
  private tweenProgress = 1;
  private animating = false;
  private pendingCallbacks: (() => void)[] = [];

  constructor(private app: Application) {
    const idleTex = getSpriteTexture("red", "warrior", "idle");
    this.playerSprite = new Sprite(idleTex);
    this.playerSprite.anchor.set(0.5, 0.75);
    this.playerSprite.scale.set(SPRITE_SCALE);

    const moveTex = getSpriteTexture("red", "warrior", "move");
    this.playerMoveSprite = new Sprite(moveTex);
    this.playerMoveSprite.anchor.set(0.5, 0.75);
    this.playerMoveSprite.scale.set(SPRITE_SCALE);
    this.playerMoveSprite.visible = false;
  }

  init() {
    const bgTex: Texture = Assets.get("map-background");
    this.bgSprite = new Sprite(bgTex);
    this.bgSprite.anchor.set(0.5);
    this.app.stage.addChild(this.bgSprite);

    this.worldContainer.addChild(this.pathLayer);
    this.worldContainer.addChild(this.hexContainer);
    this.worldContainer.addChild(this.playerSprite);
    this.worldContainer.addChild(this.playerMoveSprite);
    this.app.stage.addChild(this.worldContainer);

    this.app.ticker.add((ticker) => {
      if (!this.animating) return;
      const dt = ticker.deltaTime / 60;
      this.tickTween(dt);
    });

    this.app.canvas.addEventListener("mousemove", (e) => {
      const world = this.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      const prev = this.hoverCoord;
      if (!prev || prev.q !== coord.q || prev.r !== coord.r) {
        this.hoverCoord = coord;
        if (this.mapState && !this.animating) this.drawHexes();
      }
    });

    this.app.canvas.addEventListener("click", (e) => {
      if (!this.mapState || !this.onHexClickCallback || this.animating) return;
      const world = this.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      this.onHexClickCallback(coord);
    });
  }

  onHexClick(cb: (coord: HexCoord) => void) {
    this.onHexClickCallback = cb;
  }

  show() {
    if (this.bgSprite) this.bgSprite.visible = true;
    this.worldContainer.visible = true;
  }

  hide() {
    if (this.bgSprite) this.bgSprite.visible = false;
    this.worldContainer.visible = false;
  }

  isMoving(): boolean {
    return this.animating;
  }

  onMoveComplete(cb: () => void) {
    if (!this.animating) {
      cb();
    } else {
      this.pendingCallbacks.push(cb);
    }
  }

  animateMoveTo(target: HexCoord) {
    if (!this.mapState) return;
    const from = hexToPixel(this.mapState.playerPos, HEX_SIZE);
    const to = hexToPixel(target, HEX_SIZE);

    this.pathHistory.push(to);

    this.tweenFrom = from;
    this.tweenTo = to;
    this.tweenProgress = 0;
    this.animating = true;

    if (to.x < from.x) {
      this.playerMoveSprite.scale.x = -SPRITE_SCALE;
    } else {
      this.playerMoveSprite.scale.x = SPRITE_SCALE;
    }

    this.playerSprite.visible = false;
    this.playerMoveSprite.visible = true;
    this.playerMoveSprite.position.set(from.x, from.y);
  }

  render(state: HexMapState) {
    this.mapState = state;
    this.layout();

    const px = hexToPixel(state.playerPos, HEX_SIZE);
    if (this.pathHistory.length === 0) {
      this.pathHistory.push(px);
    }

    this.drawHexes();
    this.drawPath();
    if (!this.animating) {
      this.playerSprite.position.set(px.x, px.y);
      this.playerSprite.visible = true;
      this.playerMoveSprite.visible = false;
    }
  }

  private tickTween(dt: number) {
    if (!this.tweenFrom || !this.tweenTo) return;

    this.tweenProgress = Math.min(1, this.tweenProgress + dt * MOVE_SPEED);
    const t = easeInOutQuad(this.tweenProgress);

    const x = this.tweenFrom.x + (this.tweenTo.x - this.tweenFrom.x) * t;
    const y = this.tweenFrom.y + (this.tweenTo.y - this.tweenFrom.y) * t;
    this.playerMoveSprite.position.set(x, y);
    this.drawLivePath(x, y);

    if (this.tweenProgress >= 1) {
      this.animating = false;
      this.playerMoveSprite.visible = false;
      this.playerSprite.visible = true;
      this.playerSprite.position.set(this.tweenTo.x, this.tweenTo.y);
      this.tweenFrom = null;
      this.tweenTo = null;

      const cbs = this.pendingCallbacks.splice(0);
      for (const cb of cbs) cb();
    }
  }

  private layout() {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    if (this.bgSprite) {
      this.bgSprite.position.set(screenW / 2, screenH / 2);
    }
    this.scale = 1;
    this.offsetX = screenW / 2;
    this.offsetY = screenH / 2;
    this.worldContainer.scale.set(this.scale);
    this.worldContainer.position.set(this.offsetX, this.offsetY);
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.offsetX) / this.scale,
      y: (sy - rect.top - this.offsetY) / this.scale,
    };
  }

  private drawLivePath(currentX: number, currentY: number) {
    const last = this.pathHistory[this.pathHistory.length - 1]!;
    this.pathHistory[this.pathHistory.length - 1] = { x: currentX, y: currentY };
    this.drawPath();
    this.pathHistory[this.pathHistory.length - 1] = last;
  }

  private drawPath() {
    this.pathLayer.clear();
    if (this.pathHistory.length < 2) return;

    const pts = this.buildSplinePoints();
    if (pts.length < 2) return;

    let carry = 0;
    let drawing = true;

    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i]!.x;
      const ay = pts[i]!.y;
      const bx = pts[i + 1]!.x;
      const by = pts[i + 1]!.y;
      const dx = bx - ax;
      const dy = by - ay;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen < 0.5) continue;
      const nx = dx / segLen;
      const ny = dy / segLen;

      let d = 0;
      while (d < segLen) {
        const dashTarget = drawing ? DASH_LENGTH : GAP_LENGTH;
        const remaining = dashTarget - carry;
        const step = Math.min(remaining, segLen - d);

        if (drawing) {
          if (carry === 0) {
            this.pathLayer.moveTo(ax + nx * d, ay + ny * d);
          }
          this.pathLayer.lineTo(ax + nx * (d + step), ay + ny * (d + step));
        }

        carry += step;
        d += step;

        if (carry >= dashTarget) {
          carry = 0;
          drawing = !drawing;
        }
      }
    }

    this.pathLayer.stroke({ color: PATH_COLOR, alpha: 0.7, width: 2.5 });
  }

  private buildSplinePoints(): { x: number; y: number }[] {
    const h = this.pathHistory;
    if (h.length < 2) return [];
    if (h.length === 2) {
      return this.subdivideSegment(h[0]!, h[0]!, h[1]!, h[1]!, 8);
    }

    const result: { x: number; y: number }[] = [];
    for (let i = 0; i < h.length - 1; i++) {
      const p0 = h[Math.max(0, i - 1)]!;
      const p1 = h[i]!;
      const p2 = h[i + 1]!;
      const p3 = h[Math.min(h.length - 1, i + 2)]!;
      const seg = this.subdivideSegment(p0, p1, p2, p3, 10);
      if (i === 0) result.push(seg[0]!);
      for (let j = 1; j < seg.length; j++) result.push(seg[j]!);
    }
    return result;
  }

  private subdivideSegment(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    steps: number
  ): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
    return pts;
  }

  private drawHexes() {
    if (!this.mapState) return;
    this.hexContainer.removeChildren();

    const { hexes, playerPos } = this.mapState;

    for (const [key, status] of Object.entries(hexes)) {
      const coord = parseHexKey(key);
      const px = hexToPixel(coord, HEX_SIZE);
      const isPlayer = coord.q === playerPos.q && coord.r === playerPos.r;
      const isHover =
        this.hoverCoord &&
        this.hoverCoord.q === coord.q &&
        this.hoverCoord.r === coord.r;
      const isClickable = isAdjacent(playerPos, coord);

      this.drawHex(px.x, px.y, status, isPlayer, !!isHover && isClickable, coord);
    }
  }

  private drawHex(
    x: number,
    y: number,
    status: HexStatus,
    isPlayer: boolean,
    isHover: boolean,
    coord: HexCoord
  ) {
    const gfx = new Graphics();
    const seed = coordSeed(coord.q, coord.r);
    const size = HEX_SIZE - 3;

    const points = this.sketchHexPoints(x, y, size, seed);

    if (isPlayer) {
      gfx.poly(points);
      gfx.fill({ color: PLAYER_COLOR, alpha: 0.12 });
      gfx.stroke({ color: PLAYER_COLOR, alpha: 0.7, width: 1.8 });

      this.drawSecondPass(gfx, x, y, size, seed + 1, PLAYER_COLOR, 0.3);
    } else if (status === "explored") {
      gfx.poly(points);
      gfx.fill({ color: PENCIL, alpha: 0.05 });
      gfx.stroke({ color: PENCIL, alpha: 0.45, width: 1.2 });

      this.drawSecondPass(gfx, x, y, size, seed + 1, PENCIL, 0.15);
    } else {
      gfx.poly(points);
      gfx.fill({ color: PENCIL, alpha: 0.03 });
      gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.35, width: 1.0 });
    }

    if (isHover) {
      const hoverPoints = this.sketchHexPoints(x, y, size + 2, seed + 7);
      gfx.poly(hoverPoints);
      gfx.stroke({ color: HOVER_COLOR, alpha: 0.6, width: 2.0 });
    }

    this.hexContainer.addChild(gfx);

    if (status === "unexplored" && !isPlayer) {
      this.drawQuestionMark(x, y, seed);
    }
  }

  private drawSecondPass(
    gfx: Graphics,
    x: number,
    y: number,
    size: number,
    seed: number,
    color: number,
    alpha: number
  ) {
    const points2 = this.sketchHexPoints(x, y, size, seed);
    gfx.poly(points2);
    gfx.stroke({ color, alpha, width: 0.8 });
  }

  private drawQuestionMark(cx: number, cy: number, seed: number) {
    const gfx = new Graphics();
    const rand = seededRand(seed + 500);
    const wobble = 0.6;

    const topY = cy - 10;
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const angle = Math.PI + (i / segments) * Math.PI;
      const r = 6 + rand() * wobble;
      const x = cx + Math.cos(angle) * r + rand() * wobble;
      const y = topY + Math.sin(angle) * r + rand() * wobble;
      if (i === 0) gfx.moveTo(x, y);
      else gfx.lineTo(x, y);
    }
    gfx.lineTo(cx + rand() * wobble, cy + 2 + rand() * wobble);
    gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.5, width: 1.2 });

    gfx.circle(cx + rand() * 0.4, cy + 7 + rand() * 0.4, 1.3);
    gfx.fill({ color: PENCIL_LIGHT, alpha: 0.5 });

    this.hexContainer.addChild(gfx);
  }

  private sketchHexPoints(cx: number, cy: number, size: number, seed: number): number[] {
    const rand = seededRand(seed);
    const wobble = 1.8;
    const pts: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 180) * (60 * (i % 6) - 30);
      const vx = cx + Math.cos(angle) * size;
      const vy = cy + Math.sin(angle) * size;
      pts.push(vx + rand() * wobble, vy + rand() * wobble);
    }
    return pts;
  }
}
