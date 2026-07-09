import { describe, it, expect } from "bun:test";
import type { GameEvent, ServerMessage } from "shared";
import { makeEntity, makeState } from "shared/src/__tests__/test-helpers.js";

// db.ts opens its Database at module load from GAME_DB_PATH, so set the env BEFORE importing
// anything that pulls it in (run-outcomes.test.ts precedent).
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const machine = await import("../room-machine.js");
const { enterEnemy } = await import("../combat-runtime.js");
const { EncounterSession } = await import("../encounter-session.js");
const fx = await import("./machine-fixtures.js");

type StateMsg = Extract<ServerMessage, { type: "state" }>;

function attackEventsOf(msg: ServerMessage): Extract<GameEvent, { type: "attack" }>[] {
  if (msg.type !== "state") return [];
  return (msg as StateMsg).events.filter((e): e is Extract<GameEvent, { type: "attack" }> => e.type === "attack");
}

/**
 * Timeline regression for the "mixed bot+player damage displays slowly" bug (plan.md bug 2).
 *
 * One enemy swing catches a human hero AND a bot hero. The runner holds the WHOLE swing as a
 * single pending resolveAction behind the human's defend round-trip: nothing about the swing is
 * broadcast until the human answers (or the 6s round times out), and then the bot's and the
 * human's damage land together in ONE state broadcast. This test pins that emit order — the
 * defend-wait prompt strictly precedes the single combined damage broadcast — so the round-trip
 * gap in a live timeline is attributable to the design, not to a lost message.
 */
describe("mixed human+bot defend round timeline", () => {
  it("withholds the bot's damage until the human answers, then lands one combined broadcast", () => {
    const { room, seats } = fx.buildTestRoom({ dim: 1, humans: 1, capacity: 2, prefix: "defend" });
    const { io, sends, broadcasts, all } = fx.recordingIO();

    // s0 = connected human, s1 = bot. One enemy in slash range of BOTH heroes, attack-only so
    // the rush strategy cannot reposition first.
    const human = makeEntity("s0-hero", 440, 400, "red", { controllerId: "s0" });
    const bot = makeEntity("s1-hero", 440, 430, "red", { controllerId: "s1" });
    const enemy = makeEntity("e0", 400, 400, "blue", {
      abilities: [makeEntity("tmp", 0, 0, "blue").abilities.find((a) => a.kind === "attack")!],
    });
    room.phase = "combat";
    room.session = EncounterSession.fromState(makeState([human, bot, enemy], { activeTeam: "blue" }));
    room.combat = enterEnemy();

    machine.startEnemyPhase(room, io);

    // The swing prompted a defend round: the human target is pending, the bot target was
    // defaulted to answered at open time (it can never answer).
    const round = room.defendRound!;
    expect(round).toBeTruthy();
    const humanTarget = round.targets.find((t) => t.seatId === "s0")!;
    const botTarget = round.targets.find((t) => t.seatId === "s1")!;
    expect(humanTarget.status).toBe("pending");
    expect(botTarget.status).toBe("answered");

    // The prompt went to the human only, annotated defend-wait.
    const prompts = sends.filter((s) => s.msg.type === "defendPrompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.seatId).toBe("s0");
    expect(prompts[0]!.note).toBe("defend-wait");

    // Nothing of the swing has been broadcast yet — the bot's damage is serialized behind the
    // human round-trip too (this is bug 2's mechanism).
    expect(broadcasts.flatMap(attackEventsOf)).toHaveLength(0);
    const botHpBefore = room.session!.state.entities.get("s1-hero")!.hp;
    expect(botHpBefore).toBe(100);

    // Human answers -> the round resolves ONCE, and both targets' damage arrives in a single
    // state broadcast.
    const promptMsg = prompts[0]!.msg as Extract<ServerMessage, { type: "defendPrompt" }>;
    machine.submitDefend(room, io, seats[0]!, promptMsg.promptId, 0.5);

    // (After resolution driveCombat runs on into the next player phase, where the bot hero may
    // swing back — scope to the enemy's attack.)
    const damageBroadcasts = broadcasts.filter((m) => attackEventsOf(m).some((e) => e.attackerId === "e0"));
    expect(damageBroadcasts).toHaveLength(1);
    const hits = attackEventsOf(damageBroadcasts[0]!)[0]!.hits;
    const hitIds = hits.map((h) => h.targetId).sort();
    expect(hitIds).toEqual(["s0-hero", "s1-hero"]);

    // Emit order: defend-wait prompt strictly precedes the combined damage broadcast.
    const promptIdx = all.findIndex((r) => r.msg.type === "defendPrompt");
    const damageIdx = all.findIndex((r) => attackEventsOf(r.msg).some((e) => e.attackerId === "e0"));
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(damageIdx).toBeGreaterThan(promptIdx);

    machine.disposeRoom(room);
  });
});
