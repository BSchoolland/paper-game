import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js";
import type { HexCoord, HexIconType, HexMapState, HexStatus } from "shared";
import { hexToPixel, hexNeighbors, hexKey, parseHexKey, pixelToHex, isAdjacent, isDecorationHex, HEX_ICON_TYPES } from "shared";
import { PENCIL, PENCIL_LIGHT } from "./sketch-utils.js";
import { HexCamera } from "./hex-camera.js";
import { HexPathTrail } from "./hex-path-trail.js";
import { HexPlayerTween } from "./hex-player-tween.js";
import type { FramePacer, PacerToken } from "./frame-pacer.js";

const HEX_SIZE = 48;

const PLAYER_COLOR = 0x8b6d30;
const HOVER_COLOR = 0xd4a850;
const PANEL_BG = "rgba(245, 235, 215, 0.92)";
const PANEL_BORDER = "1px solid rgba(74, 55, 40, 0.3)";
const FONT = "Georgia, 'Times New Roman', serif";

const ICON_SIZE = 72;
const DECORATION_SCALE = 0.6;
const SHOW_DECORATIONS = true;

const iconTextures = new Map<HexIconType, Texture>();
const decorationTextures = new Map<string, Texture>();
let decorationNames: string[] = [];

export async function loadMapIconAssets(): Promise<void> {
  const entries = HEX_ICON_TYPES.map((name) => ({
    alias: `map-icon-${name}`,
    src: `sprites/map-icons/${name}.png`,
  }));

  const manifestResponse = await fetch("sprites/map-decorations/manifest.json");
  const loadedDecorationNames = (await manifestResponse.json()) as string[];
  const decorationEntries = loadedDecorationNames.map((name) => ({
    alias: `map-decoration-${name}`,
    src: `sprites/map-decorations/${name}.png`,
  }));

  await Assets.load([...entries, ...decorationEntries]);
  for (const name of HEX_ICON_TYPES) {
    iconTextures.set(name, Assets.get(`map-icon-${name}`));
  }
  decorationNames = loadedDecorationNames;
  for (const name of decorationNames) {
    decorationTextures.set(name, Assets.get(`map-decoration-${name}`));
  }
}

export class HexMapRenderer {
  private worldContainer = new Container();
  private hexContainer = new Container();
  private decorationContainer = new Container();
  private iconContainer = new Container();
  private hoverGfx = new Graphics();
  private hoverCoord: HexCoord | null = null;
  private mapState: HexMapState | null = null;
  private onHexClickCallback: ((coord: HexCoord) => void) | null = null;
  private cameraControls: HTMLDivElement | null = null;
  private resetCameraBtn: HTMLButtonElement | null = null;

  private camera: HexCamera;
  private pathTrail = new HexPathTrail();
  private playerTween = new HexPlayerTween(HEX_SIZE);
  private inputEnabled = true;

  constructor(private app: Application, private pacer: FramePacer) {
    this.camera = new HexCamera(app, this.worldContainer);
  }

  init() {
    this.camera.init();
    this.camera.onViewChanged(() => this.updateResetCameraButton());
    this.createResetCameraButton();

    this.worldContainer.addChild(this.pathTrail.layer);
    this.worldContainer.addChild(this.hexContainer);
    this.worldContainer.addChild(this.decorationContainer);
    this.worldContainer.addChild(this.iconContainer);
    this.worldContainer.addChild(this.hoverGfx);
    this.worldContainer.addChild(this.playerTween.charSprite.container);

    let tweenToken: PacerToken | null = null;
    this.app.ticker.add((ticker) => {
      if (!this.playerTween.animating) {
        if (tweenToken !== null) {
          this.pacer.release(tweenToken);
          tweenToken = null;
        }
        return;
      }
      if (tweenToken === null) tweenToken = this.pacer.request(60);
      const dt = ticker.deltaTime / 60;
      const pos = this.playerTween.tick(dt);
      if (pos) this.pathTrail.drawLive(pos.x, pos.y);
    });

    this.app.canvas.addEventListener("mousemove", (e) => {
      if (!this.inputEnabled) return;
      const world = this.camera.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      const prev = this.hoverCoord;
      if (!prev || prev.q !== coord.q || prev.r !== coord.r) {
        this.hoverCoord = coord;
        if (this.mapState && !this.playerTween.animating) this.drawHover();
      }
    });

    this.app.canvas.addEventListener("click", (e) => {
      if (!this.inputEnabled) return;
      if (!this.mapState || !this.onHexClickCallback || this.playerTween.animating) return;
      if (this.camera.consumeSuppressedClick()) return;
      const world = this.camera.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      this.onHexClickCallback(coord);
    });
  }

