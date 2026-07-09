<script lang="ts">
  import { loading } from "../state/loading.svelte.js";
  import Compass from "./Compass.svelte";

  /** Opaque cover while board assets load — hides half-built scenes (map art still in flight). */
  const label = $derived(loading.jobs.at(-1) ?? null);
</script>

{#if label !== null}
  <div class="loadwrap">
    <Compass size={64} swing />
    <span class="sc label">{label}<span class="dots"><span>.</span><span>.</span><span>.</span></span></span>
  </div>
{/if}

<style>
  .loadwrap {
    position: fixed;
    inset: 0;
    z-index: 140;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    background: #e2cf9d url("/sprites/map-objects/backgrounds/background-light.png") center/cover no-repeat;
    /* Delay the reveal so a fast (cached) load never flashes the cover. */
    animation: load-in 0.25s ease 0.15s both;
  }
  .label {
    font-size: 17px;
    letter-spacing: 0.3em;
    text-indent: 0.3em;
    color: var(--ink-70);
  }
  .dots span {
    animation: dot-pulse 1.4s infinite;
  }
  .dots span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes load-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes dot-pulse {
    0%,
    60%,
    100% {
      opacity: 0.2;
    }
    30% {
      opacity: 1;
    }
  }
</style>
