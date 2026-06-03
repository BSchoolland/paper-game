import type { AbilityDefinition, Entity, Vec2 } from "shared";
import { clampToMovementRange, distance, getAbilityCost, getEffectiveRegen } from "shared";
import type { ItemDefinition } from "shared/src/core/items.js";
import type { ClientState } from "../state/client-state.js";
import { itemSpriteUrl } from "./item-sprites.js";

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

const CARD_HEIGHT = 280;
const FRAME_PATH = "sprites/ui/card-frame.png";
const REGIONS_PATH = "sprites/ui/card-frame-regions.json";

export class AbilityBar {
  private container: HTMLDivElement;
  private unsubscribe: (() => void) | null = null;
  private regions: Region[] = [];
  private scale = 1;
  private cardWidth = 0;
  private ready = false;
  private endTurnBtn: HTMLButtonElement;
  private energyEl: HTMLDivElement;
  private variableCostEl: HTMLElement | null = null;
  private variableCostAbility: AbilityDefinition | null = null;

  constructor(private clientState: ClientState) {
    this.container = document.createElement("div");
    this.container.id = "ability-bar";

    this.endTurnBtn = document.createElement("button");
    this.endTurnBtn.id = "end-turn-btn";
    this.endTurnBtn.textContent = "End Turn";
    // Skip the focus ring entirely — the button is mouse-only. Without this, focus follows the
    // click and space presses re-activate it (which breaks the defense prompt).
    this.endTurnBtn.tabIndex = -1;
    this.endTurnBtn.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
      padding: 12px 24px;
      font-family: monospace;
      font-size: 16px;
      font-weight: bold;
      color: #4a3728;
      background: #d4c8a0;
      border: 2px solid #6b5b4a;
      border-radius: 6px;
      cursor: pointer;
      display: none;
      pointer-events: auto;
    `;
    this.endTurnBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Drop focus so subsequent space/Enter presses don't re-activate the button. Otherwise
      // space-to-defend during the enemy turn doubles as an end-turn dispatch.
      this.endTurnBtn.blur();
      this.clientState.endTurn();
    });
    document.body.appendChild(this.endTurnBtn);
    this.container.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 62.5%;
      z-index: 100;
      pointer-events: auto;
    `;
    document.body.appendChild(this.container);

    this.energyEl = document.createElement("div");
    this.energyEl.id = "energy-display";
    this.energyEl.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 24px;
      z-index: 100;
      display: none;
      pointer-events: none;
      font-family: monospace;
      font-size: 24px;
      font-weight: bold;
      padding: 10px 18px;
      background: rgba(40, 30, 20, 0.75);
      border: 2px solid #6b5b4a;
      border-radius: 6px;
    `;
    document.body.appendChild(this.energyEl);

    this.load();
    window.addEventListener("resize", () => this.render());
  }

  private async load() {
    const [regionsResp, img] = await Promise.all([
      fetch(REGIONS_PATH).then(r => r.json() as Promise<RegionsData>),
      new Promise<HTMLImageElement>((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.src = FRAME_PATH;
      }),
    ]);

    this.regions = regionsResp.regions;
    this.scale = CARD_HEIGHT / img.naturalHeight;
    this.cardWidth = img.naturalWidth * this.scale;
    this.ready = true;
  }

  private getRegion(name: string): Region | undefined {
    return this.regions.find(r => r.name === name);
  }

  show() {
    this.container.style.display = "block";
    this.endTurnBtn.style.display = "block";
    this.energyEl.style.display = "block";
    this.unsubscribe = this.clientState.subscribe(() => this.render());
    this.render();
  }

  hide() {
    this.container.style.display = "none";
    this.endTurnBtn.style.display = "none";
    this.energyEl.style.display = "none";
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.container.innerHTML = "";
  }

  updateMouse(mouseWorld: Vec2) {
    if (!this.variableCostEl || !this.variableCostAbility) return;
    const ability = this.variableCostAbility;

    const state = this.clientState.getState();
    const entityId = this.clientState.selectedEntityId;
    if (!state || !entityId) return;
    const entity = state.entities.get(entityId);
    if (!entity) return;

    const clamped = clampToMovementRange(entity, mouseWorld);
    const dist = distance(entity.position, clamped);
    const cost = getAbilityCost(ability, { distance: dist });

    const costParts: string[] = [];
    if (ability.cost.red) costParts.push(`<span style="color:#c0392b">${Math.min(cost.red ?? 0, entity.energy.red)} &#9679;</span>`);
    if (ability.cost.blue) costParts.push(`<span style="color:#2980b9">${Math.min(cost.blue ?? 0, entity.energy.blue)} &#9679;</span>`);
    this.variableCostEl.innerHTML = costParts.join(" ");
  }

