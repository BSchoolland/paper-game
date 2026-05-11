import { Container, Text } from "pixi.js";

const FLOAT_SPEED = 40;
const FLOAT_DURATION = 0.8;

interface FloatingLabel {
  text: Text;
  timer: number;
  startY: number;
}

export class FloatingTextManager {
  private labels: FloatingLabel[] = [];

  constructor(private layer: Container) {}

  spawn(x: number, y: number, message: string, color: number) {
    const text = new Text({
      text: message,
      style: { fontSize: 11, fill: color, fontFamily: "Georgia, serif", fontWeight: "bold", stroke: { color: 0x000000, width: 2 } },
    });
    text.anchor.set(0.5);
    text.position.set(x, y);
    this.layer.addChild(text);
    this.labels.push({ text, timer: FLOAT_DURATION, startY: y });
  }

  tick(dt: number) {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i]!;
      label.timer -= dt;
      const elapsed = FLOAT_DURATION - label.timer;
      label.text.position.y = label.startY - elapsed * FLOAT_SPEED;
      label.text.alpha = Math.max(0, label.timer / FLOAT_DURATION);
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
