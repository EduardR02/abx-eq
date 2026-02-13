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
