<script lang="ts">
  import { onMount } from "svelte";
  import { partyBagCapacity } from "shared";
  import { combat } from "../../state/combat.svelte.js";
  import { room } from "../../state/room.svelte.js";
  import { equip, unequip, updateAttachment } from "../../state/actions.js";
  import { PackEditor } from "../../board/inventory/pack-editor.js";
  import { BAG_PAGE_SIZE } from "../../board/inventory/inventory-layout.js";

  /** The paper-doll pack editor overlay: the grid is the SHARED party bag (paged over the painted
   *  slots); drag bag items onto your character to equip them, drag them off to return them. */
  let { open = $bindable(false) }: { open: boolean } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let editor: PackEditor | null = null;
  let page = $state(0);

  const bag = $derived(room.state?.partyBag ?? []);
  const pageCount = $derived(Math.max(1, Math.ceil(bag.length / BAG_PAGE_SIZE)));
  const bagFull = $derived(
    room.state !== null && bag.length >= partyBagCapacity(room.state.seats.length),
  );

  onMount(() => () => (editor = null));

  $effect(() => {
    if (!host || editor) return;
    editor = new PackEditor(host, {
      canEdit: () => room.state?.phase !== "combat",
      canUnequip: () => !bagFull,
      sendEquip: equip,
      sendUnequip: unequip,
      sendAttachment: updateAttachment,
      onClose: () => (open = false),
    });
  });

  $effect(() => {
    const inv = combat.inventory;
    if (editor) editor.setInventory(inv);
  });

  $effect(() => {
    const entries = bag;
    if (!editor) return;
    editor.setPartyBag(entries);
    page = editor.getPage(); // setPartyBag clamps when the bag shrinks
  });

  function flipPage(delta: number): void {
    if (!editor) return;
    editor.setPage(page + delta);
    page = editor.getPage();
  }
</script>

<svelte:document
  onkeydown={(e) => {
    if (e.key === "Escape" && open) open = false;
  }}
/>

<div class="overlay" class:shown={open} role="presentation" onclick={(e) => e.target === e.currentTarget && (open = false)}>
  <div class="column">
    <div class="wrapper" bind:this={host}></div>
    {#if pageCount > 1 || bagFull}
      <div class="bagbar">
        {#if pageCount > 1}
          <button class="btn ghost pagebtn" disabled={page === 0} onclick={() => flipPage(-1)}>◀</button>
          <span class="pagecount sc">{page + 1} / {pageCount}</span>
          <button class="btn ghost pagebtn" disabled={page >= pageCount - 1} onclick={() => flipPage(1)}>▶</button>
        {/if}
        {#if bagFull}
          <span class="fullnote">party bag full</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /* Kept mounted (display-toggled) so the editor's canvas, sprites, and positions persist. */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 130;
    background: rgba(46, 32, 12, 0.45);
    display: none;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(1.5px);
  }
  .overlay.shown {
    display: flex;
  }
  .column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .wrapper {
    position: relative;
  }
  .bagbar {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .pagebtn {
    font-size: 13px;
    padding: 4px 14px 3px;
  }
  .pagecount {
    font-size: 13px;
    letter-spacing: 0.12em;
    color: #f3e7c1;
    font-variant-numeric: tabular-nums;
  }
  .fullnote {
    font-size: 13px;
    color: #e0b98a;
  }
</style>
