import { describe, it, expect } from "bun:test";
import type { EntityId, GameState, PlayerAction } from "shared";
import { makeEntity, makeState } from "shared/src/__tests__/test-helpers.js";
import { AiTurnRunner } from "../ai-turn-runner.js";
import type { HeroController } from "../../../hero-arena/src/types.js";

// A runner over a mutable GameState slot, mirroring how EncounterSession wires it.
function harness(initial: GameState, brains: Map<EntityId, HeroController>) {
  let cur = initial;
  const runner = new AiTurnRunner({
    getState: () => cur,
    setState: (s) => { cur = s; },
    heroBrains: brains,
    heroBudgetMs: 1000,
  });
  return { runner, state: () => cur };
}

const slash = (entityId: string, dir = { x: 1, y: 0 }): PlayerAction =>
  ({ type: "ability", entityId, abilityId: "short-sword-slash", aimDirection: dir });
const move = (entityId: string, destination: { x: number; y: number }): PlayerAction =>
  ({ type: "ability", entityId, abilityId: "move", destination });
const fixedBrain = (actions: PlayerAction[]): HeroController => (() => actions) as HeroController;

function drainToDone(runner: AiTurnRunner, max = 12) {
  let r = runner.step();
  for (let i = 0; i < max && r.type !== "done" && r.type !== "endedTurn"; i++) r = runner.step();
  return r;
}

describe("AiTurnRunner (generalized modes)", () => {
  it("drives a player-bot's actions and stops WITHOUT ending the player phase", () => {
    const bot = makeEntity("s0-hero", 200, 200, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 500, 200, "blue");
    const { runner, state } = harness(makeState([bot, enemy]), new Map([["s0-hero", fixedBrain([move("s0-hero", { x: 240, y: 200 })])]]));
    runner.start({ kind: "playerBots", entityIds: ["s0-hero"], humanHeroIds: new Set() }, 1);

    expect(runner.step().type).toBe("events"); // the move resolved
    expect(drainToDone(runner).type).toBe("done");
    // player-bot runs never issue endTurn — the Room decides when the phase ends (R8).
    expect(state().activeTeam).toBe("red");
    expect(state().turnNumber).toBe(1);
  });

  it("does NOT prompt defense when a player-bot hits an enemy", () => {
    const bot = makeEntity("s0-hero", 0, 0, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 40, 0, "blue");
    // Even with the bot itself in humanHeroIds, the hit BLUE target is never prompted.
    const { runner, state } = harness(makeState([bot, enemy]), new Map([["s0-hero", fixedBrain([slash("s0-hero")])]]));
    runner.start({ kind: "playerBots", entityIds: ["s0-hero"], humanHeroIds: new Set(["s0-hero"]) }, 1);

    const types: string[] = [];
    let r = runner.step();
    for (let i = 0; i < 12 && r.type !== "done"; i++) { types.push(r.type); r = runner.step(); }
    expect(types).not.toContain("defendPrompt");
    expect(state().entities.get("e0")!.hp).toBeLessThan(100); // the slash landed
  });

  it("prompts defense when an enemy attacks a player hero (enemy phase)", () => {
    const hero = makeEntity("s0-hero", 40, 0, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 0, 0, "blue");
    const { runner } = harness(makeState([hero, enemy], { activeTeam: "blue" }), new Map([["e0", fixedBrain([slash("e0")])]]));
    runner.start({ kind: "enemyPhase", team: "blue" }, 1);

    const first = runner.step();
    expect(first.type).toBe("defendPrompt");
    if (first.type === "defendPrompt") {
      expect(first.targetIds).toContain("s0-hero");
      expect(first.attackerId).toBe("e0");
      expect(first.roundId).toBeTruthy();
    }
  });

  it("ends the enemy phase with an explicit endedTurn, emitting the flip events first", () => {
    const hero = makeEntity("s0-hero", 40, 0, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 0, 0, "blue");
    const { runner, state } = harness(makeState([hero, enemy], { activeTeam: "blue" }), new Map([["e0", fixedBrain([])]]));
    runner.start({ kind: "enemyPhase", team: "blue" }, 1);

    // The terminal endTurn's flip/turnStart events are emitted as an `events` step BEFORE `endedTurn`,
    // so the broadcast always precedes the player phase re-opening (the events-ordering risk).
    const types: string[] = [];
    let r = runner.step();
    for (let i = 0; i < 12 && r.type !== "endedTurn"; i++) { types.push(r.type); r = runner.step(); }
    expect(r.type).toBe("endedTurn"); // explicit enemy->player signal (was inferred from activeTeam)
    expect(types).toContain("events");
    expect(state().activeTeam).toBe("red"); // finish() issued endTurn: blue -> red
  });

  it("is restartable after a run completes", () => {
    const bot = makeEntity("s0-hero", 0, 0, "red", { controllerId: "s0" });
    const enemy = makeEntity("e0", 300, 0, "blue");
    const { runner } = harness(makeState([bot, enemy]), new Map([["s0-hero", fixedBrain([])], ["e0", fixedBrain([])]]));
    runner.start({ kind: "playerBots", entityIds: ["s0-hero"], humanHeroIds: new Set() }, 1);
    expect(drainToDone(runner).type).toBe("done");

    runner.start({ kind: "enemyPhase", team: "blue" }, 2);
    expect(["events", "done", "defendPrompt"]).toContain(runner.step().type);
  });

  it("abort() drops a reclaimed entity so it never acts (R12)", () => {
    const b0 = makeEntity("s0-hero", 200, 100, "red", { controllerId: "s0" });
    const b1 = makeEntity("s1-hero", 200, 300, "red", { controllerId: "s1" });
    const enemy = makeEntity("e0", 500, 500, "blue");
    const brains = new Map<EntityId, HeroController>([
      ["s0-hero", fixedBrain([move("s0-hero", { x: 240, y: 100 })])],
      ["s1-hero", fixedBrain([move("s1-hero", { x: 240, y: 300 })])],
    ]);
    const { runner, state } = harness(makeState([b0, b1, enemy]), brains);
    runner.start({ kind: "playerBots", entityIds: ["s0-hero", "s1-hero"], humanHeroIds: new Set() }, 1);
    runner.abort("s1-hero"); // reclaimed by a human before it acts

    drainToDone(runner);
    expect(state().entities.get("s1-hero")!.position).toEqual({ x: 200, y: 300 }); // never moved
    expect(state().entities.get("s0-hero")!.position).not.toEqual({ x: 200, y: 100 }); // s0 still acted
  });
});
