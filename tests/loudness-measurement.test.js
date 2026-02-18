import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const audioEngineSourcePath = join(import.meta.dir, "..", "public", "audio-engine.js");
const audioEngineSource = readFileSync(audioEngineSourcePath, "utf8");

function loadMeasurementApi() {
  const executableSource = audioEngineSource.replace(
    "export class AudioEngine extends EventTarget {",
    "class AudioEngine extends EventTarget {",
  );

  const factory = new Function(`
${executableSource}
return {
  designBiquad,
  getBs1770ChannelWeight,
  measureGatedLoudness,
  measureKWeightedLufs,
  measureFlatRms,
  measureBandpassRms,
  measureEarSensitivityRms,
};
`);

  return factory();
}

function createAudioBuffer(sampleRate, channels) {
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    length,
    numberOfChannels: channels.length,
    getChannelData(channelIndex) {
      return channels[channelIndex];
    },
  };
}

function createStereoFixture(sampleRate = 48000, seconds = 2) {
  const length = sampleRate * seconds;
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    left[i] = 0.26 * Math.sin(2 * Math.PI * 220 * t) + 0.07 * Math.sin(2 * Math.PI * 3500 * t);
    right[i] = 0.18 * Math.sin(2 * Math.PI * 440 * t) + 0.06 * Math.sin(2 * Math.PI * 1800 * t);
  }

  return createAudioBuffer(sampleRate, [left, right]);
}

function measureReferenceGatedLoudness(audioBuffer, filterStages, getChannelWeight) {
  const sampleRate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const channelCount = audioBuffer.numberOfChannels;
  if (!frames || !channelCount) {
    return -Infinity;
  }

  const stageCount = filterStages.length;
  const blockSize = Math.max(1, Math.floor(0.4 * sampleRate));
  const hopSize = Math.max(1, Math.floor(0.1 * sampleRate));
  const absoluteGateEnergy = 10 ** ((-70 + 0.691) / 10);

  const channelData = new Array(channelCount);
  const channelWeights = new Array(channelCount);
  const states = new Array(channelCount);

  for (let channel = 0; channel < channelCount; channel += 1) {
    channelData[channel] = audioBuffer.getChannelData(channel);
    channelWeights[channel] = getChannelWeight(channel, channelCount);

    const channelStates = new Array(stageCount);
    for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
      channelStates[stageIndex] = { z1: 0, z2: 0 };
    }
    states[channel] = channelStates;
  }

  const windowEnergies = new Float64Array(blockSize);
  let queueIndex = 0;
  let queueFill = 0;
  let runningWindowEnergy = 0;
  let totalWeightedEnergy = 0;
  const blockEnergies = [];
  let nextBlockStart = 0;

  for (let i = 0; i < frames; i += 1) {
    let frameWeightedEnergy = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const weight = channelWeights[channel];
      if (weight === 0) {
        continue;
      }

      let y = channelData[channel][i];
      const channelStates = states[channel];
      for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
        const coeffs = filterStages[stageIndex];
        const state = channelStates[stageIndex];
        const x = y;
        y = coeffs.b0 * x + state.z1;
        state.z1 = coeffs.b1 * x - coeffs.a1 * y + state.z2;
        state.z2 = coeffs.b2 * x - coeffs.a2 * y;
      }

      frameWeightedEnergy += weight * y * y;
    }

    totalWeightedEnergy += frameWeightedEnergy;

    if (queueFill < blockSize) {
      windowEnergies[queueIndex] = frameWeightedEnergy;
      runningWindowEnergy += frameWeightedEnergy;
      queueFill += 1;
      queueIndex = (queueIndex + 1) % blockSize;
    } else {
      const evictedEnergy = windowEnergies[queueIndex];
      windowEnergies[queueIndex] = frameWeightedEnergy;
      runningWindowEnergy += frameWeightedEnergy - evictedEnergy;
      queueIndex = (queueIndex + 1) % blockSize;
    }

    if (queueFill === blockSize) {
      const blockStart = i - blockSize + 1;
      if (blockStart === nextBlockStart) {
        blockEnergies.push(runningWindowEnergy / blockSize);
        nextBlockStart += hopSize;
      }
    }
  }

  if (blockEnergies.length === 0) {
    blockEnergies.push(totalWeightedEnergy / frames);
  }

  const absoluteGatedEnergies = [];
  let absoluteGatedEnergySum = 0;
  for (const blockEnergy of blockEnergies) {
    if (blockEnergy >= absoluteGateEnergy) {
      absoluteGatedEnergies.push(blockEnergy);
      absoluteGatedEnergySum += blockEnergy;
    }
  }

  if (absoluteGatedEnergies.length === 0) {
    return -Infinity;
  }

  const absoluteGatedMeanEnergy = absoluteGatedEnergySum / absoluteGatedEnergies.length;
  const relativeGateEnergy = absoluteGatedMeanEnergy / 10;

  let integratedEnergySum = 0;
  let integratedCount = 0;
  for (const blockEnergy of absoluteGatedEnergies) {
    if (blockEnergy >= relativeGateEnergy) {
      integratedEnergySum += blockEnergy;
      integratedCount += 1;
    }
  }

  if (!integratedCount) {
    return -Infinity;
  }

  const integratedEnergy = integratedEnergySum / integratedCount;
  if (!(integratedEnergy > 0)) {
    return -Infinity;
  }

  return -0.691 + 10 * Math.log10(integratedEnergy);
}

