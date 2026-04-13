import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AudioEngine } from "../public/audio-engine.js";

function createFakeParam(initialValue) {
  const calls = [];
  return {
    calls,
    value: initialValue,
    cancelScheduledValues(time) {
      calls.push({ method: "cancelScheduledValues", time });
    },
    setValueAtTime(value, time) {
      calls.push({ method: "setValueAtTime", value, time });
      this.value = value;
    },
    linearRampToValueAtTime(value, time) {
      calls.push({ method: "linearRampToValueAtTime", value, time });
      this.value = value;
    },
  };
}

function createFakeAudioContext(currentTime = 0) {
  const sources = [];

  const context = {
    currentTime,
    destination: {},
    sources,
    createBufferSource() {
      const source = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        onended: null,
        startCalls: [],
        stopCalls: 0,
        connectTargets: [],
        connect(target) {
          this.connectTargets.push(target);
        },
        disconnect() {},
        start(when, offset) {
          this.startCalls.push({ when, offset });
        },
        stop() {
          this.stopCalls += 1;
        },
      };

      sources.push(source);
      return source;
    },
    createGain() {
      const gainParam = {
        value: 1,
        setValueAtTime(value) {
          this.value = value;
        },
      };

      return {
        gain: gainParam,
        connect() {},
        disconnect() {},
      };
    },
  };

  return context;
}

function configureEngineForPlayback(engine, { duration = 10, contextTime = 3 } = {}) {
  const context = createFakeAudioContext(contextTime);
  engine.context = context;
  engine.masterGain = {
    connect() {},
    disconnect() {},
    gain: {
      value: 1,
      setValueAtTime(value) {
        this.value = value;
      },
    },
  };

  const variant = {
    id: "a",
    name: "A",
    buffer: { duration },
  };

  engine.variants = [variant];
  engine.variantMap = new Map([[variant.id, variant]]);
  engine.activeVariantId = variant.id;
  engine.duration = duration;

  return context;
}

function createSimpleAudioBuffer({
  channels = 1,
  length = 4800,
  sampleRate = 48000,
  fillValue = 0.1,
} = {}) {
  const dataByChannel = Array.from({ length: channels }, () => {
    const data = new Float32Array(length);
    data.fill(fillValue);
    return data;
  });

  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData(channelIndex) {
      return dataByChannel[channelIndex];
    },
    copyToChannel(channelData, channelIndex) {
      dataByChannel[channelIndex].set(channelData);
    },
  };
}

function createPrepareTrackContext(decodedBuffer = createSimpleAudioBuffer()) {
  return {
    currentTime: 0,
    destination: {},
    async decodeAudioData() {
      return decodedBuffer;
    },
    createBuffer(channels, length, sampleRate) {
      return createSimpleAudioBuffer({ channels, length, sampleRate, fillValue: 0 });
    },
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime(value) {
            this.value = value;
          },
        },
        connect() {},
        disconnect() {},
      };
    },
    createBiquadFilter() {
      return {
        type: null,
        frequency: createFakeParam(20000),
        Q: { value: 0 },
        gain: { value: 0 },
        connect() {},
        disconnect() {},
      };
    },
  };
}

function createFakeHearingLossFilter(initialFrequency = 20000) {
  return {
    type: null,
    frequency: createFakeParam(initialFrequency),
    Q: { value: 0 },
  };
}

describe("AudioEngine.setActiveVariant", () => {
  test("crossfades between active and inactive variants", () => {
    const engine = new AudioEngine();
    engine.context = { currentTime: 12 };
    engine.variantMap = new Map([
      ["a", {}],
      ["b", {}],
    ]);

    const aParam = createFakeParam(1);
    const bParam = createFakeParam(0);
    engine.currentNodes = [
      { id: "a", gain: { gain: aParam } },
      { id: "b", gain: { gain: bParam } },
    ];

    engine.setActiveVariant("b");

    expect(engine.activeVariantId).toBe("b");
    expect(aParam.calls).toEqual([
      { method: "cancelScheduledValues", time: 12 },
      { method: "setValueAtTime", value: 1, time: 12 },
      { method: "linearRampToValueAtTime", value: 0, time: 12.005 },
    ]);
    expect(bParam.calls).toEqual([
      { method: "cancelScheduledValues", time: 12 },
      { method: "setValueAtTime", value: 0, time: 12 },
      { method: "linearRampToValueAtTime", value: 1, time: 12.005 },
    ]);
  });

  test("ignores unknown variants", () => {
    const engine = new AudioEngine();
    const param = createFakeParam(1);
    engine.currentNodes = [{ id: "a", gain: { gain: param } }];
    engine.variantMap = new Map([["a", {}]]);

    engine.setActiveVariant("missing");

    expect(param.calls).toEqual([]);
    expect(engine.activeVariantId).toBe(null);
  });
});

