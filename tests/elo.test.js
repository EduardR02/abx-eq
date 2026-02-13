import { describe, expect, test } from "bun:test";
import { buildStandings, expectedScore } from "../public/elo.js";

describe("elo", () => {
  test("expected score is symmetric", () => {
    const a = expectedScore(1500, 1500);
    const b = expectedScore(1600, 1400);
    expect(a).toBe(0.5);
    expect(b).toBeGreaterThan(0.5);
  });

  test("buildStandings updates wins/losses/draws", () => {
    const presets = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];

    const matches = [
      { presetA: "a", presetB: "b", scoreA: 1 },
      { presetA: "a", presetB: "c", scoreA: 0.5 },
      { presetA: "b", presetB: "c", scoreA: 0 },
    ];

    const standings = buildStandings(presets, matches, 32);
    const byId = new Map(standings.map((row) => [row.id, row]));

    expect(byId.get("a").wins).toBe(1);
    expect(byId.get("a").draws).toBe(1);
    expect(byId.get("b").losses).toBe(2);
    expect(byId.get("c").wins).toBe(1);
  });
});
