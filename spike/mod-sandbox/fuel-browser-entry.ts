import { fuelThreshold } from "./fuel-determinism";
declare global { interface Window { __fuelResult: Promise<unknown> } }
window.__fuelResult = fuelThreshold(16).then((t) => ({ engine: "chromium", fuel: 16, maxLoopIterations: t }));
