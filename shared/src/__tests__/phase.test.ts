import { describe, it, expect } from "bun:test";
import { isPlayerPhaseOver, heroExhausted } from "../combat/phase.js";
import { makeEntity } from "./test-helpers.js";

describe("player phase decision (R8)", () => {
  it("isPlayerPhaseOver: ends only when every seat is ready or exhausted", () => {
    expect(isPlayerPhaseOver([])).toBe(false);
    expect(isPlayerPhaseOver([{ ready: true, exhausted: false }])).toBe(true);
    expect(isPlayerPhaseOver([{ ready: false, exhausted: true }])).toBe(true);
    expect(
      isPlayerPhaseOver([{ ready: false, exhausted: true }, { ready: true, exhausted: false }]),
    ).toBe(true);
    expect(
      isPlayerPhaseOver([{ ready: false, exhausted: false }, { ready: true, exhausted: false }]),
    ).toBe(false);
  });

  it("heroExhausted: missing, dead, or out of affordable actions", () => {
    expect(heroExhausted(undefined)).toBe(true);
    expect(heroExhausted(makeEntity("h", 0, 0, "red"))).toBe(false);
    expect(heroExhausted(makeEntity("d", 0, 0, "red", { dead: true }))).toBe(true);
    const drained = makeEntity("x", 0, 0, "red", {
      energy: { red: 0, blue: 0, regenRed: 2, regenBlue: 2, maxRed: 2, maxBlue: 2 },
    });
    expect(heroExhausted(drained)).toBe(true);
  });
});
