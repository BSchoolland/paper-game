import type { ActionResult, GameEvent, GameState } from "../core/types.js";

export interface ReactionContext {
  readonly defenseMap?: ReadonlyMap<string, number>;
}

export type ReactionHandler<T extends GameEvent["type"] = GameEvent["type"]> = (
  event: Extract<GameEvent, { type: T }>,
  state: GameState,
  ctx: ReactionContext,
) => ActionResult;

export type ReactionRegistry = ReadonlyMap<GameEvent["type"], readonly ReactionHandler[]>;

export interface ReactionRegistration {
  readonly type: GameEvent["type"];
  readonly handler: ReactionHandler;
}

// The one place event-variant narrowing is asserted; safe because runReactions only ever
// calls a handler for an event whose .type is its registry key.
export function on<T extends GameEvent["type"]>(type: T, handler: ReactionHandler<T>): ReactionRegistration {
  return { type, handler: handler as unknown as ReactionHandler };
}

export function createReactionBus(regs: readonly ReactionRegistration[]): ReactionRegistry {
  const map = new Map<GameEvent["type"], ReactionHandler[]>();
  for (const { type, handler } of regs) {
    const list = map.get(type) ?? [];
    list.push(handler);
    map.set(type, list);
  }
  return map;
}

// A well-formed rule set yields a bounded cascade. Overshooting means a handler is reacting to
// its own output — throw rather than hang or silently truncate the event log.
const MAX_REACTION_EVENTS = 10_000;

// Every event (original or produced) is offered to its handlers in order; each produced event is
// appended to the same array (logged AND re-offered), so reactions compose. One append-only array
// is both the FIFO queue (walked by cursor) and the returned event log.
export function runReactions(result: ActionResult, registry: ReactionRegistry, ctx: ReactionContext): ActionResult {
  let state = result.state;
  const events: GameEvent[] = [...result.events];
  let produced = 0;
  for (let cursor = 0; cursor < events.length; cursor++) {
    const handlers = registry.get(events[cursor]!.type);
    if (!handlers) continue;
    for (const handler of handlers) {
      const step = handler(events[cursor]!, state, ctx);
      state = step.state;
      for (const next of step.events) {
        if (++produced > MAX_REACTION_EVENTS) throw new Error(`runReactions exceeded ${MAX_REACTION_EVENTS} produced events; a handler is reacting to its own output`);
        events.push(next);
      }
    }
  }
  return { state, events };
}
