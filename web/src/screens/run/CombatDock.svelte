<script lang="ts">
  import type { AbilityDefinition, Entity, ItemDefinition } from "shared";
  import { combat } from "../../state/combat.svelte.js";
  import { room } from "../../state/room.svelte.js";
  import type { ClientState } from "../../board/client-state.svelte.js";
  import { isSelfCastAbility, myHeroEntity, shouldSuggestEndTurn } from "../../board/combat-ui-state.js";
  import { itemSpriteUrl } from "../../board/render/item-sprites.js";

  let { clientState, onOpenPack }: { clientState: ClientState; onOpenPack: () => void } = $props();

  const hero = $derived(myHeroEntity(combat.display, clientState.seat));
  const coop = $derived(combat.coop);
  const mine = $derived(coop?.seats.find((s) => s.seatId === room.state?.yourSeatId) ?? null);

  type CostColor = "none" | "red" | "blue";
  interface Slot {
    index: number;
    ability: AbilityDefinition;
    item: ItemDefinition | null;
  }
  interface Group {
    color: CostColor;
    slots: Slot[];
    redPips: boolean;
    bluePips: boolean;
  }

  function costColor(a: AbilityDefinition): CostColor {
    if (a.kind === "move") return "none";
    if (a.cost.red) return "red";
    if (a.cost.blue) return "blue";
    return "none";
  }

  function findSourceItem(ability: AbilityDefinition, entity: Entity): ItemDefinition | null {
    for (const item of entity.equipped ?? []) {
      if (item.abilities?.some((a) => a.id === ability.id)) return item;
    }
    return null;
  }

  const groups = $derived.by<Group[]>(() => {
    if (!hero) return [];
    const out: Group[] = [];
    hero.abilities.forEach((ability, index) => {
      const color = costColor(ability);
      const slot: Slot = { index, ability, item: findSourceItem(ability, hero) };
      const last = out[out.length - 1];
      if (last && last.color === color) last.slots.push(slot);
      else out.push({ color, slots: [slot], redPips: false, bluePips: false });
    });
    // Current energy floats above the first run of each colour; if move is the only blue
    // spender, the blue pips sit over the move slot instead.
    const firstRed = out.find((g) => g.color === "red");
    if (firstRed) firstRed.redPips = true;
    const firstBlue = out.find((g) => g.color === "blue") ?? out.find((g) => g.slots.some((s) => s.ability.kind === "move"));
    if (firstBlue) firstBlue.bluePips = true;
    return out;
  });

  function costText(a: AbilityDefinition): string {
    const parts: string[] = [];
    if (a.cost.red) parts.push(`${a.variableCost ? "1–" + a.cost.red : a.cost.red} red`);
    if (a.cost.blue) parts.push(`${a.variableCost ? "1–" + a.cost.blue : a.cost.blue} blue`);
    return parts.join(" + ");
  }

  function describe(a: AbilityDefinition): string {
    if (a.kind === "attack") return `${a.damage} damage`;
    if (a.kind === "move") return `Move up to ${a.distance} units`;
    if (a.kind === "barrier") return `+${a.barrierHp} barrier HP`;
    if (a.kind === "zone") return `${a.zone.effect} zone · r${a.zone.radius} · ${a.zone.duration}t`;
    if (a.kind === "restore") {
      const bits: string[] = [];
      if (a.hp) bits.push(`+${a.hp} HP`);
      if (a.red) bits.push(`+${a.red} red`);
      if (a.blue) bits.push(`+${a.blue} blue`);
      const body = bits.join(" · ") || "Restore";
      return a.uses !== undefined ? `${body} · ${a.uses}/enc` : body;
    }
    if (a.kind === "convert") {
      const gain = [
        a.gain.red ? `+${a.gain.red} red` : "",
        a.gain.blue ? `+${a.gain.blue} blue` : "",
      ].filter(Boolean).join(" · ");
      return gain || "Convert energy";
    }
    if (a.kind === "summon") {
      const body = `Summon ${a.count} · r${a.range}`;
      return a.uses !== undefined ? `${body} · ${a.uses}/enc` : body;
    }
    return "";
  }

  function remainingCharges(ability: AbilityDefinition, entity: Entity): number | null {
    if (ability.uses === undefined) return null;
    return entity.abilityUses?.[ability.id] ?? ability.uses;
  }

  function interactive(): boolean {
    return ["idle", "abilitySelected", "aiming"].includes(clientState.ui.tag);
  }

  function onSlotClick(slot: Slot): void {
    if (!interactive()) return;
    // Second click on a self-cast commits it; second click on anything else cancels.
    if (clientState.selectedAbilityId === slot.ability.id) {
      if (isSelfCastAbility(slot.ability)) clientState.confirmAbility();
      else clientState.selectAbility(null);
      return;
    }
    if (clientState.canSelectAbility(slot.ability.id)) clientState.selectAbility(slot.ability.id);
  }

  const suggestEnd = $derived(shouldSuggestEndTurn(combat.display, clientState.seat));
  const endState = $derived.by<{ label: string; disabled: boolean; on: boolean }>(() => {
    if (!coop || coop.phase !== "player") return { label: "ENEMY TURN", disabled: true, on: false };
    if (!mine || mine.exhausted || hero?.dead) return { label: "TURN ENDED", disabled: true, on: false };
    if (mine.ready) return { label: "UN-READY", disabled: false, on: true };
    return { label: "END TURN", disabled: false, on: false };
  });

  function onEndTurn(): void {
    if (!mine || endState.disabled) return;
    clientState.setReady(!mine.ready);
  }
