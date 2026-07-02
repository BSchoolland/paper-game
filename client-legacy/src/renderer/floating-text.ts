import { Container, Text } from "pixi.js";

const FLOAT_SPEED = 40;
const FLOAT_DURATION = 0.8;

interface FloatingLabel {
  text: Text;
  timer: number;
  lifetime: number;
  startY: number;
}

export interface FloatingTextOptions {
  fontSize?: number;
  lifetime?: number;
  strokeColor?: number;
  strokeWidth?: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
}

export class FloatingTextManager {
  private labels: FloatingLabel[] = [];

  constructor(private layer: Container) {}

  spawn(x: number, y: number, message: string, color: number, opts: FloatingTextOptions = {}) {
    const fontSize = opts.fontSize ?? 11;
    const lifetime = opts.lifetime ?? FLOAT_DURATION;
    const strokeColor = opts.strokeColor ?? 0x000000;
    const strokeWidth = opts.strokeWidth ?? 2;
    const fontWeight = opts.fontWeight ?? "bold";
    const fontFamily = opts.fontFamily ?? "Georgia, serif";

    const text = new Text({
      text: message,
      style: {
        fontSize,
        fill: color,
        fontFamily,
        fontWeight,
        stroke: { color: strokeColor, width: strokeWidth },
      },
    });
    text.anchor.set(0.5);
    text.position.set(x, y);
    this.layer.addChild(text);
    this.labels.push({ text, timer: lifetime, lifetime, startY: y });
  }

  tick(dt: number) {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i]!;
      label.timer -= dt;
      const elapsed = label.lifetime - label.timer;
      label.text.position.y = label.startY - elapsed * FLOAT_SPEED;
      label.text.alpha = Math.max(0, label.timer / label.lifetime);
      if (label.timer <= 0) {
        this.layer.removeChild(label.text);
        label.text.destroy();
        this.labels.splice(i, 1);
      }
    }
  }

  isAnimating(): boolean {
    return this.labels.length > 0;
  }

  destroy() {
    for (const label of this.labels) {
      this.layer.removeChild(label.text);
      label.text.destroy();
    }
    this.labels.length = 0;
  }
}
