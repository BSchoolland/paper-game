#!/usr/bin/env bun
const [dimIdArg, specPath] = process.argv.slice(2);
console.log("dimIdArg:", dimIdArg);
console.log("specPath:", specPath);
console.log("import.meta.dir:", import.meta.dir);
console.log("Trying to read specPath...");
try {
  const spec = JSON.parse(await Bun.file(specPath).text());
  console.log("spec.name:", spec.name);
} catch (e) {
  console.error("Error reading spec:", e.message);
  console.error("Full error:", e);
}
