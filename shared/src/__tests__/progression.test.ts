import { describe, it, expect } from "bun:test";
import { xpToReachLevel, levelForXp, expeditionSlots } from "../core/progression.js";
import { TITLES, titleById, earnedTitleIds } from "../core/titles.js";

describe("xpToReachLevel", () => {
  it("level 1 costs 0", () => {
    expect(xpToReachLevel(1)).toBe(0);
  });

  it("known milestones", () => {
    expect(xpToReachLevel(2)).toBe(100);
    expect(xpToReachLevel(5)).toBe(1000);
    expect(xpToReachLevel(10)).toBe(4500);
  });

  it("throws on bad levels", () => {
    expect(() => xpToReachLevel(0)).toThrow();
    expect(() => xpToReachLevel(-3)).toThrow();
    expect(() => xpToReachLevel(2.5)).toThrow();
    expect(() => xpToReachLevel(NaN)).toThrow();
  });
});

describe("levelForXp", () => {
  it("throws on bad xp", () => {
    expect(() => levelForXp(-1)).toThrow();
    expect(() => levelForXp(NaN)).toThrow();
    expect(() => levelForXp(Infinity)).toThrow();
  });

  function referenceLevel(xp: number): number {
    let level = 1;
    while (xpToReachLevel(level + 1) <= xp) level++;
    return level;
  }

  it("matches a linear-scan reference for xp 0..50_000 (step 7)", () => {
    for (let xp = 0; xp <= 50_000; xp += 7) {
      expect(levelForXp(xp)).toBe(referenceLevel(xp));
    }
  });

  it("is exact at every threshold ±1 up to level 40", () => {
    for (let level = 2; level <= 40; level++) {
      const threshold = xpToReachLevel(level);
      expect(levelForXp(threshold - 1)).toBe(level - 1);
      expect(levelForXp(threshold)).toBe(level);
      expect(levelForXp(threshold + 1)).toBe(level);
    }
  });
});

describe("expeditionSlots", () => {
  it("locked formula 2 + floor(level / 5)", () => {
    expect(expeditionSlots(1)).toBe(2);
    expect(expeditionSlots(4)).toBe(2);
    expect(expeditionSlots(5)).toBe(3);
    expect(expeditionSlots(9)).toBe(3);
    expect(expeditionSlots(10)).toBe(4);
  });
});

describe("titles", () => {
  it("titleById resolves every catalog entry and throws on unknown ids", () => {
    for (const t of TITLES) expect(titleById(t.id)).toBe(t);
    expect(() => titleById("nonexistent")).toThrow();
  });

  it("earnedTitleIds threshold edges: 24 vs 25 hexes", () => {
    expect(earnedTitleIds({ hexes_charted: 24 }, 1)).not.toContain("pathfinder");
    expect(earnedTitleIds({ hexes_charted: 25 }, 1)).toContain("pathfinder");
  });

  it("earnedTitleIds level pseudo-stat: 4 vs 5", () => {
    expect(earnedTitleIds({}, 4)).not.toContain("veteran");
    expect(earnedTitleIds({}, 5)).toContain("veteran");
  });

  it("a `level` key in stats never overrides the derived level", () => {
    expect(earnedTitleIds({ level: 99 }, 1)).not.toContain("veteran");
  });

  it("missing stats count as 0", () => {
    expect(earnedTitleIds({}, 1)).toEqual([]);
  });
});
