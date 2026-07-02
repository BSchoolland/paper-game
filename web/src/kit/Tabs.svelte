<script lang="ts">
  import type { Snippet } from "svelte";

  interface TabDef {
    id: string;
    label?: string;
    count?: string;
  }

  let {
    tabs,
    active = $bindable(),
    bodyClass = "",
    stripClass = "",
    tab,
    pane,
  }: {
    tabs: TabDef[];
    active: string;
    /** Fixed-height body variant: "h-home" | "h-room" (materials.css). */
    bodyClass?: string;
    stripClass?: string;
    /** Custom tab content (e.g. two-line step tabs). Default renders label + count. */
    tab?: Snippet<[TabDef, boolean]>;
    pane: Snippet<[string]>;
  } = $props();

  let body: HTMLDivElement;

  function select(id: string): void {
    active = id;
    body.scrollTop = 0;
  }
</script>

<div class="tabs">
  <div class="tabstrip {stripClass}">
    {#each tabs as t (t.id)}
      <button
        class="tab"
        class:steptab={tab !== undefined}
        class:on={active === t.id}
        onclick={() => select(t.id)}
      >
        {#if tab}
          {@render tab(t, active === t.id)}
        {:else}
          {t.label}{#if t.count !== undefined}<span class="tcount">{t.count}</span>{/if}
        {/if}
      </button>
    {/each}
  </div>
  <div class="tabbody {bodyClass}" bind:this={body}>
    {#key active}
      <div class="tabpane">
        {@render pane(active)}
      </div>
    {/key}
  </div>
</div>