  private render() {
    if (!this.ready) return;

    const state = this.clientState.getState();
    if (!state) {
      this.container.innerHTML = "";
      this.energyEl.innerHTML = "";
      return;
    }

    const entity = [...state.entities.values()].find(e => e.teamId === "red");
    if (!entity) {
      this.container.innerHTML = "";
      this.energyEl.innerHTML = "";
      return;
    }

    const regenTag = (effective: number, base: number) => {
      const color = effective < base ? "#d9534f" : "#8a7a68";
      return `<span style="color:${color}"> (+${effective})</span>`;
    };
    const redRegen = getEffectiveRegen(entity, "red", entity.energy.regenRed);
    const blueRegen = getEffectiveRegen(entity, "blue", entity.energy.regenBlue);

    this.energyEl.innerHTML =
      `<span style="color:#e07a5a">&#9679; ${entity.energy.red}</span>` +
      `<span style="color:#8a7a68"> / ${entity.energy.maxRed}</span>` +
      regenTag(redRegen, entity.energy.regenRed) +
      `<span style="color:#8a7a68; margin:0 10px">&nbsp;</span>` +
      `<span style="color:#5a9be0">&#9679; ${entity.energy.blue}</span>` +
      `<span style="color:#8a7a68"> / ${entity.energy.maxBlue}</span>` +
      regenTag(blueRegen, entity.energy.regenBlue);

    this.endTurnBtn.disabled = !this.clientState.canEndTurn();
    this.endTurnBtn.style.opacity = this.clientState.canEndTurn() ? "1" : "0.5";

    this.container.innerHTML = "";
    this.variableCostEl = null;
    this.variableCostAbility = null;

    const allCards: { el: HTMLDivElement; selected: boolean }[] = [];
    for (const ability of entity.abilities) {
      const sourceItem = this.findSourceItem(ability, entity);
      const selected = this.clientState.selectedAbilityId === ability.id;
      allCards.push({ el: this.createCard(ability, entity, sourceItem), selected });
    }

    const count = allCards.length;
    const fanRadius = 2400;
    const liftAmount = 30;
    // Step that leaves cards edge-to-edge with no overlap.
    const noOverlapStep = (this.cardWidth / fanRadius) * (180 / Math.PI);
    // Cap the fan so it never spills past the viewport or covers the End Turn
    // button: the container origin sits at 62.5% of the window, the End Turn
    // button is anchored bottom-right, so the right side is the tight constraint.
    const endTurnWidth = this.endTurnBtn.offsetWidth || 130;
    const rightRoom = window.innerWidth * 0.375 - 24 - endTurnWidth - 16;
    const leftRoom = window.innerWidth * 0.625 - 24;
    const maxHalfWidth = Math.max(this.cardWidth * 0.6, Math.min(rightRoom, leftRoom));
    const maxAngleRad = Math.asin(Math.min(1, Math.max(0, (maxHalfWidth - this.cardWidth / 2) / fanRadius)));
    const maxStep = count > 1 ? (2 * maxAngleRad * (180 / Math.PI)) / (count - 1) : noOverlapStep;
    const step = Math.min(noOverlapStep, maxStep);
    for (let i = 0; i < count; i++) {
      const { el: card, selected } = allCards[i]!;
      const t = count > 1 ? (i / (count - 1)) - 0.5 : 0;
      const angle = t * step * (count - 1);
      const lift = selected ? -liftAmount : 0;
      card.style.position = "absolute";
      card.style.left = `${-this.cardWidth / 2}px`;
      card.style.bottom = "0";
      card.style.transformOrigin = `center ${CARD_HEIGHT + fanRadius}px`;
      card.style.transform = `rotate(${angle}deg) translateY(${lift}px)`;
      card.style.zIndex = selected ? "20" : `${i}`;
      // When cards overlap, hovering one brings it to the front so it stays usable.
      card.addEventListener("mouseenter", () => { if (!selected) card.style.zIndex = "10"; });
      card.addEventListener("mouseleave", () => { if (!selected) card.style.zIndex = `${i}`; });
      this.container.appendChild(card);
    }
  }

  private findSourceItem(ability: AbilityDefinition, entity: Entity): ItemDefinition | null {
    if (!entity.equipped) return null;
    for (const item of entity.equipped) {
      if (!("abilities" in item) || !item.abilities) continue;
      if (item.abilities.some(a => a.id === ability.id)) return item;
    }
    return null;
  }

