import { describe, expect, test } from "bun:test";
import {
  buildRoundPlanSuggestions,
  pairCountForPresetCount,
} from "../public/round-plan.js";

describe("round plan", () => {
  test("computes pair count from preset count", () => {
    expect(pairCountForPresetCount(1)).toBe(0);
    expect(pairCountForPresetCount(4)).toBe(6);
    expect(pairCountForPresetCount(6)).toBe(15);
  });

  test("matches target matchup suggestions for four presets", () => {
    const suggestions = buildRoundPlanSuggestions(4);

    expect(suggestions.quick).toBe(20);
    expect(suggestions.standard).toBe(30);
    expect(suggestions.rigorous).toBe(48);
  });

  test("matches target matchup suggestions for six presets", () => {
    const suggestions = buildRoundPlanSuggestions(6);

    expect(suggestions.quick).toBe(30);
    expect(suggestions.standard).toBe(45);
    expect(suggestions.rigorous).toBe(72);
  });

  test("matches target matchup suggestions for seven presets", () => {
    const suggestions = buildRoundPlanSuggestions(7);

    expect(suggestions.quick).toBe(35);
    expect(suggestions.standard).toBe(52);
    expect(suggestions.rigorous).toBe(84);
  });
});
