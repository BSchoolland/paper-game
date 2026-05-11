import type { ClientState } from "../state/client-state.js";
import type { GameRenderer } from "./game-renderer.js";

interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RegionsData {
  regions: Region[];
}

const DISPLAY_HEIGHT = 160;
const IMAGE_PATH = "sprites/ui/character-display.png";
const REGIONS_PATH = "sprites/ui/character-display-regions.json";

export class CharacterDisplay {
  private container: HTMLDivElement;
  private hpFill: HTMLDivElement | null = null;
  private hpText: HTMLDivElement | null = null;
  private displayWidth = 0;
  private unsubscribe: (() => void) | null = null;
  private ready = false;

  constructor(private clientState: ClientState, private combatRenderer: GameRenderer) {
    this.container = document.createElement("div");
    this.container.id = "character-display";
    this.container.style.cssText = `
      position: fixed;
      display: none;
      z-index: 100;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
    this.load();

    window.addEventListener("resize", () => {
      if (this.ready) this.updatePosition();
    });
  }

  private async load() {
    const [regionsResp, img] = await Promise.all([
      fetch(REGIONS_PATH).then(r => r.json() as Promise<RegionsData>),
      new Promise<HTMLImageElement>((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.src = IMAGE_PATH;
      }),
    ]);

    const scale = DISPLAY_HEIGHT / img.naturalHeight;
    const displayWidth = img.naturalWidth * scale;

    this.displayWidth = img.naturalWidth * scale;

    this.container.style.width = `${this.displayWidth}px`;
    this.container.style.height = `${DISPLAY_HEIGHT}px`;
    this.container.style.backgroundImage = `url(${IMAGE_PATH})`;
    this.container.style.backgroundSize = `${this.displayWidth}px ${DISPLAY_HEIGHT}px`;

    const hpRegion = regionsResp.regions.find(r => r.name === "hp-bar");
    if (hpRegion) {
      const rx = hpRegion.x * scale;
      const ry = hpRegion.y * scale;
      const rw = hpRegion.w * scale;
      const rh = hpRegion.h * scale;

      const track = document.createElement("div");
      track.style.cssText = `
        position: absolute;
        left: ${rx}px;
        top: ${ry}px;
        width: ${rw}px;
        height: ${rh}px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 3px;
        overflow: hidden;
      `;

      this.hpFill = document.createElement("div");
      this.hpFill.style.cssText = `
        width: 100%;
        height: 100%;
        background: #c0392b;
        transition: width 0.3s ease;
        border-radius: 3px;
      `;
      track.appendChild(this.hpFill);

      this.hpText = document.createElement("div");
      this.hpText.style.cssText = `
        position: absolute;
        left: ${rx}px;
        top: ${ry}px;
        width: ${rw}px;
        height: ${rh}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: monospace;
        font-size: ${Math.round(rh * 0.6)}px;
        color: #fff;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        pointer-events: none;
      `;

      this.container.appendChild(track);
      this.container.appendChild(this.hpText);
    }

    this.ready = true;
  }

  private updatePosition() {
    const rect = this.combatRenderer.getCombatRect();
    const overhang = DISPLAY_HEIGHT * 0.3;
    const left = rect.x - overhang;
    const top = rect.y + rect.h - DISPLAY_HEIGHT + overhang;
    this.container.style.left = `${left}px`;
    this.container.style.top = `${top}px`;
  }

  show() {
    this.container.style.display = "block";
    this.updatePosition();
    this.unsubscribe = this.clientState.subscribe(() => this.render());
    this.render();
  }

  hide() {
    this.container.style.display = "none";
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private render() {
    if (!this.ready) return;

    const state = this.clientState.getState();
    if (!state) return;

    const entity = [...state.entities.values()].find(e => e.teamId === "red");
    if (!entity) return;

    if (this.hpFill && this.hpText) {
      const pct = Math.max(0, entity.hp / entity.maxHp) * 100;
      this.hpFill.style.width = `${pct}%`;
      this.hpText.textContent = `${entity.hp} / ${entity.maxHp}`;
    }
  }
}
