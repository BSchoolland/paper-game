import { describe, it, expect } from "vitest";
import { add, sub, scale, normalize, length, distance, dot, angle, rotate, equals } from "../core/vec2.js";

describe("vec2", () => {
  it("add", () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  });

  it("sub", () => {
    expect(sub({ x: 5, y: 3 }, { x: 2, y: 1 })).toEqual({ x: 3, y: 2 });
  });

  it("scale", () => {
    expect(scale({ x: 2, y: 3 }, 2)).toEqual({ x: 4, y: 6 });
  });

  it("length", () => {
    expect(length({ x: 3, y: 4 })).toBe(5);
  });

  it("distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("normalize", () => {
    const n = normalize({ x: 0, y: 5 });
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
  });

  it("normalize zero vector", () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("dot", () => {
    expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
    expect(dot({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(1);
  });

  it("angle", () => {
    expect(angle({ x: 1, y: 0 })).toBeCloseTo(0);
    expect(angle({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
  });

  it("rotate", () => {
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it("equals", () => {
    expect(equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(equals({ x: 1, y: 2 }, { x: 1.0001, y: 2 })).toBe(true);
    expect(equals({ x: 1, y: 2 }, { x: 2, y: 2 })).toBe(false);
  });
});
