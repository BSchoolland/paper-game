<script lang="ts">
  import { room, isHost } from "../state/room.svelte.js";
  import { debugWin, debugLose } from "../state/actions.js";
  import { devOptions, setAutoWin } from "./dev-options.svelte.js";
  import ReplayViewer from "./ReplayViewer.svelte";
  import type { ReplayListEntry, ReplayLog } from "./replay-format.js";

  /**
   * Dev-only tool hub (never in prod bundles — App gates the import on import.meta.env.DEV).
   * Backtick or the wrench button opens it. Tools render full-screen over whatever screen the
   * session state put up.
   */
  let open = $state(false);
  let replays = $state<ReplayListEntry[]>([]);
  let error = $state<string | null>(null);
  let active = $state<{ name: string; replay: ReplayLog } | null>(null);

  // The replay viewer drives the shared combat store, so it can't coexist with a live room.
  const inRoom = $derived(room.state !== null);
  const inCombat = $derived(room.state?.phase === "combat");
  const host = $derived(isHost());

  /** One debugWin per combat entry — re-arms when we leave combat. */
  let autoWinLatched = false;

  $effect(() => {
    if (room.state?.phase !== "combat") {
      autoWinLatched = false;
      return;
    }
    if (!devOptions.autoWin || !isHost() || autoWinLatched) return;
    autoWinLatched = true;
    debugWin();
  });

  function toggle(): void {
    open = !open;
    if (open) void refresh();
  }

  async function refresh(): Promise<void> {
    error = null;
    try {
      const res = await fetch("/__dev/replays");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      replays = await res.json();
    } catch (e) {
      error = `Could not list replays: ${e}`;
    }
  }

  async function openReplay(name: string): Promise<void> {
    error = null;
    try {
      const res = await fetch(`/__dev/replays/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const replay: ReplayLog = await res.json();
      if (!Array.isArray(replay.frames)) throw new Error("not a replay log (no frames array)");
      active = { name, replay };
      open = false;
    } catch (e) {
      error = `Could not load ${name}: ${e}`;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== "`" || active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    e.preventDefault();
    toggle();
  }

  function age(mtimeMs: number): string {
    const mins = Math.round((Date.now() - mtimeMs) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 60 / 24)}d ago`;
  }

  function sizeLabel(bytes: number): string {
    return bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
</script>

<svelte:window onkeydown={onKey} />

{#if active}
  <ReplayViewer name={active.name} replay={active.replay} onclose={() => (active = null)} />
{:else}
  <button class="wrench" title="Dev hub (`)" onclick={toggle}>⚒</button>
  {#if open}
    <div class="hub">
      <header>
        <h2>Dev hub</h2>
        <button onclick={toggle}>close (`)</button>
      </header>

      <section>
        <div class="section-head">
          <h3>Cheats</h3>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={devOptions.autoWin}
            onchange={(e) => setAutoWin(e.currentTarget.checked)}
          />
          <span>Auto-win encounters</span>
        </label>
        <p class="hint">
          Host-only. When on, every fight ends immediately as a win so loot/codex can be farmed.
          Persists across reloads.
        </p>
        <div class="row">
          <button disabled={!inCombat || !host} onclick={() => debugWin()}>Win now</button>
          <button disabled={!inCombat || !host} onclick={() => debugLose()}>Lose now</button>
        </div>
        {#if inCombat && !host}
          <p class="hint">Only the room host can force combat outcomes.</p>
        {/if}
      </section>

      <section>
        <div class="section-head">
          <h3>Replays</h3>
          <button onclick={() => void refresh()}>refresh</button>
        </div>
        {#if inRoom}
          <p class="hint">Replay playback drives the combat store — leave the room to use it.</p>
        {:else if error}
          <p class="hint error">{error}</p>
        {:else if replays.length === 0}
          <p class="hint">No replays yet. Generate one: <code>bun run sim-battle</code></p>
        {:else}
          <ul>
            {#each replays as entry (entry.name)}
              <li>
                <button class="replay" onclick={() => void openReplay(entry.name)}>
                  <span class="name">{entry.name}</span>
                  <span class="meta">{age(entry.mtimeMs)} · {sizeLabel(entry.size)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}
{/if}

<style>
  .wrench {
    position: fixed;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 190;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    border: 1px solid var(--ink, #3a2f26);
    background: var(--paper-hi, #faf5e8);
    color: var(--ink, #3a2f26);
    font-size: 1.1rem;
    opacity: 0.45;
    cursor: pointer;
  }
  .wrench:hover {
    opacity: 1;
  }
  .hub {
    position: fixed;
    right: 0.75rem;
    bottom: 3.5rem;
    z-index: 190;
    width: min(26rem, calc(100vw - 1.5rem));
    max-height: 70vh;
    overflow-y: auto;
    background: var(--paper-hi, #faf5e8);
    border: 1px solid var(--ink, #3a2f26);
    border-radius: 8px;
    padding: 0.9rem 1rem;
    color: var(--ink, #3a2f26);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  }
  header,
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
  }
  h3 {
    margin: 0.4rem 0;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.75;
  }
  ul {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
  }
  li + li {
    margin-top: 0.25rem;
  }
  .replay {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .replay:hover {
    border-color: var(--ink, #3a2f26);
    background: var(--paper, #f3ecdc);
  }
  .name {
    overflow-wrap: anywhere;
  }
  .meta {
    white-space: nowrap;
    opacity: 0.6;
    font-size: 0.8rem;
  }
  .hint {
    font-size: 0.85rem;
    opacity: 0.75;
    margin: 0.3rem 0;
  }
  .hint.error {
    color: var(--terra, #a03436);
    opacity: 1;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.35rem 0 0.15rem;
    cursor: pointer;
    font-size: 0.95rem;
  }
  .toggle input {
    accent-color: var(--ink, #3a2f26);
  }
  .row {
    display: flex;
    gap: 0.4rem;
    margin: 0.45rem 0 0.2rem;
  }
  .row button {
    flex: 1;
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--ink, #3a2f26);
    border-radius: 5px;
    background: var(--paper, #f3ecdc);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .row button:hover:not(:disabled) {
    background: var(--paper-hi, #faf5e8);
  }
  .row button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
