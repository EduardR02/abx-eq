import { afterEach, describe, expect, test } from "bun:test";
import { parseEqualizerApo } from "../public/eq-parser.js";
import { LocalSource, ServerSource, detectSource } from "../public/source-adapters.js";

const originalFetch = globalThis.fetch;

function createJsonResponse(body, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return body;
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseEqualizerApo", () => {
  test("parses preamp and enabled filters with backward-compatible defaults", () => {
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
    expect(parsed.leftPreampDb).toBe(0);
    expect(parsed.leftFilters).toEqual([]);
    expect(parsed.rightPreampDb).toBe(0);
    expect(parsed.rightFilters).toEqual([]);
    expect(parsed.filters[0]).toEqual({
      index: 1,
      type: "lowshelf",
      frequency: 61,
      gainDb: 4.49,
      q: 0.858,
    });
    expect(parsed.filters[2].type).toBe("highshelf");
  });

  test("parses left and right channel blocks", () => {
    const input = `
Preamp: -10 dB
Filter 1: ON PK Fc 80 Hz Gain 3.5 dB Q 1.41
Filter 2: ON PK Fc 4000 Hz Gain -2.0 dB Q 2.0

Channel: L
Preamp: -1.5 dB
Filter 1: ON PK Fc 3200 Hz Gain 1.5 dB Q 3.0

Channel: R
Preamp: -0.8 dB
Filter 2: ON PK Fc 8500 Hz Gain 0.5 dB Q 2.0
`;

    const parsed = parseEqualizerApo(input, "channels.txt");

    expect(parsed).toMatchObject({
      preampDb: -10,
      leftPreampDb: -1.5,
      rightPreampDb: -0.8,
    });
    expect(parsed.filters.map((filter) => filter.index)).toEqual([1, 2]);
    expect(parsed.leftFilters).toEqual([
      {
        index: 1,
        type: "peaking",
        frequency: 3200,
        gainDb: 1.5,
        q: 3,
      },
    ]);
    expect(parsed.rightFilters).toEqual([
      {
        index: 2,
        type: "peaking",
        frequency: 8500,
        gainDb: 0.5,
        q: 2,
      },
    ]);
  });

  test("supports Channel: all reset and numeric channel selectors", () => {
    const input = `
Filter 1: ON PK Fc 80 Hz Gain 3.5 dB Q 1.41
Channel: 1
Preamp: -2 dB
Filter 1: ON PK Fc 3200 Hz Gain 1.5 dB Q 3.0
Channel: 2
Preamp: -1 dB
Filter 1: ON PK Fc 8500 Hz Gain 0.5 dB Q 2.0
Channel: all
Preamp: -6 dB
Filter 2: ON HSC Fc 12000 Hz Gain -1.5 dB Q 0.7
`;

    const parsed = parseEqualizerApo(input, "reset.txt");

    expect(parsed.preampDb).toBe(-6);
    expect(parsed.filters.map((filter) => filter.index)).toEqual([1, 2]);
    expect(parsed.leftPreampDb).toBe(-2);
    expect(parsed.rightPreampDb).toBe(-1);
    expect(parsed.leftFilters).toHaveLength(1);
    expect(parsed.rightFilters).toHaveLength(1);
  });

  test("accumulates repeated preamps across channel selections", () => {
    const input = `
Preamp: -5 dB
Channel: L
Preamp: -3 dB
Channel: all
Preamp: -1 dB
`;

    const parsed = parseEqualizerApo(input, "repeated-preamps.txt");

    expect(parsed.preampDb).toBe(-6);
    expect(parsed.leftPreampDb).toBe(-3);
    expect(parsed.rightPreampDb).toBe(0);
  });

  test("supports stereo channel lists", () => {
    const input = `
Channel: R L
Preamp: -2 dB
Filter 1: ON PK Fc 3200 Hz Gain 1.5 dB Q 3.0
Channel: 2 1
Preamp: -1 dB
Filter 2: ON HSC Fc 8500 Hz Gain 0.5 dB Q 2.0
`;

    const parsed = parseEqualizerApo(input, "stereo-lists.txt");

    expect(parsed.preampDb).toBe(-3);
    expect(parsed.leftPreampDb).toBe(0);
    expect(parsed.rightPreampDb).toBe(0);
    expect(parsed.filters.map((filter) => filter.index)).toEqual([1, 2]);
    expect(parsed.leftFilters).toEqual([]);
    expect(parsed.rightFilters).toEqual([]);
  });

  test("throws on unsupported filter type", () => {
    const input = "Filter 1: ON NOTREAL Fc 100 Hz Gain 1 dB Q 1";
    expect(() => parseEqualizerApo(input, "bad.txt")).toThrow("unsupported filter type");
  });

  test("throws on unknown channel identifier", () => {
    const input = "Channel: center";
    expect(() => parseEqualizerApo(input, "bad-channel.txt")).toThrow("unsupported channel identifier");
  });

  test("throws on unknown channel identifier inside a list", () => {
    const input = "Channel: L center";
    expect(() => parseEqualizerApo(input, "bad-channel-list.txt")).toThrow("unsupported channel identifier");
  });
});

