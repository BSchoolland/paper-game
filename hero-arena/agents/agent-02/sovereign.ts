/**
 * Forwarding shim — Sovereign now lives in `shared/src/ai/sovereign.ts` so the main game
 * can use it as a strategy. Agent-02's tournament code continues to import from this path.
 */
export * from "../../../shared/src/ai/sovereign.js";
