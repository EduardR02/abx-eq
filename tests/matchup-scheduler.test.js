import { describe, expect, test } from "bun:test";
import { MatchupScheduler } from "../public/matchup-scheduler.js";

function canonicalPair(matchup) {
  const first = matchup.presetA;
  const second = matchup.presetB;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function runScheduler(
  scheduler,
  makeResult = (matchup) => ({ winnerId: matchup.presetA, loserId: matchup.presetB }),
) {
  const results = [];
  const matchups = [];

  while (true) {
    const next = scheduler.next(results);
    if (!next) {
      break;
    }

    matchups.push(next);
    results.push(makeResult(next, results, matchups));
  }

  return { results, matchups };
}

describe("MatchupScheduler", () => {
  test("respects the total matchup budget", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c", "d"], 9, { random: () => 0 });
    const { matchups } = runScheduler(scheduler);

    expect(matchups).toHaveLength(9);
    expect(scheduler.isComplete).toBe(true);
    expect(scheduler.progress).toEqual({ done: 9, total: 9, phase: "complete" });
  });

  test("keeps scheduling a dominant profile after cold start", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c", "d", "e", "f", "g"], 37, {
      random: () => 0,
    });

    const { matchups } = runScheduler(scheduler, (matchup) => {
      if (matchup.presetA === "a") {
        return { winnerId: "a", loserId: matchup.presetB };
      }
      if (matchup.presetB === "a") {
        return { winnerId: "a", loserId: matchup.presetA };
      }
      return { winnerId: matchup.presetA, loserId: matchup.presetB };
    });

    const dominantAppearances = matchups.filter(
      (matchup) => matchup.presetA === "a" || matchup.presetB === "a",
    ).length;

    expect(matchups).toHaveLength(37);
    expect(dominantAppearances).toBeGreaterThan(10);
  });

  test("does not schedule the same pair in consecutive rounds", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c", "d"], 24, { random: () => 0 });
    const { matchups } = runScheduler(
      scheduler,
      (matchup) => ({ presetA: matchup.presetA, presetB: matchup.presetB, scoreA: 0.5 }),
    );

    for (let i = 1; i < matchups.length; i += 1) {
      expect(canonicalPair(matchups[i])).not.toBe(canonicalPair(matchups[i - 1]));
    }
  });

  test("supports small budgets below C(n,2)", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c"], 2, { random: () => 0 });
    const { matchups } = runScheduler(scheduler);

    expect(scheduler.progress.total).toBe(2);
    expect(matchups).toHaveLength(2);
    expect(scheduler.isComplete).toBe(true);
  });

  test("works with exactly two profiles", () => {
    const scheduler = new MatchupScheduler(["a", "b"], 6, { random: () => 0 });
    const { matchups } = runScheduler(scheduler);

    expect(matchups).toHaveLength(6);
    for (const matchup of matchups) {
      expect(canonicalPair(matchup)).toBe("a|b");
    }
  });

  test("is deterministic with seeded random tie-breaking", () => {
    const buildSequence = () => {
      const scheduler = new MatchupScheduler(["a", "b", "c", "d", "e"], 16, { random: () => 0 });
      const { matchups } = runScheduler(
        scheduler,
        (matchup) => ({ presetA: matchup.presetA, presetB: matchup.presetB, scoreA: 0.5 }),
      );
      return matchups.map(canonicalPair);
    };

    expect(buildSequence()).toEqual(buildSequence());
  });
});