</script>

{#if hero}
  <div class="dock">
    <button class="btn bagbtn" onclick={onOpenPack}>ITEM BAG</button>

    <div class="bar plate">
      {#each groups as group, gi (gi)}
        <div class="group">
          <div class="floats">
            {#if group.redPips}
              <span class="pips">
                {#each { length: hero.energy.maxRed } as _, i}
                  <span class="epip red" class:lit={i < hero.energy.red}></span>
                {/each}
              </span>
            {/if}
            {#if group.bluePips}
              <span class="pips">
                {#each { length: hero.energy.maxBlue } as _, i}
                  <span class="epip blue" class:lit={i < hero.energy.blue}></span>
                {/each}
              </span>
            {/if}
          </div>
          {#if group.color !== "none"}
            <div class="strip {group.color}"></div>
          {:else}
            <div class="strip none"></div>
          {/if}
          <div class="slots">
            {#each group.slots as slot (slot.ability.id)}
              {@const selected = clientState.selectedAbilityId === slot.ability.id}
              {@const usable = clientState.canSelectAbility(slot.ability.id)}
              {@const charges = remainingCharges(slot.ability, hero)}
              <button
                class="slot"
                class:selected
                class:unusable={!usable && !selected}
                onclick={() => onSlotClick(slot)}
              >
                <span class="num sc">{slot.index + 1}</span>
                {#if charges !== null}
                  <span class="charges sc">{charges}</span>
                {/if}
                {#if slot.item}
                  <img src={itemSpriteUrl(slot.item)} alt={slot.ability.name} draggable="false" />
                {:else if slot.ability.kind === "move"}
                  <svg viewBox="0 0 40 40" class="glyph"><path d="M20 4l4.5 6h-3v7h7v-3l6 4.5-6 4.5v-3h-7v7h3L20 36l-4.5-6h3v-7h-7v3L5 21.5 11.5 17v3h7v-7h-3z" /></svg>
                {:else if slot.ability.kind === "barrier"}
                  <svg viewBox="0 0 40 40" class="glyph"><path d="M20 4l12 4v10c0 8.5-5 15-12 18-7-3-12-9.5-12-18V8z" /></svg>
                {:else if slot.ability.kind === "zone"}
                  <svg viewBox="0 0 40 40" class="glyph"><circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="3" /><circle cx="20" cy="20" r="6" /></svg>
                {:else if slot.ability.kind === "restore"}
                  <svg viewBox="0 0 40 40" class="glyph"><path d="M20 6c6 0 10 4 10 10 0 8-10 18-10 18S10 24 10 16c0-6 4-10 10-10zm0 4c-3.5 0-6 2.5-6 6 0 4.5 4.5 10.5 6 12.5 1.5-2 6-8 6-12.5 0-3.5-2.5-6-6-6z" /></svg>
                {:else if slot.ability.kind === "convert"}
                  <svg viewBox="0 0 40 40" class="glyph"><path d="M12 14h12l-3-3 2-2 7 7-7 7-2-2 3-3H12v-4zm16 12H16l3 3-2 2-7-7 7-7 2 2-3 3h12v4z" /></svg>
                {:else if slot.ability.kind === "summon"}
                  <svg viewBox="0 0 40 40" class="glyph"><path d="M20 6l3 8h8l-6.5 5 2.5 8L20 22l-7 5 2.5-8L9 14h8z" /></svg>
                {:else}
                  <svg viewBox="0 0 40 40" class="glyph"><path d="M8 32L28 8l4 1 1 4L13 33l-2 2-4 1 1-4zM27 32l5-5 4 4-5 5z" /></svg>
                {/if}
                <span class="tip plate">
                  <b class="sc">{slot.ability.name}</b>
                  <span class="tcost {costColor(slot.ability)}">{costText(slot.ability) || (isSelfCastAbility(slot.ability) ? "free — click to use" : "")}</span>
                  <span class="tdesc">{describe(slot.ability)}</span>
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <button class="btn endbtn" class:suggest={suggestEnd && !endState.disabled && !endState.on} class:on={endState.on} disabled={endState.disabled} onclick={onEndTurn}>
      {endState.label}
    </button>
  </div>
{/if}

<style>
  .dock {
    position: fixed;
    bottom: 14px;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 18px;
    pointer-events: none;
  }
  .dock > * {
    pointer-events: auto;
  }

  .bagbtn {
    padding: 14px 18px 13px;
  }

  .bar {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    padding: 8px 12px 9px;
  }
  /* the plate's inner hairline fights the strips/pips — drop it */
  .bar::before {
    display: none;
  }

  .group {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .floats {
    position: absolute;
    top: -26px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 14px;
    pointer-events: none;
  }
  .pips {
    display: inline-flex;
    gap: 5px;
    align-items: center;
  }
  .epip {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 1.6px solid;
    background: transparent;
  }
  .epip.red {
    border-color: #a33b2b;
  }
  .epip.red.lit {
    background: radial-gradient(circle at 38% 32%, #e98a6d, #c0392b 70%);
    box-shadow: 0 0 6px rgba(192, 57, 43, 0.5);
  }
  .epip.blue {
    border-color: #2e6f96;
  }
  .epip.blue.lit {
    background: radial-gradient(circle at 38% 32%, #7db8e0, #2980b9 70%);
    box-shadow: 0 0 6px rgba(41, 128, 185, 0.5);
  }

  .strip {
    height: 5px;
    border-radius: 3px;
  }
  .strip.red {
    background: linear-gradient(180deg, #d0664f, #b03a28);
    box-shadow: inset 0 1px 0 rgba(255, 240, 230, 0.4);
  }
  .strip.blue {
    background: linear-gradient(180deg, #5f9dc7, #2f6f9c);
    box-shadow: inset 0 1px 0 rgba(235, 245, 255, 0.4);
  }
  .strip.none {
    background: transparent;
  }

  .slots {
    display: flex;
    gap: 8px;
  }

  .slot {
    position: relative;
    width: 62px;
    height: 62px;
    border: 1px solid var(--ink-40);
    border-radius: 7px;
    background: rgba(60, 47, 28, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.08s ease, box-shadow 0.12s ease, border-color 0.12s ease;
  }
  .slot:hover {
    border-color: var(--ink-70);
  }
  .slot.selected {
    border: 2px solid var(--slate);
    box-shadow: 0 0 0 2px rgba(78, 114, 134, 0.35), 0 0 14px rgba(78, 114, 134, 0.4);
    transform: translateY(-4px);
    background: rgba(78, 114, 134, 0.1);
  }
  .slot.unusable {
    opacity: 0.42;
    cursor: default;
  }
  .slot img {
    max-width: 48px;
    max-height: 48px;
    image-rendering: pixelated;
    filter: drop-shadow(0 2px 2px rgba(56, 40, 16, 0.35));
    pointer-events: none;
  }
  .glyph {
    width: 38px;
    height: 38px;
    fill: var(--ink-70);
  }
  .num {
    position: absolute;
    top: 2px;
    right: 5px;
    font-size: 11px;
    color: var(--ink-55);
    letter-spacing: 0;
  }
  .charges {
    position: absolute;
    bottom: 2px;
    right: 5px;
    font-size: 11px;
    color: var(--ink-70);
    letter-spacing: 0;
  }

  .tip {
    display: none;
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px 7px;
    min-width: 150px;
    text-align: center;
    z-index: 30;
    pointer-events: none;
  }
  .slot:hover .tip {
    display: flex;
  }
  .tip b {
    font-size: 12.5px;
    font-weight: 400;
  }
  .tcost {
    font-size: 13px;
  }
  .tcost.red {
    color: #a33b2b;
  }
  .tcost.blue {
    color: #2e6f96;
  }
  .tdesc {
    font-size: 13px;
    color: var(--ink-55);
  }

  .endbtn {
    padding: 16px 26px 15px;
    font-size: 14.5px;
  }
  .endbtn.suggest {
    background: linear-gradient(180deg, #f4d98d, #dfb254);
    border-color: #7d6234;
    box-shadow: 0 0 0 0 rgba(223, 178, 84, 0.55), 0 2px 0 rgba(60, 47, 28, 0.28), inset 0 1px 0 rgba(255, 252, 240, 0.6);
    animation: beckon 1.6s ease-in-out infinite;
  }
  @keyframes beckon {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(223, 178, 84, 0), 0 2px 0 rgba(60, 47, 28, 0.28), inset 0 1px 0 rgba(255, 252, 240, 0.6);
    }
    50% {
      box-shadow: 0 0 16px 3px rgba(223, 178, 84, 0.6), 0 2px 0 rgba(60, 47, 28, 0.28), inset 0 1px 0 rgba(255, 252, 240, 0.6);
    }
  }
  .endbtn.on {
    border-style: solid;
    border-color: #5f1a12;
    background: radial-gradient(circle at 35% 28%, var(--wax-hi), var(--wax) 62%, #7e241b);
    color: #f6e2cd;
    text-shadow: 0 1px 2px rgba(60, 10, 0, 0.5);
  }
</style>
