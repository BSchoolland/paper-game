<script lang="ts">
  import { STARTER_PRESETS, DEFAULT_PRESET_ID, getPreset } from "shared";
  import { mySeat } from "../../state/room.svelte.js";
  import { choosePreset } from "../../state/actions.js";
  import ItemChip from "../../kit/ItemChip.svelte";

  let { onadjust }: { onadjust: () => void } = $props();

  const me = $derived(mySeat());
  const currentId = $derived(me?.presetId ?? DEFAULT_PRESET_ID);
  const current = $derived(getPreset(currentId) ?? getPreset(DEFAULT_PRESET_ID)!);

  const KIT_BLURBS: Record<string, string> = {
    vanguard: "Sword and shield — holds the front line.",
    ranger: "Bow and quiver — strikes from range.",
    mystic: "Staff and spellbook — zones and control.",
  };
</script>

<div class="stephint">Your starting gear. Each player picks their own — nobody waits on you.</div>
<div class="kitrow">
  {#each STARTER_PRESETS as preset (preset.id)}
    {@const on = preset.id === currentId}
    <button class="kit" class:on onclick={() => choosePreset(preset.id)}>
      {#if on}<span class="affixmark seal sm">✓</span>{/if}
      <div class="kchips">
        {#each preset.equippedIds as id (id)}
          <ItemChip item={{ sprite: id, dimensionId: 0 }} small />
        {/each}
      </div>
      <h4>{preset.name.toUpperCase()}</h4>
      <p>{KIT_BLURBS[preset.id] ?? preset.description}</p>
    </button>
  {/each}
</div>
<div class="packrow">
  <span class="cap">your pack:</span>
  {#each current.equippedIds as id (id)}
    <div class="packitem">
      <ItemChip item={{ sprite: id, dimensionId: 0 }} />
      <div class="lab">IN HAND</div>
    </div>
  {/each}
  {#each current.bagIds as id, i (i)}
    <div class="packitem">
      <ItemChip item={{ sprite: id, dimensionId: 0 }} />
      <div class="lab">BAG</div>
    </div>
  {/each}
  <button class="linkish adjustlink" onclick={onadjust}>adjust pack ▾</button>
</div>

<style>
  .kitrow {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .kit {
    position: relative;
    border: 1px solid var(--ink-40);
    border-radius: 4px;
    padding: 11px;
    background: rgba(255, 250, 235, 0.4);
    cursor: pointer;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    text-align: left;
  }
  .kit:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 14px -8px rgba(56, 40, 16, 0.5);
  }
  .kit.on {
    border-color: #7d6234;
    box-shadow: 0 0 0 1px #a4854c33;
  }
  .kit .kchips {
    display: flex;
    gap: 8px;
    margin-bottom: 7px;
  }
  .kit h4 {
    font-family: var(--sc);
    font-weight: 400;
    font-size: 13px;
    letter-spacing: 0.14em;
  }
  .kit p {
    font-size: 13.5px;
    color: var(--ink-70);
    margin-top: 3px;
    line-height: 1.4;
  }
  .affixmark {
    position: absolute;
    top: -9px;
    right: -9px;
    z-index: 2;
  }
  .packrow {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  .packrow .cap {
    font-size: 13.5px;
    color: var(--ink-55);
    align-self: center;
  }
  .packitem {
    text-align: center;
    width: 56px;
  }
  .packitem :global(.chip) {
    margin: 0 auto;
  }
  .packitem .lab {
    font-size: 12.5px;
    font-family: var(--sc);
    letter-spacing: 0.1em;
    color: var(--ink-55);
    margin-top: 3px;
  }
  .adjustlink {
    align-self: center;
  }
</style>
