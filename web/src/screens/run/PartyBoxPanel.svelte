<script lang="ts">
  import type { ItemDefinition } from "shared";
  import { room } from "../../state/room.svelte.js";
  import { combat } from "../../state/combat.svelte.js";
  import { takeLoot, stashLoot } from "../../state/actions.js";
  import ItemChip from "../../kit/ItemChip.svelte";

  /** The party box: found loot lands here automatically; anyone can take from it or stash into it. */
  const inOverworld = $derived(room.state?.phase === "overworld");
  const box = $derived(inOverworld ? (room.state?.lootPool ?? []) : []);
  const bagFull = $derived(combat.inventory !== null && combat.inventory.bag.indexOf(null) === -1);
  const bagItems = $derived(
    (combat.inventory?.bag ?? [])
      .map((item, bagIndex) => ({ item, bagIndex }))
      .filter((s): s is { item: ItemDefinition; bagIndex: number } => s.item !== null),
  );

  let stashOpen = $state(false);
</script>

{#if inOverworld}
  <div class="plate boxpanel">
    <div class="bhead sc">PARTY BOX <span class="dim bcount">{box.length}</span></div>
    {#if box.length > 0}
      <div class="list">
        {#each box as entry (entry.lootId)}
          <div class="brow">
            <ItemChip item={entry.item} small />
            <span class="bname r-{entry.item.rarity}">{entry.item.name}</span>
            <button
              class="btn ghost rowbtn"
              disabled={bagFull}
              title={bagFull ? "Bag full" : ""}
              onclick={() => takeLoot(entry.lootId)}>TAKE</button
            >
          </div>
        {/each}
      </div>
    {:else}
      <div class="bempty dim">empty</div>
    {/if}
    <button class="btn ghost stashtoggle" onclick={() => (stashOpen = !stashOpen)}>
      {stashOpen ? "STASH ▴" : "STASH ▾"}
    </button>
    {#if stashOpen}
      {#if bagItems.length > 0}
        <div class="list">
          {#each bagItems as slot (slot.bagIndex)}
            <div class="brow">
              <ItemChip item={slot.item} small />
              <span class="bname r-{slot.item.rarity}">{slot.item.name}</span>
              <button class="btn ghost rowbtn" onclick={() => stashLoot(slot.bagIndex)}>PUT</button>
            </div>
          {/each}
        </div>
      {:else}
        <div class="bempty dim">your bag is empty</div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .boxpanel {
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
  .bhead {
    font-size: 11px;
    letter-spacing: 0.22em;
    color: var(--ink-55);
  }
  .bcount {
    letter-spacing: 0;
    font-family: var(--body);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    max-height: 220px;
    overflow-y: auto;
  }
  .brow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .bname {
    flex: 1;
    min-width: 0;
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.05em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rowbtn {
    flex: 0 0 auto;
    font-size: 11px;
    padding: 3px 10px 2px;
  }
  .bempty {
    font-size: 12.5px;
    text-align: center;
  }
  .stashtoggle {
    font-size: 11px;
    padding: 3px 10px 2px;
    align-self: center;
  }
</style>