  onHexClick(cb: (coord: HexCoord) => void) {
    this.onHexClickCallback = cb;
  }

  show() {
    this.camera.show();
    this.updateResetCameraButton();
  }

  hide() {
    this.camera.hide();
    if (this.cameraControls) this.cameraControls.style.display = "none";
  }

  hideControls() {
    if (this.cameraControls) this.cameraControls.style.display = "none";
  }

  setInputEnabled(val: boolean) {
    this.inputEnabled = val;
    this.camera.setEnabled(val);
  }

  setPlayerAnimSet(animSet: import("shared").AnimSet) {
    this.playerTween.setAnimSet(animSet);
  }

  setPlayerEquipment(
    equipped: readonly import("shared").ItemDefinition[],
    attachments: Record<string, import("shared").AttachmentData>,
  ) {
    this.playerTween.setEquipment(equipped, attachments);
  }

  isMoving(): boolean {
    return this.playerTween.animating;
  }

  onMoveComplete(cb: () => void) {
    this.playerTween.onComplete(cb);
  }

  animateMoveTo(target: HexCoord) {
    if (!this.mapState) return;
    const to = hexToPixel(target, HEX_SIZE);
    this.pathTrail.addPoint(to);
    this.playerTween.startMove(this.mapState.playerPos, target);
  }

  render(state: HexMapState) {
    this.mapState = state;

    const px = hexToPixel(state.playerPos, HEX_SIZE);
    this.camera.centerOn(px.x, px.y);
    this.pathTrail.initIfEmpty(px);

    this.drawHexes();
    this.updateResetCameraButton();
    this.pathTrail.draw();
    if (!this.playerTween.animating) {
      this.playerTween.placeIdle(px.x, px.y);
    }
  }

  private drawHexes() {
    if (!this.mapState) return;
    this.hexContainer.removeChildren();
    this.decorationContainer.removeChildren();
    this.iconContainer.removeChildren();

    const { hexes, playerPos, icons } = this.mapState;

    // Only draw hex outlines for the player hex and its neighbors
    const nearPlayer = new Set<string>();
    nearPlayer.add(hexKey(playerPos));
    for (const n of hexNeighbors(playerPos)) {
      nearPlayer.add(hexKey(n));
    }

    for (const [key, status] of Object.entries(hexes)) {
      const coord = parseHexKey(key);
      const px = hexToPixel(coord, HEX_SIZE);
      const isPlayer = coord.q === playerPos.q && coord.r === playerPos.r;
      const iconType = icons?.[key];
      const showHex = nearPlayer.has(key);

      this.drawHex(px.x, px.y, status, isPlayer, coord, iconType, showHex);
    }

    this.drawHover();
  }

  private drawHover() {
    this.hoverGfx.clear();
    if (!this.mapState || !this.hoverCoord) return;
    const { hexes, playerPos } = this.mapState;
    const key = hexKey(this.hoverCoord);
    if (!(key in hexes)) return;
    if (!isAdjacent(playerPos, this.hoverCoord)) return;

    const px = hexToPixel(this.hoverCoord, HEX_SIZE);
    const hoverPoints = this.exactHexPoints(px.x, px.y, HEX_SIZE + 2);
    this.hoverGfx.poly(hoverPoints);
    this.hoverGfx.stroke({ color: HOVER_COLOR, alpha: 0.6, width: 2.0 });
  }

