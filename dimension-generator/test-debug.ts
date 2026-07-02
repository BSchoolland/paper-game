#!/usr/bin/env bun
const [dimIdArg, specPath] = process.argv.slice(2);
console.log("dimIdArg:", dimIdArg);
console.log("specPath:", specPath);
console.log("import.meta.dir:", import.meta.dir);
if (!specPath) throw new Error("usage: test-debug.ts <dimId> <specPath>");
console.log("Trying to read specPath...");
try {
  const spec = JSON.parse(await Bun.file(specPath).text());
  console.log("spec.name:", spec.name);
} catch (e) {
  console.error("Error reading spec:", e instanceof Error ? e.message : String(e));
  console.error("Full error:", e);
}
