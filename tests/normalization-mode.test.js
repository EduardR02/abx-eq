import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const audioEngineSource = readFileSync(join(import.meta.dir, "..", "public", "audio-engine.js"), "utf8");
const appSource = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const htmlSource = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");

describe("normalization mode defaults", () => {
  test("defaults to ear sensitivity matching in app state and engine preparation", () => {
    expect(appSource).toContain('normalizationMode: "earsens",');
    expect(audioEngineSource).toContain('normalizationMode = "earsens"');
  });

  test("app mode coercion accepts earsens, treble, rms, and lufs", () => {
    expect(appSource).toContain('value === "earsens" || value === "treble" || value === "rms" || value === "lufs"');
    expect(appSource).toContain('return "earsens";');
  });
});

describe("normalization wiring", () => {
  test("audio engine includes ear-sensitivity and treble measurement paths", () => {
    expect(audioEngineSource).toContain("function measureEarSensitivityRms(audioBuffer)");
    expect(audioEngineSource).toContain("frequency: 1000");
    expect(audioEngineSource).toContain("frequency: 4000");

    expect(audioEngineSource).toContain("function measureBandpassRms(audioBuffer)");
    expect(audioEngineSource).toContain('type: "highpass"');
    expect(audioEngineSource).toContain("frequency: 2000");
    expect(audioEngineSource).toContain('type: "lowpass"');
    expect(audioEngineSource).toContain("frequency: 10000");

    expect(audioEngineSource).toContain('normalizationMode === "earsens" ? measureEarSensitivityRms');
    expect(audioEngineSource).toContain(': normalizationMode === "treble" ? measureBandpassRms');
    expect(audioEngineSource).toContain(': normalizationMode === "rms" ? measureFlatRms');
    expect(audioEngineSource).toContain(': normalizationMode === "lufs" ? measureKWeightedLufs');
  });

  test("setup dropdown exposes earsens first with all four modes", () => {
    const earsensLabel = '<option value="earsens">Ear sensitivity 1–4 kHz (recommended)</option>';
    const trebleLabel = '<option value="treble">Treble-matched 2–10 kHz</option>';
    const rmsLabel = '<option value="rms">Flat RMS</option>';
    const lufsLabel = '<option value="lufs">K-weighted LUFS (broadcast standard)</option>';

    expect(htmlSource).toContain(earsensLabel);
    expect(htmlSource).toContain(trebleLabel);
    expect(htmlSource).toContain(rmsLabel);
    expect(htmlSource).toContain(lufsLabel);
    expect(htmlSource.indexOf(earsensLabel)).toBeLessThan(htmlSource.indexOf(trebleLabel));
    expect(htmlSource.indexOf(trebleLabel)).toBeLessThan(htmlSource.indexOf(rmsLabel));
    expect(htmlSource.indexOf(rmsLabel)).toBeLessThan(htmlSource.indexOf(lufsLabel));
  });
});
