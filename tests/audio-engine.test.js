import { describe, expect, test } from "bun:test";
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