describe("AudioEngine hearing loss controls", () => {
  test("stores hearing loss settings before the audio context exists", () => {
    const engine = new AudioEngine();

    engine.setHearingLoss({ enabled: true, cutoffHz: 8200 });

    expect(engine.getState().hearingLoss).toEqual({
      enabled: true,
      cutoffHz: 8200,
    });
  });

  test("updates all hearing loss filters with the active cutoff", () => {
    const engine = new AudioEngine();
    const firstFilter = createFakeHearingLossFilter();
    const secondFilter = createFakeHearingLossFilter();
    engine.context = { currentTime: 4 };
    engine.hearingLossFilters = [firstFilter, secondFilter];

    engine.setHearingLoss({ enabled: true, cutoffHz: 7600 });

    for (const filter of [firstFilter, secondFilter]) {
      expect(filter.type).toBe("lowpass");
      expect(filter.Q.value).toBeCloseTo(0.70710678, 8);
      expect(filter.frequency.calls).toEqual([
        { method: "cancelScheduledValues", time: 4 },
        { method: "setValueAtTime", value: 20000, time: 4 },
        { method: "linearRampToValueAtTime", value: 7600, time: 4.08 },
      ]);
    }
  });

  test("bypasses hearing loss by restoring the max cutoff", () => {
    const engine = new AudioEngine();
    const filter = createFakeHearingLossFilter(7600);
    engine.context = { currentTime: 7 };
    engine.hearingLossFilters = [filter];
    engine.hearingLoss = { enabled: true, cutoffHz: 7600 };

    engine.setHearingLoss({ enabled: false, cutoffHz: 7600 });

    expect(filter.frequency.calls).toEqual([
      { method: "cancelScheduledValues", time: 7 },
      { method: "setValueAtTime", value: 7600, time: 7 },
      { method: "linearRampToValueAtTime", value: 20000, time: 7.08 },
    ]);
    expect(engine.getState().hearingLoss.enabled).toBe(false);
  });
});

describe("AudioEngine loop controls", () => {
  test("setLoopRegion stores loop boundaries", () => {
    const engine = new AudioEngine();
    engine.duration = 120;

    engine.setLoopRegion(12, 24);

    expect(engine.getLoopState()).toEqual({
      enabled: false,
      startTime: 12,
      endTime: 24,
    });
  });

  test("getLoopState returns the current loop settings", () => {
    const engine = new AudioEngine();
    engine.duration = 90;
    engine.setLoopRegion(8, 18);
    engine.setLoopEnabled(true);

    const loopState = engine.getLoopState();

    expect(loopState).toEqual({
      enabled: true,
      startTime: 8,
      endTime: 18,
    });

    loopState.enabled = false;
    expect(engine.getLoopState().enabled).toBe(true);
  });

  test("setLoopRegion clamps to valid duration range", () => {
    const engine = new AudioEngine();
    engine.duration = 30;

    engine.setLoopRegion(-10, 90);
    expect(engine.getLoopState()).toEqual({
      enabled: false,
      startTime: 0,
      endTime: 30,
    });

    engine.setLoopRegion(29.8, 29.9);
    const loop = engine.getLoopState();
    expect(loop.startTime).toBeCloseTo(29, 6);
    expect(loop.endTime).toBeCloseTo(30, 6);
  });
});

describe("AudioEngine playback looping", () => {
  test("loops the full track when no loop region is enabled", () => {
    const engine = new AudioEngine();
    const context = configureEngineForPlayback(engine, { duration: 10, contextTime: 5 });

    engine.play();

    const source = context.sources[0];
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0);
    expect(source.loopEnd).toBe(10);
    expect(source.startCalls[0].offset).toBe(0);

    context.currentTime = engine.startedAtContextTime + 10.25;
    expect(engine.getCurrentTime()).toBeCloseTo(0.25, 6);
  });

  test("restarts from the beginning when playback starts at track end", () => {
    const engine = new AudioEngine();
    const context = configureEngineForPlayback(engine, { duration: 12, contextTime: 9 });
    engine.playbackOffset = 12;

    engine.play();

    const source = context.sources[0];
    expect(source.startCalls[0].offset).toBe(0);
    expect(engine.sessionStartOffset).toBe(0);
  });

  test("prioritizes an enabled loop region over full-track looping", () => {
    const engine = new AudioEngine();
    const context = configureEngineForPlayback(engine, { duration: 12, contextTime: 2 });
    engine.setLoopRegion(2, 5);
    engine.setLoopEnabled(true);
    engine.playbackOffset = 9;

    engine.play();

    const source = context.sources[0];
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(2);
    expect(source.loopEnd).toBe(5);
    expect(source.startCalls[0].offset).toBe(2);

    context.currentTime = engine.startedAtContextTime + 3.6;
    expect(engine.getCurrentTime()).toBeCloseTo(2.6, 6);
  });
});

