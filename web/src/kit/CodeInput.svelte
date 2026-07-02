<script lang="ts">
  /** Six-cell room-code entry. One real (invisible) input drives the painted cells. */
  let {
    value = $bindable(""),
    onsubmit,
  }: {
    value: string;
    onsubmit?: () => void;
  } = $props();

  let input: HTMLInputElement;

  // Room codes are A-Z2-9 (no I/O/0/1), 6 chars.
  function sanitize(raw: string): string {
    return raw
      .toUpperCase()
      .replace(/[^A-HJ-NP-Z2-9]/g, "")
      .slice(0, 6);
  }

  function onInput(): void {
    value = sanitize(input.value);
    input.value = value;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && value.length === 6) onsubmit?.();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -- the inner input is the focusable control; the wrapper just forwards clicks to it -->
<div
  class="cells"
  onpointerdown={(e) => {
    e.preventDefault();
    input.focus();
  }}
>
  <input
    bind:this={input}
    class="ghostinput"
    autocomplete="off"
    spellcheck="false"
    aria-label="room code"
    oninput={onInput}
    onkeydown={onKey}
  />
  {#each Array.from({ length: 6 }, (_, i) => value[i]) as ch, i (i)}
    <span class="codecell" class:empty={!ch} class:cur={i === value.length}>{ch ?? "·"}</span>
  {/each}
</div>

<style>
  .cells {
    display: inline-flex;
    gap: 5px;
    position: relative;
    cursor: text;
  }
  .ghostinput {
    position: absolute;
    inset: 0;
    opacity: 0;
    border: none;
    width: 100%;
  }
  .codecell {
    width: 32px;
    height: 40px;
    border: 1px solid var(--ink-40);
    border-radius: 3px;
    background: rgba(255, 250, 235, 0.6);
    font-family: var(--sc);
    font-size: 20px;
    text-align: center;
    line-height: 38px;
    box-shadow: inset 0 1px 3px rgba(60, 47, 28, 0.15);
    color: var(--ink);
  }
  .codecell.empty {
    color: var(--ink-25);
  }
  .cells:focus-within .codecell.cur {
    border-color: var(--ink-70);
  }
</style>