describe("source adapters", () => {
  test("ServerSource routes listing, track, config, and browse calls", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options });

      if (url === "/api/presets") {
        return createJsonResponse([{ filename: "preset.txt" }]);
      }
      if (url === "/api/tracks") {
        return createJsonResponse(["track.wav"]);
      }
      if (url === "/api/config" && options.method === "POST") {
        return createJsonResponse({ musicDir: "music", presetsDir: "presets" });
      }
      if (url === "/api/config") {
        return createJsonResponse({ musicDir: "music", presetsDir: "presets" });
      }
      if (url === "/api/browse") {
        return createJsonResponse({ path: "music" });
      }
      if (url === "/music/track.wav") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3]).buffer;
          },
        };
      }

      throw new Error(`Unexpected url: ${url}`);
    };

    const source = new ServerSource();

    expect(await source.listPresets()).toEqual([{ filename: "preset.txt" }]);
    expect(await source.listTracks()).toEqual(["track.wav"]);
    expect(new Uint8Array(await source.loadTrackArrayBuffer("track.wav"))).toEqual(new Uint8Array([1, 2, 3]));
    expect(await source.getConfig()).toEqual({ musicDir: "music", presetsDir: "presets" });
    expect(await source.setConfig({ musicDir: "music", presetsDir: "presets" })).toEqual({
      musicDir: "music",
      presetsDir: "presets",
    });
    expect(await source.browse()).toBe("music");
    expect(calls.map((call) => call.url)).toEqual([
      "/api/presets",
      "/api/tracks",
      "/music/track.wav",
      "/api/config",
      "/api/config",
      "/api/browse",
    ]);
  });

  test("LocalSource parses txt presets and loads wav tracks", async () => {
    const source = new LocalSource();
    const presetText = "Preamp: -2.0 dB\nFilter 1: ON PK Fc 950 Hz Gain 2.5 dB Q 1.1\nChannel: L\nPreamp: -1.0 dB\n";

    await source.addFiles([
      new File([presetText], "Preset 1.txt", { type: "text/plain" }),
      new File([new Uint8Array([3, 4, 5])], "track.wav", { type: "audio/wav" }),
    ]);

    const presets = await source.listPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({
      id: "Preset 1.txt",
      name: "Preset 1",
      filename: "Preset 1.txt",
      preampDb: -2,
      leftPreampDb: -1,
      leftFilters: [],
      rightPreampDb: 0,
      rightFilters: [],
    });
    expect(await source.listTracks()).toEqual(["track.wav"]);
    expect(new Uint8Array(await source.loadTrackArrayBuffer("track.wav"))).toEqual(new Uint8Array([3, 4, 5]));
    expect(source.supportsDirectoryConfig).toBe(false);
    expect(await source.getConfig()).toBeNull();
  });

  test("detectSource chooses server when /api/config is reachable", async () => {
    globalThis.fetch = async () => createJsonResponse({}, { ok: true });
    const source = await detectSource({ timeoutMs: 50 });
    expect(source).toBeInstanceOf(ServerSource);
  });

  test("detectSource falls back to local source when /api/config fails", async () => {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const source = await detectSource({ timeoutMs: 50 });
    expect(source).toBeInstanceOf(LocalSource);
  });
});
