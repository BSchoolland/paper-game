<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    class: cls = "",
    children,
  }: {
    open: boolean;
    /** Positioning class from the caller's scoped styles (e.g. profpop, invitepop). */
    class?: string;
    children: Snippet;
  } = $props();

  function onDocPointer(e: PointerEvent): void {
    const el = e.target as Element;
    // Clicks inside the popover (or on the toggle that owns it) don't close it.
    if (el.closest("[data-popover]") || el.closest("[data-popover-toggle]")) return;
    open = false;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") open = false;
  }
</script>

<svelte:document onpointerdown={open ? onDocPointer : undefined} onkeydown={open ? onKey : undefined} />

{#if open}
  <div class="plate pop {cls}" data-popover>
    {@render children()}
  </div>
{/if}

<style>
  .pop {
    position: absolute;
    z-index: 45;
    animation: settle 0.25s ease;
  }
</style>
