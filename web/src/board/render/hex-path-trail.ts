import { Graphics } from "pixi.js";

const PATH_COLOR = 0x8b3a3a;
const DASH_LENGTH = 8;
const GAP_LENGTH = 6;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

export class HexPathTrail {
  readonly layer = new Graphics();
  private history: { x: number; y: number }[] = [];

  addPoint(pt: { x: number; y: number }) {
    this.history.push(pt);
  }

  initIfEmpty(pt: { x: number; y: number }) {
    if (this.history.length === 0) {
      this.history.push(pt);
    }
  }

  drawLive(currentX: number, currentY: number) {
    const last = this.history[this.history.length - 1]!;
    this.history[this.history.length - 1] = { x: currentX, y: currentY };
    this.draw();
    this.history[this.history.length - 1] = last;
  }

  draw() {
    this.layer.clear();
    if (this.history.length < 2) return;

    const pts = this.buildSplinePoints();
    if (pts.length < 2) return;

    let carry = 0;
    let drawing = true;

    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i]!.x;
      const ay = pts[i]!.y;
      const bx = pts[i + 1]!.x;
      const by = pts[i + 1]!.y;
      const dx = bx - ax;
      const dy = by - ay;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen < 0.5) continue;
      const nx = dx / segLen;
      const ny = dy / segLen;

      let d = 0;
      while (d < segLen) {
        const dashTarget = drawing ? DASH_LENGTH : GAP_LENGTH;
        const remaining = dashTarget - carry;
        const step = Math.min(remaining, segLen - d);

        if (drawing) {
          if (carry === 0) {
            this.layer.moveTo(ax + nx * d, ay + ny * d);
          }
          this.layer.lineTo(ax + nx * (d + step), ay + ny * (d + step));
        }

        carry += step;
        d += step;

        if (carry >= dashTarget) {
          carry = 0;
          drawing = !drawing;
        }
      }
    }

    this.layer.stroke({ color: PATH_COLOR, alpha: 0.7, width: 2.5 });
  }

  private buildSplinePoints(): { x: number; y: number }[] {
    const h = this.history;
    if (h.length < 2) return [];
    if (h.length === 2) {
      return this.subdivideSegment(h[0]!, h[0]!, h[1]!, h[1]!, 8);
    }

    const result: { x: number; y: number }[] = [];
    for (let i = 0; i < h.length - 1; i++) {
      const p0 = h[Math.max(0, i - 1)]!;
      const p1 = h[i]!;
      const p2 = h[i + 1]!;
      const p3 = h[Math.min(h.length - 1, i + 2)]!;
      const seg = this.subdivideSegment(p0, p1, p2, p3, 10);
      if (i === 0) result.push(seg[0]!);
      for (let j = 1; j < seg.length; j++) result.push(seg[j]!);
    }
    return result;
  }

  private subdivideSegment(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    steps: number
  ): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
    return pts;
  }
}
