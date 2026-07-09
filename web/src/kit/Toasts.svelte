<script lang="ts">
  import { titleById, RARITY_ORDER } from "shared";
  import type { ItemDefinition, ItemRarity, PartyBagEntry } from "shared";
  import { chrome, dismissToast } from "../state/chrome.svelte.js";
  import { joinByCode } from "../state/actions.js";
  import { dimMeta } from "../state/dim-meta.svelte.js";
  import ItemChip from "./ItemChip.svelte";

  // The loot moment scales with the best drop: rare+ gets a headline and an ability preview.
  const rarityRank = (r: ItemRarity) => RARITY_ORDER.indexOf(r);
  function bestDrop(drops: readonly PartyBagEntry[]): PartyBagEntry {
    return drops.reduce((a, b) => (rarityRank(b.item.rarity) > rarityRank(a.item.rarity) ? b : a));
  }
  function lootHeadline(drops: readonly PartyBagEntry[]): { text: string; rarity: ItemRarity } | null {
    const best = bestDrop(drops).item;
    if (rarityRank(best.rarity) < rarityRank("rare")) return null;
    return { text: best.rarity === "legendary" ? "LEGENDARY" : `${best.rarity.toUpperCase()} FIND`, rarity: best.rarity };
  }
  function abilityPreview(item: ItemDefinition): string[] {
    const lines = (item.abilities ?? []).map((a) => a.name);
    for (const p of item.passives ?? []) {
      if (p.type === "aura") lines.push(`${p.aura.effect} aura`);
      else if (p.type === "onKillEnergy") lines.push("on-kill energy");
      else if (p.type === "maxHp") lines.push(`+${p.amount} max HP`);
      else lines.push("bonus regen");
    }
    return lines;
  }
</script>

<div class="toaststack">
  {#each chrome.toasts as toast (toast.id)}
    <div class="plate pin toast" class:gilt-t={toast.kind === "titles" || toast.kind === "codexBanked"}>
      <button class="x" onclick={() => dismissToast(toast.id)}>✕</button>
      {#if toast.kind === "invite"}
        <div class="hand invitehead">{toast.from} invited you to their room</div>
        <div class="sub">{dimMeta.byId[toast.dimensionId]?.name ?? ""} · room {toast.code}</div>
        <button class="btn gilt" onclick={() => joinByCode(toast.code)}>JOIN</button>
      {:else if toast.kind === "titles"}
        <div class="t-title">TITLE EARNED</div>
        {#each toast.titleIds as id (id)}
          <div class="tname sc">{titleById(id).name}</div>
          <div class="sub">{titleById(id).description}</div>
        {/each}
      {:else if toast.kind === "loot"}
        {@const headline = lootHeadline(toast.drops)}
        {#if headline}
          <div class="t-title bigfind r-{headline.rarity}">✦ {headline.text} ✦</div>
        {:else}
          <div class="t-title" style="color:var(--moss)">LOOT FOUND</div>
        {/if}
        {#each toast.drops as drop (drop.bagId)}
          {@const showcase = headline && drop.bagId === bestDrop(toast.drops).bagId}
          <div class="lootrow" class:lootstar={showcase}>
            <ItemChip item={drop.item} small />
            <div>
              <span class="lname r-{drop.item.rarity}">{drop.item.name}</span>
              {#if showcase}
                <div class="abilitypreview">{abilityPreview(drop.item).join(" · ")}</div>
              {/if}
            </div>
          </div>
        {/each}
        <div class="sub">added to the party bag</div>
      {:else if toast.kind === "xpBanked"}
        <div class="t-title">EXPEDITION BANKED</div>
        <div class="tname sc">+{toast.banked.banked} XP</div>
        <div class="sub">
          {toast.banked.pending} × {toast.banked.multiplier}
          {#if toast.banked.leveledUp}— level {toast.banked.level}!{/if}
        </div>
      {:else if toast.kind === "codexBanked"}
        <div class="t-title">DESIGNS BANKED</div>
        {#each toast.entries as entry (entry.item.id)}
          <div class="lootrow">
            <ItemChip item={entry.item} small />
            <span class="lname r-{entry.item.rarity}">
              {entry.item.name}
              {#if toast.firstItemIds.includes(entry.item.id)}<span class="first">✦ world first</span>{/if}
            </span>
          </div>
        {/each}
      {:else if toast.kind === "error"}
        <div class="sub errtext">✕ {toast.message}</div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toaststack {
    position: fixed;
    right: 22px;
    bottom: 74px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 55;
    width: 290px;
  }
  .toast {
    padding: 12px 14px 11px;
    transform: rotate(0.8deg);
    animation: toastin 0.45s ease;
  }
  .toast:nth-child(even) {
    transform: rotate(-0.7deg);
  }
  @keyframes toastin {
    from {
      transform: translateX(26px) rotate(2deg);
    }
  }
  .x {
    position: absolute;
    top: 6px;
    right: 9px;
    color: var(--ink-40);
    cursor: pointer;
  }
  .invitehead {
    font-size: 21px;
    font-weight: 600;
    line-height: 1.15;
    color: var(--ink-s1);
  }
  .sub {
    font-size: 13.5px;
    color: var(--ink-55);
    margin-top: 3px;
  }
  .toast :global(.btn) {
    margin-top: 9px;
    padding: 5px 12px 4px;
    font-size: 12px;
  }
  .t-title {
    color: #8a6c37;
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.2em;
  }
  .tname {
    font-size: 15px;
    letter-spacing: 0.1em;
    margin-top: 4px;
    color: var(--gilt);
  }
  .lootrow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .lname {
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.06em;
    line-height: 1.3;
  }
  .first {
    color: var(--gilt);
    text-shadow: 0 0 7px rgba(201, 167, 99, 0.7);
    font-size: 12px;
    margin-left: 5px;
  }
  .errtext {
    color: #8c3a1e;
    font-size: 14px;
  }
  .bigfind {
    font-size: 15px;
    letter-spacing: 0.28em;
    text-shadow: 0 0 9px rgba(201, 167, 99, 0.55);
    animation: findpulse 1.1s ease-in-out 3;
  }
  @keyframes findpulse {
    50% {
      text-shadow: 0 0 16px rgba(201, 167, 99, 0.95);
    }
  }
  .lootstar {
    padding: 4px 6px;
    margin-left: -6px;
    border-radius: 4px;
    background: rgba(201, 167, 99, 0.09);
  }
  .abilitypreview {
    font-size: 11.5px;
    color: var(--ink-55);
    margin-top: 2px;
    line-height: 1.35;
  }
</style>
