import { describe, expect, test } from "bun:test";
import { advanceAbxRunTrial } from "../public/abx-run.js";

describe("advanceAbxRunTrial", () => {
  test("resets listening target to A for the next trial", () => {
    const run = {
      aId: "preset-a",
      bId: "preset-b",
      xIs: "A",
      totalTrials: 3,
      trialIndex: 0,
      correct: 0,
    };

    const next = advanceAbxRunTrial(run, "B", () => 0.8);

    expect(next).toEqual({
      isComplete: false,
      listeningTarget: "A",
      variantId: "preset-a",
    });
    expect(run.trialIndex).toBe(1);
    expect(run.correct).toBe(0);
    expect(run.xIs).toBe("B");
  });

  test("records a correct guess and marks completion on final trial", () => {
    const run = {
      aId: "preset-a",
      bId: "preset-b",
      xIs: "A",
      totalTrials: 1,
      trialIndex: 0,
      correct: 0,
    };

    const next = advanceAbxRunTrial(run, "A", () => 0.1);

    expect(next).toEqual({
      isComplete: true,
      listeningTarget: null,
      variantId: null,
    });
    expect(run.trialIndex).toBe(1);
    expect(run.correct).toBe(1);
    expect(run.xIs).toBe("A");
  });
});