  private drawHex(
    x: number,
    y: number,
    status: HexStatus,
    isPlayer: boolean,
    coord: HexCoord,
    iconType: HexIconType | undefined,
    showHex: boolean
  ) {
    const gfx = new Graphics();
    const size = HEX_SIZE;
    const points = this.exactHexPoints(x, y, size);

    if (showHex) {
      if (isPlayer) {
        gfx.poly(points);
        gfx.fill({ color: PLAYER_COLOR, alpha: 0.12 });
        gfx.stroke({ color: PLAYER_COLOR, alpha: 0.7, width: 1.8 });
      } else if (status === "explored") {
        gfx.poly(points);
        gfx.fill({ color: PENCIL, alpha: 0.05 });
        gfx.stroke({ color: PENCIL, alpha: 0.45, width: 1.2 });
      } else {
        gfx.poly(points);
        gfx.fill({ color: PENCIL, alpha: 0.03 });
        gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.35, width: 1.0 });
      }
    } else {
      gfx.poly(points);
      gfx.fill({ color: PENCIL, alpha: 0.02 });
      gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.25, width: 0.75 });
    }

    this.hexContainer.addChild(gfx);

    if (SHOW_DECORATIONS && !iconType && !isPlayer) {
      this.drawDecoration(x, y, coord, status);
    }

    if (iconType) {
      const tex = iconTextures.get(iconType);
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = x;
        sprite.y = y;
        const scale = ICON_SIZE / Math.max(tex.width, tex.height);
        sprite.scale.set(scale);
        if (status === "unexplored" || isPlayer) {
          sprite.alpha = 0.4;
        }
        this.iconContainer.addChild(sprite);
      }
    }
  }

  private drawDecoration(x: number, y: number, coord: HexCoord, status: HexStatus) {
    if (decorationNames.length === 0) return;

    if (!isDecorationHex(coord)) return;

    const index = Math.floor(this.seededUnit(coord, 23) * decorationNames.length);
    const name = decorationNames[index];
    if (!name) return;

    const tex = decorationTextures.get(name);
    if (!tex) return;

    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5, 0.78);
    sprite.x = x + (this.seededUnit(coord, 37) - 0.5) * HEX_SIZE * 0.42;
    sprite.y = y + (this.seededUnit(coord, 41) - 0.5) * HEX_SIZE * 0.34 + HEX_SIZE * 0.16;
    sprite.scale.set(DECORATION_SCALE);
    sprite.alpha = status === "unexplored" ? 0.38 : 0.62;
    this.decorationContainer.addChild(sprite);
  }

  private seededUnit(coord: HexCoord, salt: number): number {
    let seed = Math.imul(coord.q, 374761393) ^ Math.imul(coord.r, 668265263) ^ Math.imul(salt, 2246822519);
    seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
    return ((seed ^ (seed >>> 16)) >>> 0) / 0xffffffff;
  }

  private createResetCameraButton() {
    const parent = this.app.canvas.parentElement ?? document.body;
    if (parent !== document.body && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }
    const controls = document.createElement("div");
    controls.style.cssText = `
      position: absolute;
      right: 18px;
      bottom: 18px;
      display: none;
      gap: 6px;
      padding: 6px;
      background: ${PANEL_BG};
      border: ${PANEL_BORDER};
      border-radius: 6px;
      box-shadow: 0 3px 10px rgba(35, 24, 14, 0.16);
      pointer-events: auto;
      z-index: 20;
    `;

    const zoomOutBtn = this.makeCameraButton("-");
    const zoomInBtn = this.makeCameraButton("+");
    const resetBtn = this.makeCameraButton("Reset");
    resetBtn.style.width = "62px";

    zoomOutBtn.addEventListener("click", () => this.camera.zoomOut());
    zoomInBtn.addEventListener("click", () => this.camera.zoomIn());
    resetBtn.addEventListener("click", () => this.camera.resetView());

    controls.appendChild(zoomOutBtn);
    controls.appendChild(zoomInBtn);
    controls.appendChild(resetBtn);
    parent.appendChild(controls);

    this.cameraControls = controls;
    this.resetCameraBtn = resetBtn;
  }

  private makeCameraButton(label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.type = "button";
    btn.style.cssText = `
      width: 32px;
      height: 30px;
      border: ${PANEL_BORDER};
      border-radius: 5px;
      background: rgba(255, 250, 238, 0.92);
      color: #4a3728;
      font: 600 13px ${FONT};
      cursor: pointer;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(238, 218, 177, 0.95)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(255, 250, 238, 0.92)";
    });
    return btn;
  }

  private updateResetCameraButton() {
    if (!this.cameraControls || !this.resetCameraBtn) return;
    if (!this.mapState) {
      this.cameraControls.style.display = "none";
      return;
    }

    this.cameraControls.style.display = "flex";
    this.resetCameraBtn.disabled = !this.camera.hasUserChangedView();
    this.resetCameraBtn.style.opacity = this.resetCameraBtn.disabled ? "0.45" : "1";
    this.resetCameraBtn.style.cursor = this.resetCameraBtn.disabled ? "default" : "pointer";
  }

  private exactHexPoints(cx: number, cy: number, size: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 180) * (60 * (i % 6) - 30);
      pts.push(cx + Math.cos(angle) * size, cy + Math.sin(angle) * size);
    }
    return pts;
  }
}
