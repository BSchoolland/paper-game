<script lang="ts">
  import { Application } from "pixi.js";
  import { onMount } from "svelte";
  import { untrack } from "svelte";
  import {
    applyCombatSnapshot,
    combat,
    combatIsIdle,
    onCombatEvents,
    resetCombatDisplay,
    setAnimatingCheck,
  } from "../state/combat.svelte.js";
  import { FrameDriver } from "../board/render/frame-driver.js";
  import { GameRenderer } from "../board/render/game-renderer.js";
  import { baseAssetsReady, dimensionAssetsReady, mapImageReady } from "../board/render/asset-manifest.js";
  import { ClientState } from "../board/client-state.svelte.js";
  import { InputManager } from "../board/input-manager.js";
  import { SeatContext } from "../board/seat-context.js";
  import type { ReplayLog } from "./replay-format.js";

  /** No seat, ever — every ownership check answers "spectator", so board input stays camera-only. */
  class SpectatorSeat extends SeatContext {
    override get mySeatId(): null {
      return null;
    }
  }

  let { name, replay, onclose }: { name: string; replay: ReplayLog; onclose: () => void } = $props();

  let container: HTMLDivElement;
  let ready = $state(false);
  let error = $state<string | null>(null);
  let cursor = $state(0);
  let speed = $state(1);
  /** Auto-advance mode: one turn (Enter), to the end (Space), or off. */
  let playing = $state<"turn" | "all" | null>(null);

  const frames = $derived(replay.frames);
  const frame = $derived(frames[cursor]!);

  let app: Application;
  let driver: FrameDriver;
  let renderer: GameRenderer;
  let input: InputManager;
  const clientState = new ClientState(new SpectatorSeat());
  let disposed = false;
  let raf = 0;
  let onResize: (() => void) | null = null;
  const cleanups: (() => void)[] = [];

  onMount(() => {
    void init();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const c of cleanups) c();
      setAnimatingCheck(null);
      resetCombatDisplay();
      driver?.destroy();
      app?.destroy(true, { children: true });
    };
  });

  async function init(): Promise<void> {
    if (frames.length === 0) {
      error = "Replay has no frames.";
      return;
    }
    app = new Application();
    await app.init({ backgroundAlpha: 0, resizeTo: window, antialias: true, autoStart: false });
    if (disposed) {
      app.destroy(true, { children: true });
      return;
    }
    container.appendChild(app.canvas);
    driver = new FrameDriver(app);
    onResize = () => driver.invalidate();
    window.addEventListener("resize", onResize);
    cleanups.push(() => window.removeEventListener("resize", onResize!));

    try {
      // Frames arrive whole, so every encounter map image the replay visits is known upfront.
      const mapImages = new Set(
        frames.flatMap((f) => f.serializedState.mapDefinition.mapImage ?? []),
      );
      await Promise.all([
        baseAssetsReady(),
        ...replay.dimensions.map((d) => dimensionAssetsReady(d)),
        ...[...mapImages].map((m) => mapImageReady(m)),
      ]);
    } catch (e) {
      error = `Asset load failed (is the game server on :3001 running?): ${e}`;
      return;
    }
    if (disposed) return;

    renderer = new GameRenderer(app, clientState, driver);
    input = new InputManager(app.canvas, clientState, renderer, () => {
      if (combat.display) renderer.renderOverlay(input.mouseWorld);
    });
    setAnimatingCheck(() => renderer.isAnimating());
    cleanups.push(onCombatEvents((events) => renderer.pushEvents(events)));
    cleanups.push(clientState.subscribe(() => {
      if (combat.display) renderer.render();
    }));

    resetCombatDisplay();
    applyCombatSnapshot(frames[0]!.serializedState, []);
    renderer.enter();
    input.setEnabled(true);
    ready = true;
  }

  // Mirror BoardHost's display reconciliation: each new display snapshot drops stale interaction
  // state and repaints (the subscribe above does the actual render).
  $effect(() => {
    const display = combat.display;
    if (!ready || !display) return;
    untrack(() => {
      clientState.reconcileWithGameState();
      clientState.notify();
    });
  });

  function boardIdle(): boolean {
    return combatIsIdle() && !renderer.isAnimating();
  }

  function stepOnce(): boolean {
    if (cursor >= frames.length - 1) return false;
    cursor++;
    const f = frames[cursor]!;
    applyCombatSnapshot(f.serializedState, f.events);
    return true;
  }

  function step(): void {
    playing = null;
    if (boardIdle()) stepOnce();
  }

  function play(mode: "turn" | "all"): void {
    if (playing) {
      playing = null;
      return;
    }
    playing = mode;
    const startTurn = frame.turnNumber;
    const advance = () => {
      if (disposed || !playing) return;
      if (!boardIdle()) {
        raf = requestAnimationFrame(advance);
        return;
      }
      if (!stepOnce() || (playing === "turn" && frame.turnNumber !== startTurn)) {
        playing = null;
        return;
      }
      raf = requestAnimationFrame(advance);
    };
    advance();
  }

  function restart(): void {
    playing = null;
    cursor = 0;
    resetCombatDisplay();
    applyCombatSnapshot(frames[0]!.serializedState, []);
    // Full scene rebuild: kills in-flight animation sequences (which would otherwise keep
    // ownership of entity positions) and re-syncs every visual from the seeded first frame.
    renderer.enter();
  }

  function setSpeed(factor: number): void {
    speed = Math.min(4, Math.max(0.25, speed * factor));
    renderer.setPlaybackSpeed(speed);
  }

  function onKey(e: KeyboardEvent): void {
    if (!ready) {
      if (e.key === "Escape") onclose();
      return;
    }
    switch (e.key) {
      case ".":
      case "ArrowRight":
        step();
        break;
      case "Enter":
        play("turn");
        break;
      case " ":
        e.preventDefault();
        play("all");
        break;
      case "r":
        restart();
        break;
      case "[":
        setSpeed(0.5);
        break;
      case "]":
        setSpeed(2);
        break;
      case "Escape":
        onclose();
        break;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="viewer">
  <div class="board" bind:this={container}></div>
  {#if error}
    <div class="notice error">{error}</div>
  {:else if !ready}
    <div class="notice">Loading replay…</div>
  {/if}
  <header>
    <strong>{name}</strong>
    <span>frame {cursor + 1}/{frames.length}</span>
    <span>turn {frame.turnNumber} · {frame.team}</span>
    <span>speed {speed}×</span>
    {#if playing}<span class="playing">playing {playing}</span>{/if}
    <button onclick={onclose}>close (esc)</button>
  </header>
  <footer>
    <span><kbd>.</kbd> step</span>
    <span><kbd>enter</kbd> play turn</span>
    <span><kbd>space</kbd> play all</span>
    <span><kbd>r</kbd> restart</span>
    <span><kbd>[</kbd>/<kbd>]</kbd> speed</span>
  </footer>
</div>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--paper, #f3ecdc);
  }
  .board {
    position: absolute;
    inset: 0;
  }
  .board :global(canvas) {
    display: block;
  }
  header,
  footer {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    gap: 1.25rem;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 1rem;
    pointer-events: none;
    color: var(--ink, #3a2f26);
    font-size: 0.85rem;
  }
  header {
    top: 0;
  }
  footer {
    bottom: 0;
    opacity: 0.7;
  }
  header button {
    pointer-events: auto;
    margin-left: 1rem;
  }
  .playing {
    color: var(--terra, #a05436);
  }
  .notice {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    font-size: 1rem;
    color: var(--ink, #3a2f26);
  }
  .error {
    color: var(--terra, #a03436);
    max-width: 40rem;
    margin: auto;
  }
  kbd {
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 0 0.3em;
    font-size: 0.9em;
  }
</style>
