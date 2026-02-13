import { describe, expect, test } from "bun:test";
import {
  binomialTailProbability,
  computeRequiredTrials,
  isSignificant,
  pairPreferencePValue,
  twoSidedBinomialTest,
} from "../public/stats.js";

describe("stats", () => {
  test("computes one-tailed binomial p-value", () => {
    const p = binomialTailProbability(13, 16, 0.5);
    expect(p).toBeCloseTo(0.0106, 4);
  });

  test("detects significance threshold", () => {
    expect(isSignificant(0.04)).toBe(true);
    expect(isSignificant(0.05)).toBe(false);
  });

  test("computes two-sided binomial p-value", () => {
    const p = twoSidedBinomialTest(8, 10, 0.5);
    expect(p).toBeCloseTo(0.1094, 4);
  });

  test("uses only decisive outcomes in pair preference p-value", () => {
    const noDraws = pairPreferencePValue({ wins: 8, losses: 2, draws: 0 });
    const withDraws = pairPreferencePValue({ wins: 8, losses: 2, draws: 2 });

    expect(noDraws).toBeCloseTo(0.1094, 4);
    expect(withDraws).toBeCloseTo(noDraws, 8);
  });

  test("returns p=1 when there are no decisive outcomes", () => {
    const p = pairPreferencePValue({ wins: 0, losses: 0, draws: 12 });
    expect(p).toBe(1);
  });

  test("computes exact required trials for preference tiers", () => {
    expect(computeRequiredTrials(0.8, 0.05, 0.8)).toBe(20);
    expect(computeRequiredTrials(0.7, 0.05, 0.8)).toBe(49);
    expect(computeRequiredTrials(0.6, 0.05, 0.8)).toBe(199);
  });
});
