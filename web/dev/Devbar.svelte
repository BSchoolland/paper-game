<script lang="ts">
  import { fixtureNames } from "./mock-boot.js";

  const current = new URLSearchParams(window.location.search).get("mock") || "lv1";

  function go(name: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("mock", name);
    window.location.href = url.toString();
  }
</script>

<nav class="mockchrome devbar">
  <span class="lbl">MOCK STATES</span>
  {#each fixtureNames() as [name, label] (name)}
    <button class:on={name === current} onclick={() => go(name)}>{label}</button>
  {/each}
</nav>

<style>
  .devbar {
    position: fixed;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 70;
  }
</style>
