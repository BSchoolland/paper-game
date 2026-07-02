<script lang="ts">
  import { room, isHost, hostSeat } from "../../state/room.svelte.js";
  import { chooseDimension } from "../../state/actions.js";
  import { dimMeta } from "../../state/dim-meta.svelte.js";
  import { apiUrl, assetUrl } from "../../lib/urls.js";

  const host = $derived(isHost());
  const roomState = $derived(room.state!);
  const options = $derived(room.options);
  const hostName = $derived(hostSeat()?.displayName ?? "The host");

  /** A couple of idle enemy sprites as the destination's fauna row. */
  function fauna(dimensionId: number): string[] {
    const meta = dimMeta.byId[dimensionId];
    if (!meta) return [];
    return meta.spritePaths.filter((p) => p.includes("idle")).slice(0, 2);
  }
</script>

<div class="stephint">
  {#if host}
    Where the expedition starts. The list holds every dimension someone in this room has reached — tier 0 is open to everyone. You pick
    this as host.
  {:else}
    {hostName} picks the destination — you'll see it change live here.
  {/if}
</div>
<div class="atlasrow" class:hostable={host} class:inert={!host}>
  {#each options as opt (opt.id)}
    {@const meta = dimMeta.byId[opt.id]}
    {@const on = opt.id === roomState.dimensionId}
    <button class="atlas" class:on disabled={!host} onclick={() => host && chooseDimension(opt.id)}>
      {#if on}<span class="affixmark seal sm">✓</span>{/if}
      <div class="art" style={meta?.thumbPath ? `background-image:url('${assetUrl(meta.thumbPath)}')` : ""}></div>
      <div class="aname">{opt.name.toUpperCase()} <span class="tag">TIER {opt.tier}</span></div>
      <div class="afauna">
        {#each fauna(opt.id) as sprite (sprite)}
          <img src={apiUrl(sprite)} alt="" />
        {/each}
      </div>
    </button>
  {/each}
</div>

<style>
  .atlasrow {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 13px;
  }
  .atlas {
    border: 1px solid var(--ink-40);
    border-radius: 4px;
    position: relative;
    background: rgba(255, 250, 235, 0.4);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    text-align: left;
    padding: 0;
  }
  .atlas .art {
    height: 96px;
    background-size: 210%;
    background-position: center 42%;
    box-shadow: inset 0 0 16px rgba(88, 64, 28, 0.35);
    border-bottom: 1px solid var(--ink-25);
    border-radius: 3px 3px 0 0;
  }
  .atlas .aname {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 8px 10px 3px;
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.08em;
  }
  .atlas .afauna {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px 8px;
    min-height: 36px;
  }
  .atlas .afauna img {
    height: 26px;
    width: auto;
    opacity: 0.85;
    filter: sepia(0.25) saturate(0.8) drop-shadow(0 1px 1px rgba(56, 40, 16, 0.3));
  }
  .hostable .atlas:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 14px -8px rgba(56, 40, 16, 0.5);
    cursor: pointer;
  }
  .atlas.on {
    border-color: #7d6234;
    box-shadow: 0 0 0 1px #a4854c33, 0 6px 12px -8px rgba(56, 40, 16, 0.5);
  }
  .affixmark {
    position: absolute;
    top: -9px;
    right: -9px;
    z-index: 2;
  }
  .inert .atlas {
    opacity: 0.88;
    cursor: default;
  }
</style>
