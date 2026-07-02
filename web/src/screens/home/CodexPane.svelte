<script lang="ts">
  import { codex } from "../../state/codex.svelte.js";
  import ItemChip from "../../kit/ItemChip.svelte";

  const entries = $derived(codex.entries ?? []);
</script>

<div class="panehead">
  Designs you bank on expeditions are kept here forever — bring them on future runs from the room's Manifest step.
</div>
<div class="shelfrow">
  {#each entries as entry (entry.item.id)}
    <div class="designcard">
      {#if entry.first.mine}
        <span class="first" title="World first — you discovered this design">✦</span>
      {/if}
      <ItemChip item={entry.item} />
      <div class="dname r-{entry.item.rarity}">{entry.item.name.toUpperCase()}</div>
      <div class="tags"><span class="tag">TIER {entry.tier}</span></div>
    </div>
  {/each}
</div>

<style>
  .shelfrow {
    display: flex;
    gap: 13px;
    overflow-x: auto;
    padding: 8px 2px 10px;
    align-items: stretch;
    flex-wrap: wrap;
  }
  .designcard :global(.chip) {
    margin: 0 auto;
  }
</style>
