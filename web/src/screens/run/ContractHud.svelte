<script lang="ts">
  import { contractById, getHexIcon, hexDistance, hexKey, isRetreatHex, threatMultiplier, REST_BARRIER_HP } from "shared";
  import { room } from "../../state/room.svelte.js";
  import { overworld } from "../../state/overworld.svelte.js";
  import { session } from "../../state/session.svelte.js";
  import { proposeRetreat, proposeTravel } from "../../state/actions.js";

  const roomState = $derived(room.state);
  const contract = $derived(roomState?.contract ?? null);
  const hexMap = $derived(overworld.hexMap);
  const def = $derived(contract ? contractById(contract.type) : null);

  const onGateway = $derived.by(() => {
    if (!hexMap) return false;
    return isRetreatHex(getHexIcon(hexMap.playerPos, hexMap.icons));
  });
  const gateway = $derived(hexMap && onGateway ? (overworld.gateways[hexKey(hexMap.playerPos)] ?? null) : null);
  const threat = $derived(
    hexMap && roomState ? threatMultiplier(roomState.dimensionTier, hexDistance(hexMap.playerPos, { q: 0, r: 0 })) : null,
  );
</script>

{#if roomState?.phase === "overworld"}
  <div class="plate contracthud">
    {#if roomState.rested}
      <div class="rested">Rested — fortified for the next battle <span class="dim">+{REST_BARRIER_HP}</span></div>
    {/if}

    {#if contract && def}
      <div class="chead sc">CONTRACT</div>
      <div class="cname sc">{def.name.toUpperCase()}</div>
      {#if contract.completed}
        <div class="done">✓ Fulfilled</div>
      {:else if contract.type === "chart-hexes"}
        <div class="cline">Cleared {contract.progress}/{contract.required}</div>
        <div class="track"><div class="fill" style="width:{Math.round((contract.progress / contract.required) * 100)}%"></div></div>
      {:else}
        <div class="cline">{def.description}</div>
        {#if contract.targetHex && hexMap}
          <div class="bearing dim">Target: ({contract.targetHex.q}, {contract.targetHex.r}) — {hexDistance(hexMap.playerPos, contract.targetHex)} hexes</div>
        {/if}
      {/if}
    {/if}

    {#if onGateway}
      <div class="rule gaterule"></div>
      {#if gateway}
        <div class="gatedest">Gateway → <b>{gateway.toName}</b> · Tier {gateway.toTier}</div>
        <button class="btn wax gatebtn" onclick={proposeTravel}>DESCEND…</button>
        <div class="gatecap dim">travel deeper — the run continues at tier {gateway.toTier}</div>
      {:else}
        <div class="gatedest dim">Gateway unattuned — nothing lies beyond yet</div>
      {/if}
      <button class="btn ghost gatebtn retreatbtn" onclick={proposeRetreat}>RETREAT…</button>
      <div class="gatecap dim">banks 50% of pending XP · forfeits the contract</div>
    {/if}

    <div class="statline">
      {#if threat !== null}
        <span class="threat" class:hot={threat >= 2} class:warm={threat >= 1.5 && threat < 2}>Threat ×{threat.toFixed(1)}</span>
      {/if}
      <span class="dim">Pending: {session.xpPending} XP</span>
    </div>
  </div>
{/if}

<style>
  .contracthud {
    position: fixed;
    top: 64px;
    right: 14px;
    z-index: 110;
    width: 248px;
    padding: 12px 16px 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chead {
    font-size: 11px;
    letter-spacing: 0.22em;
    color: var(--ink-55);
  }
  .cname {
    font-size: 14px;
    letter-spacing: 0.12em;
  }
  .cline {
    font-size: 14px;
    color: var(--ink-70);
    line-height: 1.45;
  }
  .done {
    font-size: 14px;
    color: var(--moss);
  }
  .rested {
    font-size: 13.5px;
    color: var(--moss);
  }
  .bearing {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 7px;
    border: 1px solid var(--ink-40);
    border-radius: 4px;
    background: rgba(60, 47, 28, 0.08);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--gilt-hi), var(--gilt));
  }
  .gaterule {
    margin: 6px 0 4px;
  }
  .gatedest {
    font-size: 13.5px;
  }
  .gatebtn {
    width: 100%;
    font-size: 12.5px;
    padding: 8px 10px 7px;
  }
  .retreatbtn {
    border-color: #a3512f88;
    color: #8c4526;
  }
  .gatecap {
    font-size: 12.5px;
    text-align: center;
    margin-top: -2px;
  }
  .statline {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    margin-top: 4px;
  }
  .threat {
    color: var(--ink-55);
  }
  .threat.warm {
    color: #8a6c37;
  }
  .threat.hot {
    color: #8c3a1e;
  }
</style>
