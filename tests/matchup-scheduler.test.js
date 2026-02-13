import { describe, expect, test } from "bun:test";
import { MatchupScheduler } from "../public/matchup-scheduler.js";

function canonicalPair(matchup) {
  const first = matchup.presetA;
  const second = matchup.presetB;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function runScheduler(scheduler) {
  const results = [];
  const matchups = [];

  while (true) {
    const next = scheduler.next(results);
    if (!next) {
      break;
    }

    matchups.push(next);
    results.push({ winnerId: next.presetA, loserId: next.presetB });
  }

  return { results, matchups };
}

describe("MatchupScheduler", () => {
  test("phase 1 covers all C(n,2) pairs exactly once", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c", "d"], 6, { random: () => 0 });
    const results = [];
    const seen = new Set();

    for (let i = 0; i < 6; i += 1) {
      const next = scheduler.next(results);
      expect(next).not.toBeNull();
      seen.add(canonicalPair(next));
      results.push({ winnerId: next.presetA, loserId: next.presetB });
    }

    expect(seen.size).toBe(6);
    expect(scheduler.next(results)).toBeNull();
  });

  test("phase 2 chooses the closest BT pair", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c", "d"], 120, { random: () => 0 });

    const results = [];
    for (let i = 0; i < 10; i += 1) {
      results.push({ presetA: "b", presetB: "c", scoreA: i % 2 === 0 ? 1 : 0 });
      results.push({ presetA: "a", presetB: "b", scoreA: 1 });
      results.push({ presetA: "a", presetB: "c", scoreA: 1 });
      results.push({ presetA: "a", presetB: "d", scoreA: 1 });
      results.push({ presetA: "b", presetB: "d", scoreA: 1 });
      results.push({ presetA: "c", presetB: "d", scoreA: 1 });
    }

    const next = scheduler.next(results);
    expect(canonicalPair(next)).toBe("b|c");
  });

  test("anti-repetition penalizes very recent pairs", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c", "d"], 12, { random: () => 0 });
    const results = [
      { presetA: "a", presetB: "b", scoreA: 0.5 },
      { presetA: "a", presetB: "c", scoreA: 0.5 },
      { presetA: "a", presetB: "d", scoreA: 0.5 },
      { presetA: "b", presetB: "c", scoreA: 0.5 },
      { presetA: "b", presetB: "d", scoreA: 0.5 },
      { presetA: "c", presetB: "d", scoreA: 0.5 },
    ];

    const next = scheduler.next(results);
    const picked = canonicalPair(next);

    expect(picked).not.toBe("c|d");
    expect(["b|c", "b|d", "c|d"]).not.toContain(picked);
  });

  test("respects the total matchup budget", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c"], 5, { random: () => 0 });
    const { matchups } = runScheduler(scheduler);

    expect(matchups).toHaveLength(5);
    expect(scheduler.isComplete).toBe(true);
  });

  test("enforces minimum budget of one full discovery pass", () => {
    const scheduler = new MatchupScheduler(["a", "b", "c", "d"], 3, { random: () => 0 });
    const { matchups } = runScheduler(scheduler);

    expect(scheduler.progress.total).toBe(6);
    expect(matchups).toHaveLength(6);
  });
});