  private createCard(ability: AbilityDefinition, entity: Entity, sourceItem: ItemDefinition | null): HTMLDivElement {
    const card = document.createElement("div");
    const isSelected = this.clientState.selectedAbilityId === ability.id;
    const canActivate = this.clientState.canSelectAbility(ability.id);

    const s = this.scale;
    const opacity = canActivate ? "1" : "0.5";
    const highlight = isSelected ? "brightness(1.2) drop-shadow(0 0 6px rgba(240,192,64,0.8))" : "";

    card.style.cssText = `
      width: ${this.cardWidth}px;
      height: ${CARD_HEIGHT}px;
      background-image: url(${FRAME_PATH});
      background-size: ${this.cardWidth}px ${CARD_HEIGHT}px;
      position: relative;
      cursor: ${canActivate ? "pointer" : "default"};
      opacity: ${opacity};
      user-select: none;
      filter: ${highlight};
      transition: filter 0.15s;
    `;

    const titleRegion = this.getRegion("title");
    if (titleRegion) {
      const el = document.createElement("div");
      el.style.cssText = `
        position: absolute;
        left: ${titleRegion.x * s}px;
        top: ${titleRegion.y * s}px;
        width: ${titleRegion.w * s}px;
        height: ${titleRegion.h * s}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: monospace;
        font-weight: bold;
        color: #4a3728;
        text-align: center;
        overflow: hidden;
        white-space: nowrap;
      `;
      el.textContent = ability.name;
      const regionW = titleRegion.w * s;
      const maxFontSize = Math.round(titleRegion.h * s * 0.7);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `bold ${maxFontSize}px monospace`;
      const measured = ctx.measureText(ability.name).width;
      const fontSize = measured > regionW
        ? Math.max(Math.floor(maxFontSize * (regionW / measured)), 8)
        : maxFontSize;
      el.style.fontSize = `${fontSize}px`;
      card.appendChild(el);
    }

    const imageRegion = this.getRegion("image");
    if (imageRegion && sourceItem) {
      const img = document.createElement("img");
      img.src = itemSpriteUrl(sourceItem);
      img.style.cssText = `
        position: absolute;
        left: ${imageRegion.x * s}px;
        top: ${imageRegion.y * s}px;
        width: ${imageRegion.w * s}px;
        height: ${imageRegion.h * s}px;
        object-fit: contain;
        image-rendering: pixelated;
      `;
      card.appendChild(img);
    }

    const descRegion = this.getRegion("description");
    if (descRegion) {
      const el = document.createElement("div");
      const desc = this.getAbilityDescription(ability);
      el.style.cssText = `
        position: absolute;
        left: ${descRegion.x * s}px;
        top: ${descRegion.y * s}px;
        width: ${descRegion.w * s}px;
        height: ${descRegion.h * s}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: monospace;
        font-size: ${Math.round(descRegion.h * s * 0.35)}px;
        color: #5a4a38;
        text-align: center;
        overflow: hidden;
        padding: 2px;
      `;
      el.textContent = desc;
      card.appendChild(el);
    }

    const costRegion = this.getRegion("cost");
    if (costRegion) {
      const el = document.createElement("div");
      const costParts: string[] = [];
      if (ability.cost.red) {
        const label = ability.variableCost ? "X" : ability.cost.red;
        costParts.push(`<span style="color:#c0392b">${label} &#9679;</span>`);
      }
      if (ability.cost.blue) {
        const label = ability.variableCost ? "X" : ability.cost.blue;
        costParts.push(`<span style="color:#2980b9">${label} &#9679;</span>`);
      }
      el.style.cssText = `
        position: absolute;
        left: ${costRegion.x * s}px;
        top: ${costRegion.y * s}px;
        width: ${costRegion.w * s}px;
        height: ${costRegion.h * s}px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-family: monospace;
        font-size: ${Math.round(costRegion.h * s * 0.7)}px;
        font-weight: bold;
      `;
      el.innerHTML = costParts.join(" ");
      if (ability.variableCost && isSelected) {
        this.variableCostEl = el;
        this.variableCostAbility = ability;
      }
      card.appendChild(el);
    }

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.clientState.canSelectAbility(ability.id)) {
        this.clientState.selectAbility(ability.id);
      }
    });

    return card;
  }

  private getAbilityDescription(ability: AbilityDefinition): string {
    if (ability.kind === "attack") return `${ability.damage} damage`;
    if (ability.kind === "move") return `Move up to ${ability.distance} units`;
    if (ability.kind === "barrier") return `+${ability.barrierHp} barrier HP`;
    if (ability.kind === "zone") return `${ability.zone.effect} zone · r${ability.zone.radius} · ${ability.zone.duration}t`;
    return "";
  }

}
