import { describe, it, expect } from "vitest";
import { computeShapeFootprint } from "../geometry/footprint.js";
import { ShapeKind } from "../core/types.js";
import { createGrid } from "../map/collision-grid.js";
import { makeEntity } from "./test-helpers.js";

const grid = createGrid(100, 100, 8);
const noEntities = new Map<string, ReturnType<typeof makeEntity>>();

describe("computeShapeFootprint", () => {
  it("centres a sector arc on the aim direction", () => {
    const fp = computeShapeFootprint(
      { kind: ShapeKind.Sector, radius: 80, halfAngle: Math.PI / 4 },
      { x: 100, y: 100 },
      { x: 0, y: 1 }, // aiming straight down: angle = +PI/2
      noEntities, grid
    );
    expect(fp.kind).toBe(ShapeKind.Sector);
    if (fp.kind !== ShapeKind.Sector) return;
    expect(fp.radius).toBe(80);
    expect((fp.startAngle + fp.endAngle) / 2).toBeCloseTo(Math.PI / 2);
    expect(fp.endAngle - fp.startAngle).toBeCloseTo(Math.PI / 2);
  });

  it("builds a rectangle's four corners around the aim axis", () => {
    const fp = computeShapeFootprint(
      { kind: ShapeKind.Rectangle, length: 100, width: 20 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      noEntities, grid
    );
    expect(fp.kind).toBe(ShapeKind.Rectangle);
    if (fp.kind !== ShapeKind.Rectangle) return;
    const xs = fp.corners.map(c => c.x).sort((a, b) => a - b);
    const ys = fp.corners.map(c => c.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[3]).toBeCloseTo(100);
    expect(ys[0]).toBeCloseTo(-10);
    expect(ys[3]).toBeCloseTo(10);
  });

  it("clamps a circle blast to the ability's range", () => {
    const fp = computeShapeFootprint(
      { kind: ShapeKind.Circle, radius: 40, range: 200 },
      { x: 0, y: 0 },
      { x: 500, y: 0 }, // mouse far past range
      noEntities, grid
    );
    expect(fp.kind).toBe(ShapeKind.Circle);
    if (fp.kind !== ShapeKind.Circle) return;
    expect(fp.center.x).toBeCloseTo(200);
    expect(fp.radius).toBe(40);
  });

  it("reports the entity a point shape's ray strikes", () => {
    const target = makeEntity("b1", 150, 100, "blue");
    const fp = computeShapeFootprint(
      { kind: ShapeKind.Point, range: 300 },
      { x: 100, y: 100 },
      { x: 1, y: 0 },
      new Map([["b1", target]]), grid,
      "r1"
    );
    expect(fp.kind).toBe(ShapeKind.Point);
    if (fp.kind !== ShapeKind.Point) return;
    expect(fp.hitEntityId).toBe("b1");
    expect(fp.hitWall).toBe(false);
  });
});
