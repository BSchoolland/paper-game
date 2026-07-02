import type { GatewayInfo, HexCoord, HexMapState, ServerMessage } from "shared";

type XpBankedMsg = Extract<ServerMessage, { type: "xpBanked" }>;
type CodexBankedMsg = Extract<ServerMessage, { type: "codexBanked" }>;

interface OverworldStore {
  hexMap: HexMapState | null;
  /** Keyed by hex key — attuned gateway destinations, merged from snapshots + gatewayUpdate. */
  gateways: Record<string, GatewayInfo>;
  /** Sparkle queue: hexes discovered since last render pass (board consumes + clears). */
  discovered: HexCoord[];
  /** Run-end settlement pushes, held for the game-over plate; cleared when a run is live again. */
  lastBank: XpBankedMsg | null;
  lastCodexBank: CodexBankedMsg | null;
  /** Latest moveResolved, monotonic `n` so the board can $effect on it (accepted → token walk). */
  lastMove: { n: number; accepted: boolean; target: HexCoord } | null;
}

function initial(): OverworldStore {
  return { hexMap: null, gateways: {}, discovered: [], lastBank: null, lastCodexBank: null, lastMove: null };
}

export const overworld = $state<OverworldStore>(initial());

export function resetOverworld(): void {
  Object.assign(overworld, initial());
}
