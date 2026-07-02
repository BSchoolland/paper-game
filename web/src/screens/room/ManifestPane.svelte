<script lang="ts">
  import { expeditionSlots } from "shared";
  import { room, mySeat } from "../../state/room.svelte.js";
  import { profile } from "../../state/session.svelte.js";
  import { codex } from "../../state/codex.svelte.js";
  import { chooseManifest } from "../../state/actions.js";
  import ItemChip from "../../kit/ItemChip.svelte";

  const me = $derived(mySeat());
  const roomState = $derived(room.state!);
  const prof = $derived(profile());
  const slots = $derived(expeditionSlots(prof?.level ?? 1));
  const runTier = $derived(roomState.dimensionTier);
  const picks = $derived(me?.manifestIds ?? []);
  const entries = $derived(codex.entries ?? []);
  const byItemId = $derived(new Map(entries.map((e) => [e.item.id, e])));

  function eligibility(itemId: string): string | null {
    const entry = byItemId.get(itemId);
    if (!entry) return "not in your codex";
    if (entry.item.type === "consumable") return "consumable — can't be manifested";
    if (runTier !== null && entry.tier > runTier) return `tier ${entry.tier} — too deep for this run`;
    return null;
  }

  function toggle(itemId: string): void {
    if (picks.includes(itemId)) {
      chooseManifest(picks.filter((id) => id !== itemId));
    } else {
      if (picks.length >= slots || eligibility(itemId) !== null) return;
      chooseManifest([...picks, itemId]);
    }
  }
</script>

<div class="stephint">
  {#if entries.length === 0}
    Optional: designs you bank on expeditions can be brought into future runs. Your codex is empty — finish a run and anything you bank
    will appear here.
  {:else}
    Optional: bring up to <b>{slots}</b> codex designs into this run (your level {prof?.level ?? 1} → {slots} slots).
    {#if runTier !== null}This run allows tier {runTier} or lower.{/if}
  {/if}
</div>

{#if room.returnedManifestIds.length > 0}
  <div class="marginnote warn">
    Your
    {#each room.returnedManifestIds as id, i (id)}
      {#if i > 0}{" and "}{/if}<b>{byItemId.get(id)?.item.name ?? id}</b>
    {/each}
    {room.returnedManifestIds.length === 1 ? "was" : "were"} returned to your codex — the destination changed to a tier-{runTier}
    dimension.
  </div>
{/if}

{#if entries.length > 0}
  <div class="wells">
    {#each Array.from({ length: slots }, (_, i) => picks[i]) as pick, i (i)}
      {@const entry = pick ? byItemId.get(pick) : undefined}
      <div class="well" class:filled={entry !== undefined}>
        <div class="wellbox">
          {#if entry}
            <ItemChip item={entry.item} />
            <button class="rm" onclick={() => toggle(entry.item.id)}>✕</button>
          {:else}
            <span class="plus">+</span>
          {/if}
        </div>
        {#if entry}<div class="wname r-{entry.item.rarity}">{entry.item.name.toUpperCase()}</div>{/if}
      </div>
    {/each}
    <span class="cap">Manifested designs land in your bag at start — you keep the design either way.</span>
  </div>
  <div class="pickgrid">
    {#each entries as entry (entry.item.id)}
      {@const picked = picks.includes(entry.item.id)}
      {@const why = eligibility(entry.item.id)}
      <button class="pick" class:picked class:ok={!picked && why === null} class:no={why !== null} onclick={() => toggle(entry.item.id)}>
        {#if picked}<span class="affixmark seal sm">✓</span>{/if}
        <ItemChip item={entry.item} />
        <div class="pname r-{entry.item.rarity}">{entry.item.name.toUpperCase()}</div>
        <div class="ptags"><span class="tag">TIER {entry.tier}</span></div>
        {#if why}<div class="why">{why}</div>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .wells {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    margin-bottom: 4px;
  }
  .well {
    width: 92px;
    text-align: center;
  }
  .wellbox {
    width: 66px;
    height: 66px;
    margin: 0 auto;
    border: 2px dashed var(--ink-40);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: rgba(60, 47, 28, 0.03);
  }
  .well.filled .wellbox {
    border-style: solid;
    border-color: var(--ink-55);
    background: rgba(255, 250, 235, 0.5);
  }
  .wellbox :global(.chip) {
    border: none;
    background: none;
  }
  .wellbox .rm {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--paper-hi);
    border: 1px solid var(--ink-40);
    font-size: 12px;
    line-height: 18px;
    color: var(--terra);
    cursor: pointer;
  }
  .wellbox .plus {
    font-size: 22px;
    color: var(--ink-40);
  }
  .well .wname {
    font-size: 12.5px;
    font-family: var(--sc);
    letter-spacing: 0.05em;
    margin-top: 5px;
    line-height: 1.3;
  }
  .wells .cap {
    font-size: 13.5px;
    color: var(--ink-55);
    align-self: center;
    line-height: 1.5;
    max-width: 340px;
  }
  .pickgrid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 11px;
    margin-top: 14px;
  }
  .pick {
    position: relative;
    border: 1px solid var(--ink-25);
    border-radius: 4px;
    padding: 9px 8px;
    background: rgba(255, 250, 235, 0.4);
    text-align: center;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }
  .pick :global(.chip) {
    margin: 0 auto;
  }
  .pick.ok:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 14px -8px rgba(56, 40, 16, 0.5);
    cursor: pointer;
  }
  .pick.picked {
    border-color: #7d6234;
    box-shadow: 0 0 0 1px #a4854c33;
    cursor: pointer;
  }
  .pick.no {
    opacity: 0.5;
    cursor: default;
  }
  .pick .pname {
    font-family: var(--sc);
    font-size: 12px;
    letter-spacing: 0.05em;
    margin-top: 6px;
    line-height: 1.3;
  }
  .pick .ptags {
    margin-top: 5px;
    display: flex;
    gap: 4px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .pick .why {
    color: #8c4526;
    font-size: 13px;
    margin-top: 4px;
    line-height: 1.3;
  }
  .affixmark {
    position: absolute;
    top: -9px;
    right: -9px;
    z-index: 2;
  }
</style>
