<script lang="ts">
  import { PROTOCOL_VERSION } from "shared";
  import Compass from "../kit/Compass.svelte";
  import { session } from "../state/session.svelte.js";
  import { retryConnect, stayHere, takeOverSeat } from "../state/actions.js";

  /**
   * The four full-stop faces. Which one shows is pure state:
   * update/elsewhere are terminal halts, rejoin is an offered seat reclaim,
   * connecting is everything before the first welcome.
   */
  const face = $derived.by(() => {
    if (session.halted?.kind === "update") return "update" as const;
    if (session.halted?.kind === "displaced") return "elsewhere" as const;
    if (session.reclaim?.phase === "offered") return "rejoin" as const;
    return "connecting" as const;
  });
</script>

<section class="screen">
  <div class="gatewrap">
    <div class="plate gateplate">
      <Compass size={70} swing={face === "connecting"} />

      {#if face === "connecting"}
        <h2>CONNECTING…</h2>
        <p>Finding the server. This retries by itself.</p>
        <div class="underact"><button class="linkish" onclick={retryConnect}>retry now</button></div>
      {:else if face === "update"}
        <div style="margin-bottom:12px"><span class="stamp terra">UPDATE REQUIRED</span></div>
        <h2>A NEW VERSION IS OUT</h2>
        <p>
          This window is running an old version ({session.halted?.kind === "update" ? session.halted.clientVersion : PROTOCOL_VERSION} →
          {session.halted?.kind === "update" ? session.halted.serverVersion : "?"}). Refresh to update — your account and any running
          expedition are safe.
        </p>
        <div class="acts"><button class="btn gilt" onclick={() => window.location.reload()}>REFRESH</button></div>
      {:else if face === "elsewhere"}
        <h2>SIGNED IN SOMEWHERE ELSE</h2>
        <p>Your account connected from another device or tab, and it took over this session. Nothing was lost.</p>
        <div class="acts"><button class="btn" onclick={() => window.location.reload()}>BACK TO HOME</button></div>
      {:else}
        <h2>REJOIN YOUR ROOM?</h2>
        <p>
          You're still seated in room <b class="sc" style="letter-spacing:.2em">{session.reclaim?.code}</b>, but that session is active
          on another device or tab.
        </p>
        <div class="acts">
          <button class="btn wax" onclick={takeOverSeat}>TAKE OVER SEAT</button>
          <button class="btn ghost" onclick={stayHere}>STAY HERE</button>
        </div>
        <div class="underact">taking over disconnects the other device</div>
      {/if}
    </div>
  </div>
</section>

<style>
  .gatewrap {
    min-height: 78vh;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 22px;
    padding: 40px 20px;
  }
  .gateplate {
    width: 490px;
    max-width: 94vw;
    padding: 34px 38px 30px;
    text-align: center;
  }
  .gateplate :global(.compass) {
    margin: 2px auto 14px;
  }
  h2 {
    font-family: var(--sc);
    font-weight: 400;
    font-size: 18px;
    letter-spacing: 0.24em;
    margin-bottom: 10px;
  }
  p {
    font-size: 15.5px;
    color: var(--ink-70);
    line-height: 1.55;
  }
  .acts {
    margin-top: 20px;
    display: flex;
    gap: 14px;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
  }
  .underact {
    font-size: 13.5px;
    color: var(--ink-55);
    margin-top: 12px;
  }
</style>
