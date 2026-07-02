<script lang="ts">
  import { room } from "../../state/room.svelte.js";
  import { combat } from "../../state/combat.svelte.js";
  import { claimLoot } from "../../state/actions.js";
  import ItemChip from "../../kit/ItemChip.svelte";

  const pool = $derived(room.state?.phase === "overworld" ? (room.state.lootPool ?? []) : []);
  const bagFull = $derived(combat.inventory !== null && combat.inventory.bag.indexOf(null) === -1);
  const voteOpen = $derived(room.vote !== null);
</script>

{#if pool.length > 0}
  <div class="plate lootpanel">
    <div class="lhead sc">PARTY SPOILS <span class="dim lcount">{pool.length}</span></div>
    <div class="list">
      {#each pool as entry (entry.lootId)}
        <div class="lrow">
          <ItemChip item={entry.item} small />
          <span class="lname r-{entry.item.rarity}">{entry.item.name}</span>
          <button
            class="btn ghost claimbtn"
            disabled={voteOpen || bagFull}
            title={bagFull ? "Bag full" : ""}
            onclick={() => claimLoot(entry.lootId)}>CLAIM</button
          >
        </div>
      {/each}
    </div>
    <div class="lcap dim">claiming opens a party vote</div>
  </div>
{/if}

<style>
  .lootpanel {
    position: fixed;
    top: 64px;
    left: 14px;
    z-index: 110;
    width: 264px;
    padding: 12px 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lhead {
    font-size: 11px;
    letter-spacing: 0.22em;
    color: var(--ink-55);
  }
  .lcount {
    letter-spacing: 0;
    font-family: var(--body);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    max-height: 300px;
    overflow-y: auto;
  }
  .lrow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lname {
    flex: 1;
    min-width: 0;
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.05em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .claimbtn {
    flex: 0 0 auto;
    font-size: 11px;
    padding: 3px 10px 2px;
  }
  .lcap {
    font-size: 12.5px;
    text-align: center;
  }
</style>
