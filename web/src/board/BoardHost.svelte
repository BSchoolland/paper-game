<script lang="ts">
  import { Application } from "pixi.js";
  import { getAnimSet, isAdjacent, hexKey } from "shared";
  import { onMount, untrack } from "svelte";
  import { room } from "../state/room.svelte.js";
  import { overworld } from "../state/overworld.svelte.js";
  import {
    combat,
    combatIsIdle,
    onCombatEvents,
    resetCombatDisplay,
    setAnimatingCheck,
  } from "../state/combat.svelte.js";
  import { proposeMove, defendResult } from "../state/actions.js";
  import { FrameDriver } from "./render/frame-driver.js";
  import { GameRenderer } from "./render/game-renderer.js";
  import { HexMapRenderer, loadMapIconAssets } from "./render/hex-map-renderer.js";
  import { loadMapAssets } from "./render/grid-renderer.js";
  import { loadSpriteAssets, loadDimensionSprites } from "./render/sprite-assets.js";
  import { ClientState } from "./client-state.svelte.js";
  import { InputManager } from "./input-manager.js";
  import { DefendPrompt } from "./defend-prompt.js";

  /**
   * Owns the one Pixi Application and both board scenes (overworld hex chart / combat), driven
   * entirely by store state. DOM HUD lives in RunScreen; this component only bridges stores to
   * the imperative renderer stack ported from the prototype.
   */
  let { clientState }: { clientState: ClientState } = $props();

  let container: HTMLDivElement;
  let ready = $state(false);

  let app: Application;
  let driver: FrameDriver;
  let onResize: (() => void) | null = null;
  let hexRenderer: HexMapRenderer;
  let gameRenderer: GameRenderer;
  let input: InputManager;
  let defendPrompt: DefendPrompt;

  // Which scene the board currently shows (lags room.phase while combat animations drain).
  let scene = $state<"none" | "map" | "combat">("none");
  let dimensionReady: Promise<unknown> = Promise.resolve();
  let loadedDimension = -1;
  let activeDefendPromptId: string | null = null;
  let disposed = false;

  onMount(() => {
    void init();
    return () => {
      disposed = true;
      if (onResize) window.removeEventListener("resize", onResize);
      driver?.destroy();
      app?.destroy(true, { children: true });
    };
  });

  async function init(): Promise<void> {
    app = new Application();
    // autoStart:false disables Pixi's per-tick auto-render — the FrameDriver owns every paint, so a
    // static board renders zero frames and the GPU idles.
    await app.init({ backgroundAlpha: 0, resizeTo: window, antialias: true, autoStart: false });
    if (disposed) {
      app.destroy(true, { children: true });
      return;
    }
    container.appendChild(app.canvas);
    driver = new FrameDriver(app);
    onResize = () => driver.invalidate();
    window.addEventListener("resize", onResize);
    if (import.meta.env.DEV) {
      (window as unknown as { __app: Application }).__app = app;
      (window as unknown as { __driver: FrameDriver }).__driver = driver;
      // Pixi Devtools browser extension looks for this global.
      (window as unknown as { __PIXI_APP__: Application }).__PIXI_APP__ = app;
      const { installGpuProfiler } = await import("./render/gpu-profiler.js");
      installGpuProfiler(app);
    }

    await Promise.all([loadSpriteAssets(), loadMapAssets(), loadMapIconAssets()]);
    if (disposed) return;

    hexRenderer = new HexMapRenderer(app, driver);
    hexRenderer.init();
    hexRenderer.hide();
    hexRenderer.onHexClick((coord) => {
      const map = overworld.hexMap;
      if (!map || room.vote !== null) return;
      if (!isAdjacent(map.playerPos, coord)) return;
      if (!(hexKey(coord) in map.hexes)) return;
      proposeMove(coord);
    });

    gameRenderer = new GameRenderer(app, clientState, driver);
    input = new InputManager(app.canvas, clientState, gameRenderer, () => {
      if (!combat.display) return;
      gameRenderer.renderOverlay(input.mouseWorld);
    });
    defendPrompt = new DefendPrompt(clientState, gameRenderer);

    setAnimatingCheck(() => gameRenderer.isAnimating());
    onCombatEvents((events) => gameRenderer.pushEvents(events));
    clientState.subscribe(() => {
      if (combat.display && scene === "combat") gameRenderer.render();
    });

    ready = true;
  }

  // Keep the room's dimension sprites loaded (combat entry awaits this).
  $effect(() => {
    const dim = room.state?.dimensionId;
    if (dim === undefined || dim === loadedDimension) return;
    loadedDimension = dim;
    dimensionReady = loadDimensionSprites(dim);
  });

  // --- Scene routing: follow room.phase, but let combat animations drain before leaving. ---
  // Tracked deps are ONLY phase / first-snapshot presence / ready; all scene work is untracked
  // (routeScene reads and writes `scene` and interaction state — tracking those would loop).
  $effect(() => {
    const phase = room.state?.phase;
    const hasSnapshot = combat.display !== null;
    if (!ready || !phase) return;
    untrack(() => routeScene(phase, hasSnapshot));
  });

  function routeScene(phase: NonNullable<typeof room.state>["phase"], hasSnapshot: boolean): void {
    if (phase === "combat") {
      if (scene !== "combat" && hasSnapshot) enterCombat();
      return;
    }
    if (scene === "combat") {
      // combat -> overworld/gameover: let the final death/clear animation play out.
      void waitForCombatIdle().then(() => {
        if (room.state?.phase === "combat") return;
        exitCombat();
        if (room.state?.phase === "overworld") enterMap();
      });
      return;
    }
    if (phase === "overworld") enterMap();
    else exitMap();
  }

  function enterCombat(): void {
    if (scene === "combat") return;
    exitMap();
    scene = "combat";
    void dimensionReady.then(() => {
      if (room.state?.phase !== "combat" || scene !== "combat") return;
      clientState.autoSelectMyHero();
      gameRenderer.enter();
      input.setEnabled(true);
    });
  }

  function exitCombat(): void {
    input.setEnabled(false);
    gameRenderer.exit();
    resetCombatDisplay();
    scene = "none";
  }

  function enterMap(): void {
    if (scene === "map") return;
    scene = "map";
    hexRenderer.show();
    hexRenderer.setInputEnabled(room.vote === null);
    if (overworld.hexMap) hexRenderer.render(overworld.hexMap);
  }

  function exitMap(): void {
    if (scene !== "map") return;
    hexRenderer.setInputEnabled(false);
    hexRenderer.hide();
    scene = "none";
  }

  function waitForCombatIdle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (combatIsIdle() && !gameRenderer.isAnimating()) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  }

  // --- Overworld reactions ---
  $effect(() => {
    const map = overworld.hexMap;
    if (!ready || !map || scene !== "map") return;
    untrack(() => {
      if (!hexRenderer.isMoving()) hexRenderer.render(map);
    });
  });

  $effect(() => {
    const open = room.vote !== null;
    if (!ready || scene !== "map") return;
    hexRenderer.setInputEnabled(!open);
  });

  let seenMoveN = 0;
  $effect(() => {
    const move = overworld.lastMove;
    if (!ready || !move || move.n === seenMoveN) return;
    seenMoveN = move.n;
    if (scene !== "map" || !move.accepted) return;
    const map = overworld.hexMap;
    // Animate only a confirmed adjacent step; combat entry switches scenes before landing.
    if (map && isAdjacent(map.playerPos, move.target)) hexRenderer.animateMoveTo(move.target);
  });

  // Party token wears my current loadout on the overworld.
  $effect(() => {
    const inv = combat.inventory;
    if (!ready || !inv) return;
    hexRenderer.setPlayerAnimSet(getAnimSet(inv.equipped));
    hexRenderer.setPlayerEquipment(inv.equipped, inv.attachments);
  });

  // --- Defend prompt orchestration (idempotent per promptId) ---
  $effect(() => {
    const prompt = combat.defend;
    if (!ready || !prompt || prompt.promptId === activeDefendPromptId) return;
    activeDefendPromptId = prompt.promptId;
    void (async () => {
      // Let the pre-prompt enemy sweep finish animating so the telegraph lands on a settled board.
      await waitForCombatIdle();
      const power = await defendPrompt.run({
        promptId: prompt.promptId,
        attackerId: prompt.attackerId,
        attackerPosition: prompt.attackerPosition,
        aimDirection: prompt.aimDirection,
        ability: prompt.ability,
        targetIds: [prompt.targetEntityId],
      });
      defendResult(prompt.seatId, prompt.promptId, power);
      activeDefendPromptId = null;
    })();
  });

  // Reconcile interaction state + re-render on every new display snapshot. The work is
  // untracked: reconcile writes interaction runes and render reads them — tracking either
  // would make this effect its own trigger.
  $effect(() => {
    const display = combat.display;
    if (!ready) return;
    untrack(() => {
      clientState.reconcileWithGameState();
      // Notify even when reconcile changed nothing: snapshot facts (energy, cooldowns)
      // must repaint the ability bar and overlay without an interaction-state change.
      clientState.notify();
    });
  });
</script>

<div class="boardwrap" bind:this={container}></div>

<style>
  .boardwrap {
    position: fixed;
    inset: 0;
    z-index: 5;
  }
  .boardwrap :global(canvas) {
    display: block;
  }
</style>
