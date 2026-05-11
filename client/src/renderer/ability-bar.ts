import type { AbilityDefinition, Entity, Vec2 } from "shared";
import { clampToMovementRange, distance, canAffordAbility, getAbilityCost } from "shared";
import type { ItemDefinition } from "shared/src/core/items.js";
import type { ClientState } from "../state/client-state.js";

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
  private variableCostEl: HTMLElement | null = null;
  private variableCostAbility: AbilityDefinition | null = null;

  constructor(private clientState: ClientState) {
    this.container = document.createElement("div");
    this.container.id = "ability-bar";

    this.endTurnBtn = document.createElement("button");
    this.endTurnBtn.id = "end-turn-btn";
    this.endTurnBtn.textContent = "End Turn";
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
    this.load();
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
    this.unsubscribe = this.clientState.subscribe(() => this.render());
    this.render();
  }

  hide() {
    this.container.style.display = "none";
    this.endTurnBtn.style.display = "none";
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
      return;
    }

    const entity = [...state.entities.values()].find(e => e.teamId === "red");
    if (!entity) {
      this.container.innerHTML = "";
      return;
    }

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
    const minStep = (this.cardWidth / fanRadius) * (180 / Math.PI);
    for (let i = 0; i < count; i++) {
      const { el: card, selected } = allCards[i]!;
      const t = count > 1 ? (i / (count - 1)) - 0.5 : 0;
      const angle = t * minStep * (count - 1);
      const lift = selected ? -liftAmount : 0;
      card.style.position = "absolute";
      card.style.left = `${-this.cardWidth / 2}px`;
      card.style.bottom = "0";
      card.style.transformOrigin = `center ${CARD_HEIGHT + fanRadius}px`;
      card.style.transform = `rotate(${angle}deg) translateY(${lift}px)`;
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
    const canAfford = canAffordAbility(entity, ability);

    const s = this.scale;
    const opacity = canAfford ? "1" : "0.5";
    const highlight = isSelected ? "brightness(1.2) drop-shadow(0 0 6px rgba(240,192,64,0.8))" : "";

    card.style.cssText = `
      width: ${this.cardWidth}px;
      height: ${CARD_HEIGHT}px;
      background-image: url(${FRAME_PATH});
      background-size: ${this.cardWidth}px ${CARD_HEIGHT}px;
      position: relative;
      cursor: ${canAfford ? "pointer" : "default"};
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
        font-size: ${Math.round(titleRegion.h * s * 0.7)}px;
        font-weight: bold;
        color: #4a3728;
        text-align: center;
        overflow: hidden;
      `;
      el.textContent = ability.name;
      card.appendChild(el);
    }

    const imageRegion = this.getRegion("image");
    if (imageRegion && sourceItem) {
      const img = document.createElement("img");
      img.src = `sprites/items/${sourceItem.sprite}.webp`;
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

    if (canAfford) {
      card.addEventListener("click", (e) => {
        e.stopPropagation();
        if (ability.kind === "buff") {
          this.clientState.dispatch({
            type: "ability",
            entityId: entity.id,
            abilityId: ability.id,
          });
        } else {
          this.clientState.selectAbility(ability.id);
        }
      });
    }

    return card;
  }

  private getAbilityDescription(ability: AbilityDefinition): string {
    if (ability.kind === "attack") return `${ability.damage} damage`;
    if (ability.kind === "move") return `Move up to ${ability.distance} units`;
    if (ability.kind === "buff" && ability.effect.type === "block")
      return `Block ${ability.effect.damageReduction} damage`;
    return "";
  }

}
