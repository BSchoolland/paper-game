<script lang="ts">
  import { onMount } from "svelte";
  import { combat } from "../../state/combat.svelte.js";
  import { room } from "../../state/room.svelte.js";
  import { equip, unequip, updateAttachment } from "../../state/actions.js";
  import { PackEditor } from "../../board/inventory/pack-editor.js";

  /** The paper-doll pack editor overlay: drag bag items onto the character to equip and place
   *  them; the placement is what your character wears in combat and on the overworld. */
  let { open = $bindable(false) }: { open: boolean } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let editor: PackEditor | null = null;

  onMount(() => () => (editor = null));

  $effect(() => {
    if (!host || editor) return;
    editor = new PackEditor(host, {
      canEdit: () => room.state?.phase !== "combat",
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
</script>

<svelte:document
  onkeydown={(e) => {
    if (e.key === "Escape" && open) open = false;
  }}
/>

<div class="overlay" class:shown={open} role="presentation" onclick={(e) => e.target === e.currentTarget && (open = false)}>
  <div class="wrapper" bind:this={host}></div>
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
  .wrapper {
    position: relative;
  }
</style>