describe("AudioEngine.prepareTrack sources", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    globalThis.window = {};
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  test("uses provided trackData without fetching", async () => {
    const engine = new AudioEngine();
    engine.context = createPrepareTrackContext();
    engine.masterGain = {
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        setValueAtTime(value) {
          this.value = value;
        },
      },
    };

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    };

    const result = await engine.prepareTrack({
      trackData: new Uint8Array([1, 2, 3, 4]).buffer,
      presets: [{ id: "a", name: "A", preampDb: 0, filters: [] }],
      normalizationMode: "rms",
    });

    expect(fetchCalled).toBe(false);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].id).toBe("a");
  });

  test("falls back to trackUrl fetch for backward compatibility", async () => {
    const engine = new AudioEngine();
    engine.context = createPrepareTrackContext();
    engine.masterGain = {
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        setValueAtTime(value) {
          this.value = value;
        },
      },
    };

    const fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async arrayBuffer() {
          return new Uint8Array([5, 6, 7, 8]).buffer;
        },
      };
    };

    await engine.prepareTrack({
      trackUrl: "/music/example.wav",
      presets: [{ id: "a", name: "A", preampDb: 0, filters: [] }],
      normalizationMode: "rms",
    });

    expect(fetchCalls).toEqual(["/music/example.wav"]);
  });

  test("uses in-place rendering for presets with per-channel EQ", async () => {
    const engine = new AudioEngine();
    let offlineRenderCount = 0;
    engine.context = createPrepareTrackContext(createSimpleAudioBuffer({
      channels: 2,
      fillValue: 0.1,
    }));
    engine.masterGain = {
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        setValueAtTime(value) {
          this.value = value;
        },
      },
    };
    globalThis.window = {
      OfflineAudioContext: class FakeOfflineAudioContext {
        constructor(channels, length, sampleRate) {
          this.channels = channels;
          this.length = length;
          this.sampleRate = sampleRate;
          this.destination = {};
          offlineRenderCount += 1;
        }

        createBufferSource() {
          return {
            buffer: null,
            connect() {},
            start() {},
          };
        }

        createGain() {
          return {
            gain: { value: 1 },
            connect() {},
          };
        }

        createBiquadFilter() {
          return {
            type: null,
            frequency: { value: 0 },
            Q: { value: 0 },
            gain: { value: 0 },
            connect() {},
          };
        }

        async startRendering() {
          return createSimpleAudioBuffer({
            channels: this.channels,
            length: this.length,
            sampleRate: this.sampleRate,
            fillValue: 0.1,
          });
        }
      },
    };

    const result = await engine.prepareTrack({
      trackData: new Uint8Array([1, 2, 3, 4]).buffer,
      presets: [{
        id: "a",
        name: "A",
        preampDb: -6,
        filters: [],
        leftPreampDb: 6,
        leftFilters: [],
        rightPreampDb: -6,
        rightFilters: [],
      }],
      normalizationMode: "rms",
    });

    const buffer = result.variants[0].buffer;
    expect(offlineRenderCount).toBe(1);
    expect(result.variants[0].normalizationDb).toBeCloseTo(0, 6);
    expect(buffer.getChannelData(0)[0]).toBeCloseTo(0.1, 6);
    expect(buffer.getChannelData(1)[0]).toBeCloseTo(0.1 * (10 ** (-12 / 20)), 6);
  });

  test("measures loudness from global EQ only when per-channel EQ exists", async () => {
    const engine = new AudioEngine();
    engine.context = createPrepareTrackContext(createSimpleAudioBuffer({
      channels: 2,
      fillValue: 0.01,
    }));
    engine.masterGain = {
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        setValueAtTime(value) {
          this.value = value;
        },
      },
    };

    const result = await engine.prepareTrack({
      trackData: new Uint8Array([1, 2, 3, 4]).buffer,
      presets: [
        {
          id: "flat",
          name: "Flat",
          preampDb: 0,
          filters: [],
          leftPreampDb: 0,
          leftFilters: [],
          rightPreampDb: 0,
          rightFilters: [],
        },
        {
          id: "per-channel",
          name: "Per-channel",
          preampDb: 0,
          filters: [],
          leftPreampDb: 6,
          leftFilters: [],
          rightPreampDb: 0,
          rightFilters: [],
        },
      ],
      normalizationMode: "rms",
    });

    const boosted = result.variants.find((variant) => variant.id === "per-channel");
    expect(boosted.normalizationDb).toBeCloseTo(0, 6);
    expect(boosted.buffer.getChannelData(0)[0]).toBeCloseTo(0.01 * (10 ** (6 / 20)), 6);
    expect(boosted.buffer.getChannelData(1)[0]).toBeCloseTo(0.01, 6);
  });
});
