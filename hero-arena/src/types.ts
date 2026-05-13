import type { EntityId, GameState, PlayerAction } from "../../shared/src/index.js";

/**
 * Everything your hero brain is handed at the start of *its* turn. Read-only — never mutate
 * `state` (it's the live engine state). To verify moves / run lookahead, use the helpers in
 * `hero-arena/src/toolkit.ts` (they wrap the real engine and never mutate anything).
 */
export interface HeroContext {
  /** The board at the start of your hero's turn. */
  readonly state: GameState;
  /** Your hero's entity id. `state.entities.get(heroId)!.teamId` tells you which side you're on. */
  readonly heroId: EntityId;
  /**
   * `Date.now()` by which you should have returned. Overrunning is logged; overrunning *badly*
   * forfeits this turn (your hero just passes). Cooperative — there is no hard interrupt, so a
   * search-based bot must poll this itself. (The tournament harness measures wall time.)
   */
  readonly deadlineMs: number;
  /** 1-based count of how many turns your *side* has taken so far (handy for opening books / state). */
  readonly turnIndex: number;
}

/**
 * A hero bot. Given the context, return the sequence of `ability` actions your hero should take
 * this turn (move / attack / etc.), in order — **no `endTurn`** (the harness adds it after your
 * actions and your dumb allies'). Return `[]` to pass.
 *
 * Rules the harness enforces for you: any action that isn't `{type:"ability", entityId: <your
 * heroId>}` is dropped; any action the engine rejects (unaffordable / out of range / into a wall)
 * is dropped; you get at most a sane number of actions (energy bounds it anyway). So you can be
 * optimistic — worst case a bad action is a no-op, not a crash.
 *
 * Your bot may keep module-level state between turns *within a match* if it wants (it's a fresh
 * import per process, and the harness reuses one controller instance for a whole match). For
 * reproducible replays, be deterministic — or seed any RNG from the game state.
 */
export type HeroController = (ctx: HeroContext) => PlayerAction[];

/** A bot module just exports `hero`. */
export interface HeroAgentModule {
  readonly hero: HeroController;
}
