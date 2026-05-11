// @ts-expect-error - friendly-words has no types
import fw from "friendly-words";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomColor(): { name: string; hex: string } {
  const h = Math.random() * 360;
  const s = 40 + Math.random() * 50;
  const l = 30 + Math.random() * 40;

  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l / 100 - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  const hueNames = ["red", "orange", "yellow", "chartreuse", "green", "spring",
    "cyan", "azure", "blue", "violet", "magenta", "rose"];
  const hueName = hueNames[Math.floor(h / 30)];
  const lightness = l < 40 ? "dark " : l > 55 ? "light " : "";

  return { name: `${lightness}${hueName}`, hex };
}

const pickedColors = Array.from({ length: 3 }, randomColor);
const pickedNouns = Array.from({ length: 5 }, () => pick(fw.objects));

console.log("=== DIMENSION INSPIRATION ===\n");
console.log("Colors:");
for (const c of pickedColors) {
  console.log(`  - ${c.name} (${c.hex})`);
}
console.log("\nNouns:");
for (const n of pickedNouns) {
  console.log(`  - ${n}`);
}
console.log("\n---");
console.log("Use these colors and nouns as loose inspiration for the dimension's");
console.log("theme, environment, enemies, and items. They are seeds, not constraints —");
console.log("riff on the mood and imagery they evoke rather than using them literally.");