describe("audio measurement refactor", () => {
  test("decodeAudioData uses the original ArrayBuffer", () => {
    expect(audioEngineSource).toContain("decodeAudioData(encoded)");
    expect(audioEngineSource).not.toContain("decodeAudioData(encoded.slice(0))");
  });

  test("generic gated loudness keeps DSP math identical for all modes", () => {
    const api = loadMeasurementApi();
    const audioBuffer = createStereoFixture();
    const sampleRate = audioBuffer.sampleRate;

    const cases = [
      {
        measure: api.measureFlatRms,
        filterStages: [],
      },
      {
        measure: api.measureKWeightedLufs,
        filterStages: [
          api.designBiquad({
            type: "highshelf",
            frequency: 1500,
            gainDb: 4,
            q: 0.70710678,
            sampleRate,
          }),
          api.designBiquad({
            type: "highpass",
            frequency: 38,
            q: 0.5,
            sampleRate,
          }),
        ],
      },
      {
        measure: api.measureBandpassRms,
        filterStages: [
          api.designBiquad({
            type: "highpass",
            frequency: 2000,
            q: 0.7071,
            sampleRate,
          }),
          api.designBiquad({
            type: "lowpass",
            frequency: 10000,
            q: 0.7071,
            sampleRate,
          }),
        ],
      },
      {
        measure: api.measureEarSensitivityRms,
        filterStages: [
          api.designBiquad({
            type: "highpass",
            frequency: 1000,
            q: 0.7071,
            sampleRate,
          }),
          api.designBiquad({
            type: "lowpass",
            frequency: 4000,
            q: 0.7071,
            sampleRate,
          }),
        ],
      },
    ];

    for (const { measure, filterStages } of cases) {
      const expected = measureReferenceGatedLoudness(
        audioBuffer,
        filterStages,
        api.getBs1770ChannelWeight,
      );
      const actual = measure(audioBuffer);
      expect(actual).toBeCloseTo(expected, 12);
    }
  });

  test("generic function handles zero filter stages", () => {
    const api = loadMeasurementApi();
    const audioBuffer = createStereoFixture();
    const expected = measureReferenceGatedLoudness(audioBuffer, [], api.getBs1770ChannelWeight);
    const actual = api.measureGatedLoudness(audioBuffer, []);

    expect(actual).toBeCloseTo(expected, 12);
  });
});
