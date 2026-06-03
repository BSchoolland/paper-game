import { describe, it, expect } from "bun:test";
import { resolveVote } from "../overworld/movement-vote.js";
import type { SeatId, VoteChoice } from "../net/protocol.js";

const ballots = (entries: [SeatId, VoteChoice][]) => new Map<SeatId, VoteChoice>(entries);

describe("movement vote resolution (R15)", () => {
  it("single human resolves instantly (proposer auto-yes)", () => {
    expect(resolveVote(ballots([["s0", "yes"]]), ["s0"])).toEqual({ decided: true, accepted: true });
  });

  it("stays undecided until all electors vote (no deadline)", () => {
    expect(resolveVote(ballots([["s0", "yes"]]), ["s0", "s1"])).toEqual({ decided: false, accepted: false });
  });

  it("unanimous yes accepts", () => {
    expect(resolveVote(ballots([["s0", "yes"], ["s1", "yes"]]), ["s0", "s1"])).toEqual({ decided: true, accepted: true });
  });

  it("even split: proposer breaks the tie -> accept", () => {
    expect(resolveVote(ballots([["s0", "yes"], ["s1", "no"]]), ["s0", "s1"])).toEqual({ decided: true, accepted: true });
  });

  it("majority no rejects", () => {
    expect(
      resolveVote(ballots([["s0", "yes"], ["s1", "no"], ["s2", "no"]]), ["s0", "s1", "s2"]),
    ).toEqual({ decided: true, accepted: false });
  });

  it("deadline with abstainers resolves on cast ballots", () => {
    expect(resolveVote(ballots([["s0", "yes"]]), ["s0", "s1"], { deadlinePassed: true })).toEqual({
      decided: true,
      accepted: true,
    });
  });

  it("deadline tie (one yes, one no, one abstain): proposer carries -> accept", () => {
    expect(
      resolveVote(ballots([["s0", "yes"], ["s1", "no"]]), ["s0", "s1", "s2"], { deadlinePassed: true }),
    ).toEqual({ decided: true, accepted: true });
  });
});
