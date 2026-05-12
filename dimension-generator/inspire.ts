// @ts-expect-error - friendly-words has no types
import fw from "friendly-words";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

const pickedNouns = Array.from({ length: 5 }, () => pick(fw.objects));

console.log("=== DIMENSION INSPIRATION ===\n");
console.log("Nouns:");
for (const n of pickedNouns) {
  console.log(`  - ${n}`);
}
console.log("\n---");
console.log("Use these nouns as loose inspiration for the dimension's");
console.log("theme, environment, enemies, and items. They are seeds, not constraints —");
console.log("riff on the mood and imagery they evoke rather than using them literally.");
