import { describe, expect, it } from "vitest";

import { isStandardChallenge } from "./runs";

describe("only standard challenge runs go to the leaderboard", () => {
  const base = { id: "maze", seed: 1, difficulty: "hard" as const };
  it("same test for everyone", () => {
    expect(isStandardChallenge(base)).toBe(true);
    expect(isStandardChallenge({ ...base, id: "cube", stateFormat: "pieces", distanceHint: true })).toBe(true);
  });
  it("anything that changes the test is left out", () => {
    expect(isStandardChallenge({ ...base, untilSolved: true })).toBe(false);
    expect(isStandardChallenge({ ...base, maxMoves: 20 })).toBe(false);
    expect(isStandardChallenge({ ...base, id: "cube", stateFormat: "net" })).toBe(false);
    expect(isStandardChallenge({ ...base, id: "cube", distanceHint: false })).toBe(false);
  });
});
