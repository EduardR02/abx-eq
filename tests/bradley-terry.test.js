import { describe, expect, test } from "bun:test";
import {
  buildBradleyTerryStandings,
  fitBradleyTerry,
  normalizeBradleyTerryScores,
} from "../public/bradley-terry.js";

describe("bradley-terry", () => {
  test("keeps strengths equal for symmetric outcomes", () => {
    const presets = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const matches = [
      { presetA: "a", presetB: "b", scoreA: 1 },
      { presetA: "a", presetB: "b", scoreA: 0 },
    ];

    const strengths = fitBradleyTerry(presets, matches, { maxIterations: 60 });
    const normalized = normalizeBradleyTerryScores(strengths);

    expect(normalized.get("a")).toBeCloseTo(normalized.get("b"), 5);
  });

  test("is stable across match ordering", () => {
    const presets = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];

    const ordered = [
      { presetA: "a", presetB: "b", scoreA: 1 },
      { presetA: "a", presetB: "c", scoreA: 1 },
      { presetA: "b", presetB: "c", scoreA: 1 },
      { presetA: "b", presetB: "a", scoreA: 0 },
      { presetA: "c", presetB: "a", scoreA: 0 },
      { presetA: "c", presetB: "b", scoreA: 0 },
    ];

    const reversed = [...ordered].reverse();
    const first = fitBradleyTerry(presets, ordered, { maxIterations: 60 });
    const second = fitBradleyTerry(presets, reversed, { maxIterations: 60 });

    expect(first.get("a")).toBeCloseTo(second.get("a"), 6);
    expect(first.get("b")).toBeCloseTo(second.get("b"), 6);
    expect(first.get("c")).toBeCloseTo(second.get("c"), 6);
  });

  test("builds standings with draw-aware win rate", () => {
    const presets = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const matches = [
      { presetA: "a", presetB: "b", scoreA: 0.5 },
      { presetA: "a", presetB: "b", scoreA: 1 },
    ];

    const standings = buildBradleyTerryStandings(presets, matches, {
      confidenceSamples: 0,
      fitOptions: { maxIterations: 60 },
    });
    const byId = new Map(standings.map((row) => [row.id, row]));

    expect(byId.get("a").wins).toBe(1);
    expect(byId.get("a").draws).toBe(1);
    expect(byId.get("a").winRate).toBeCloseTo(0.75, 5);
    expect(byId.get("a").btScore).toBeGreaterThan(byId.get("b").btScore);
  });
});
