import type { SeatId, VoteChoice } from "../net/protocol.js";

/**
 * Pure overworld movement-vote resolution (DESIGN.md §6, ruling R15). The server Room owns the
 * open vote (electorate, ballots, deadline) and calls this to decide the outcome; clients never
 * resolve locally. Keeping the rule pure makes the electorate/tie-break/timeout behaviour
 * unit-testable.
 *
 * Rule: the proposer auto-votes "yes", so `yes >= 1` always holds for a live proposal. The move
 * is accepted when `yes >= no` (a majority of cast ballots, with the proposer breaking ties).
 * Abstainers (electorate members who never voted) only matter at the deadline, where they count
 * as no-shows. The vote is `decided` once every elector has voted OR the deadline has passed.
 */

export interface VoteResolution {
  readonly decided: boolean;
  readonly accepted: boolean;
}

export function resolveVote(
  ballots: ReadonlyMap<SeatId, VoteChoice>,
  electorate: readonly SeatId[],
  opts: { deadlinePassed?: boolean } = {},
): VoteResolution {
  let yes = 0;
  let no = 0;
  for (const seat of electorate) {
    const v = ballots.get(seat);
    if (v === "yes") yes++;
    else if (v === "no") no++;
  }

  const allVoted = electorate.length > 0 && electorate.every((s) => ballots.has(s));
  if (!allVoted && !opts.deadlinePassed) return { decided: false, accepted: false };

  return { decided: true, accepted: yes >= 1 && yes >= no };
}
