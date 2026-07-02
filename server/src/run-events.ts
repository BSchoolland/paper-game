import type { ContractState, HexCoord, HexIconType, RunOutcome } from "shared";
import type { Room } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import {
  recordRunStarted,
  recordEncounterWon,
  recordRunSettled,
  recordDimensionEntered,
  restOnArrivalRecorder,
  restOnClearRecorder,
  restOnTravelRecorder,
} from "./run-recorders.js";
import { contractProgressRecorder } from "./contract-engine.js";
import { gatewayAttunementRecorder } from "./gateways.js";
import { lootDropRecorder } from "./loot.js";
import { codexBankingRecorder } from "./codex.js";

/**
 * Room-scoped run-event bus (docs/meta-loop/02-contracts.md §4.1) — sibling of
 * shared/src/combat/reaction-bus.ts: typed events, synchronous dispatch, fail-loud (a throwing
 * recorder propagates to the ws `message()` try/catch — never swallowed). Handlers are
 * RECORDERS: they accrue/persist/push but MUST NOT change `room.phase`, call `finalizeRun`,
 * touch `room.vote`/`room.session`, or await (R7 discipline). The machine reads state
 * (e.g. `room.contract.completed`) after emitting and owns every transition.
 */

export type RunEvent =
  | { type: "run-started"; runId: number; dimensionId: number }
  | {
      type: "encounter-won";
      runId: number;
      hex: HexCoord;
      icon: HexIconType | null;
      firstEver: boolean;
      clearedCount: number;
    }
  | { type: "hex-entered"; runId: number; hex: HexCoord; icon: HexIconType | null }
  /** Mid-run gateway travel arrival. NOT emitted at run start (that is run-started). */
  | { type: "dimension-entered"; runId: number; dimensionId: number; tier: number | null }
  /** THE banking hook (feature 3 seam): emitted exactly once per run, immediately after
   *  finalizeRun returns true, before the gameOver broadcast. runId is explicit because
   *  resetToOrigin re-keys room.runId right after emitting for the OLD run. */
  | { type: "run-ended"; runId: number; outcome: RunOutcome; contract: ContractState | null };

export type RunEventHandler<T extends RunEvent["type"] = RunEvent["type"]> = (
  room: Room,
  io: RoomIO,
  event: Extract<RunEvent, { type: T }>,
) => void;

export interface RunEventRegistration {
  readonly type: RunEvent["type"];
  readonly handler: RunEventHandler;
}

export function on<T extends RunEvent["type"]>(type: T, handler: RunEventHandler<T>): RunEventRegistration {
  return { type, handler: handler as unknown as RunEventHandler };
}

// Static registry — THE integration point for features 3-5 (loot drops, codex banking, travel,
// rest nodes register here instead of inline-editing room-machine.ts). Order within an event
// type is execution order and is LOAD-BEARING: the XP recorder runs before the contract recorder
// so that when the machine sees `completed` and settles victory, the just-won encounter's XP is
// already in the ledger and banks at 1.0 (§4.3).
const REGISTRY: readonly RunEventRegistration[] = [
  on("run-started", recordRunStarted),
  on("encounter-won", recordEncounterWon), // 1) XP accrual + stats/titles (scaled XP, 05 §4.5)
  on("encounter-won", contractProgressRecorder), // 2) contract progress (reads post-accrual world)
  on("encounter-won", gatewayAttunementRecorder), // 3) gateway attunement (gateways.ts; independent)
  on("encounter-won", lootDropRecorder), // 4) drops (independent of the three above)
  on("encounter-won", restOnClearRecorder), // 5) rest on liberating a town (05; last — independent)
  on("hex-entered", restOnArrivalRecorder), // 05 — hex-entered's first consumer
  on("dimension-entered", recordDimensionEntered), // travel arrival: chart + dimensions_traveled + titles
  on("dimension-entered", restOnTravelRecorder), // 05 — arrival lands on the auto-cleared origin town
  on("run-ended", recordRunSettled), // XP banking pushes
  on("run-ended", codexBankingRecorder), // THE banking hook (02 §9) — after settlement pushes
];

function buildMap(
  regs: readonly RunEventRegistration[],
): ReadonlyMap<RunEvent["type"], readonly RunEventHandler[]> {
  const map = new Map<RunEvent["type"], RunEventHandler[]>();
  for (const reg of regs) {
    const list = map.get(reg.type);
    if (list) list.push(reg.handler);
    else map.set(reg.type, [reg.handler]);
  }
  return map;
}

const HANDLERS = buildMap(REGISTRY);

export function emitRunEvent(room: Room, io: RoomIO, event: RunEvent): void {
  const handlers = HANDLERS.get(event.type);
  if (!handlers) return;
  for (const handler of handlers) handler(room, io, event);
}
