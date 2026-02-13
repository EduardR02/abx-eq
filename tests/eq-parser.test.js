import { describe, expect, test } from "bun:test";
import { parseEqualizerApo } from "../public/eq-parser.js";

describe("parseEqualizerApo", () => {
  test("parses preamp and enabled filters", () => {
    const input = `
Preamp: -4.8 dB
Filter 1: ON LSC Fc 61 Hz Gain 4.49 dB Q 0.858
Filter 2: OFF PK Fc 71 Hz Gain 0.62 dB Q 2.971
Filter 3: ON PK Fc 3211 Hz Gain -4.32 dB Q 2.141
Filter 10: ON HSC Fc 12786 Hz Gain -3.75 dB Q 1.281
`;

    const parsed = parseEqualizerApo(input, "example.txt");
    expect(parsed.preampDb).toBe(-4.8);
    expect(parsed.filters).toHaveLength(3);
    expect(parsed.filters[0]).toEqual({
      index: 1,
      type: "lowshelf",
      frequency: 61,
      gainDb: 4.49,
      q: 0.858,
    });
    expect(parsed.filters[2].type).toBe("highshelf");
  });

  test("throws on unsupported filter type", () => {
    const input = "Filter 1: ON NOTREAL Fc 100 Hz Gain 1 dB Q 1";
    expect(() => parseEqualizerApo(input, "bad.txt")).toThrow("unsupported filter type");
  });
});
