<script lang="ts">
  import type { ContractType } from "shared";
  import { contractById } from "shared";
  import { room, isHost, hostSeat } from "../../state/room.svelte.js";
  import { chooseContract } from "../../state/actions.js";
  import { assetUrl } from "../../lib/urls.js";

  const host = $derived(isHost());
  const roomState = $derived(room.state!);
  const hostName = $derived(hostSeat()?.displayName ?? "The host");
  const chosen = $derived(roomState.contract?.type ?? null);

  // Non-hosts with an assigned contract see just the chosen one, full width (the decision, not the menu).
  const offers = $derived.by(() => {
    if (!host && chosen) return room.offers.filter((o) => o.type === chosen);
    return room.offers;
  });

  const ICONS: Partial<Record<ContractType, string>> = {
    "slay-boss": "sprites/map-icons/boss.png",
    "recover-relic": "sprites/map-icons/great-treasure.png",
    "activate-gateway": "sprites/map-icons/gateway.png",
  };
</script>

<div class="stephint">
  {#if host}
    The party's goal — completing it wins the expedition. Skip this and <b>Chart the Wilds</b> is assigned when you start. You pick this
    as host.
  {:else if chosen}
    {hostName} picked the contract — completing it wins the expedition.
  {:else}
    {hostName} picks the contract — <b>Chart the Wilds</b> is assigned if they skip it.
  {/if}
</div>
<div class="offerrow" class:hostable={host} class:inert={!host}>
  {#each offers as offer (offer.type)}
    {@const def = contractById(offer.type)}
    {@const on = chosen === offer.type}
    <button class="offer" class:on class:wide={!host && chosen === offer.type} disabled={!host} onclick={() => host && chooseContract(offer.type)}>
      {#if on}<span class="affixmark seal sm">✓</span>{/if}
      <div class="icon">
        {#if ICONS[offer.type]}
          <img src={assetUrl(ICONS[offer.type]!)} alt="" />
        {:else}
          <svg width="34" height="34" viewBox="0 0 38 36" fill="none" stroke="#3c2f1c" stroke-width="1.4" opacity=".8">
            <path d="M10 3 L17 7 L17 15 L10 19 L3 15 L3 7 Z" />
            <path d="M27 8 L34 12 L34 20 L27 24 L20 20 L20 12 Z" fill="rgba(60,47,28,.15)" />
            <path d="M14 20 L21 24 L21 32 L14 36 L7 32 L7 24 Z" opacity=".55" />
          </svg>
        {/if}
      </div>
      <div>
        <h4>
          {def.name.toUpperCase()}
          {#if offer.type === "chart-hexes"}<span class="defstamp deflabel">DEFAULT</span>{/if}
        </h4>
        <p>{def.description}</p>
        <div class="oline">
          <span class="xp">+{def.xpReward} XP</span>
          {#if offer.targetHex}
            <span class="bearing">target near ({offer.targetHex.q},{offer.targetHex.r})</span>
          {/if}
        </div>
      </div>
    </button>
  {/each}
</div>

<style>
  .offerrow {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .offer {
    position: relative;
    border: 1px solid var(--ink-40);
    border-radius: 4px;
    padding: 11px 12px 10px;
    background: rgba(255, 250, 235, 0.4);
    display: flex;
    gap: 11px;
    align-items: flex-start;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    text-align: left;
  }
  .offer.wide {
    grid-column: 1 / -1;
  }
  .hostable .offer:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 14px -8px rgba(56, 40, 16, 0.5);
    cursor: pointer;
  }
  .offer.on {
    border-color: #7d6234;
    box-shadow: 0 0 0 1px #a4854c33;
  }
  .offer .icon {
    width: 36px;
    flex: 0 0 36px;
    padding-top: 2px;
  }
  .offer .icon img {
    width: 34px;
    filter: drop-shadow(0 1px 1px rgba(56, 40, 16, 0.35));
  }
  .offer h4 {
    font-family: var(--sc);
    font-weight: 400;
    font-size: 13px;
    letter-spacing: 0.1em;
    line-height: 1.3;
  }
  .deflabel {
    margin-left: 4px;
  }
  .offer p {
    font-size: 13.5px;
    color: var(--ink-70);
    margin-top: 3px;
    line-height: 1.4;
  }
  .offer .oline {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 6px;
    font-size: 13px;
  }
  .offer .xp {
    color: #8a6c37;
    font-family: var(--sc);
    letter-spacing: 0.08em;
  }
  .offer .bearing {
    color: var(--ink-55);
    font-variant-numeric: tabular-nums;
  }
  .affixmark {
    position: absolute;
    top: -9px;
    right: -9px;
    z-index: 2;
  }
  .inert .offer {
    opacity: 0.88;
    cursor: default;
  }
</style>
