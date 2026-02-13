function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const MIN_LOOP_SECONDS = 1;
const LOOP_EPSILON = 1e-6;

function dbToLinear(db) {
  return 10 ** (db / 20);
}

function designBiquad({ type, frequency, q = 0.70710678, gainDb = 0, sampleRate }) {
  const safeQ = Math.max(1e-6, q);
  const nyquist = sampleRate / 2;
  const safeFrequency = clamp(frequency, 10, nyquist - 10);
  const w0 = (2 * Math.PI * safeFrequency) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * safeQ);

  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;

  if (type === "peaking") {
    const a = 10 ** (gainDb / 40);
    b0 = 1 + alpha * a;
    b1 = -2 * cosW0;
    b2 = 1 - alpha * a;
    a0 = 1 + alpha / a;
    a1 = -2 * cosW0;
    a2 = 1 - alpha / a;
  } else if (type === "lowshelf") {
    const a = 10 ** (gainDb / 40);
    const sqrtA = Math.sqrt(a);
    b0 = a * ((a + 1) - (a - 1) * cosW0 + 2 * sqrtA * alpha);
    b1 = 2 * a * ((a - 1) - (a + 1) * cosW0);
    b2 = a * ((a + 1) - (a - 1) * cosW0 - 2 * sqrtA * alpha);
    a0 = (a + 1) + (a - 1) * cosW0 + 2 * sqrtA * alpha;
    a1 = -2 * ((a - 1) + (a + 1) * cosW0);
    a2 = (a + 1) + (a - 1) * cosW0 - 2 * sqrtA * alpha;
  } else if (type === "highshelf") {
    const a = 10 ** (gainDb / 40);
    const sqrtA = Math.sqrt(a);
    b0 = a * ((a + 1) + (a - 1) * cosW0 + 2 * sqrtA * alpha);
    b1 = -2 * a * ((a - 1) + (a + 1) * cosW0);
    b2 = a * ((a + 1) + (a - 1) * cosW0 - 2 * sqrtA * alpha);
    a0 = (a + 1) - (a - 1) * cosW0 + 2 * sqrtA * alpha;
    a1 = 2 * ((a - 1) - (a + 1) * cosW0);
    a2 = (a + 1) - (a - 1) * cosW0 - 2 * sqrtA * alpha;
  } else if (type === "highpass") {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else {
    throw new Error(`Unsupported filter type: ${type}`);
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function applyBiquadInPlace(samples, coeffs) {
  let z1 = 0;
  let z2 = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = coeffs.b0 * x + z1;
    z1 = coeffs.b1 * x - coeffs.a1 * y + z2;
    z2 = coeffs.b2 * x - coeffs.a2 * y;
    samples[i] = y;
  }
}

function measureKWeightedLufs(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  if (!frames) {
    return -Infinity;
  }

  const stageOne = designBiquad({
    type: "highshelf",
    frequency: 1500,
    gainDb: 4,
    q: 0.70710678,
    sampleRate,
  });
  const stageTwo = designBiquad({
    type: "highpass",
    frequency: 38,
    q: 0.5,
    sampleRate,
  });

  let totalWeightedEnergy = 0;

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);

    let s1z1 = 0;
    let s1z2 = 0;
    let s2z1 = 0;
    let s2z2 = 0;
    let channelEnergy = 0;

    for (let i = 0; i < data.length; i += 1) {
      const x = data[i];
      const y1 = stageOne.b0 * x + s1z1;
      s1z1 = stageOne.b1 * x - stageOne.a1 * y1 + s1z2;
      s1z2 = stageOne.b2 * x - stageOne.a2 * y1;

      const y2 = stageTwo.b0 * y1 + s2z1;
      s2z1 = stageTwo.b1 * y1 - stageTwo.a1 * y2 + s2z2;
      s2z2 = stageTwo.b2 * y1 - stageTwo.a2 * y2;

      channelEnergy += y2 * y2;
    }

    totalWeightedEnergy += channelEnergy;
  }

  const meanSquare = totalWeightedEnergy / frames;
  return -0.691 + 10 * Math.log10(meanSquare + 1e-20);
}

function applyGainToBuffer(audioBuffer, gainLinear) {
  if (gainLinear === 1) {
    return;
  }

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] *= gainLinear;
    }
  }
}

function cloneAudioBuffer(audioContext, sourceBuffer) {
  const clone = audioContext.createBuffer(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate,
  );

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
    clone.copyToChannel(sourceBuffer.getChannelData(channel), channel);
  }

  return clone;
}

async function mapWithConcurrency(items, limit, worker) {
  const cappedLimit = Math.max(1, Math.min(limit, items.length || 1));
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: cappedLimit }, () => runWorker()));
  return results;
}

async function renderPresetWithOfflineContext(sourceBuffer, preset) {
  const OfflineAudioContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineAudioContextCtor) {
    return null;
  }

  const offline = new OfflineAudioContextCtor(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate,
  );

  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;

  let tailNode = source;
  const preampLinear = dbToLinear(preset.preampDb ?? 0);
  if (preampLinear !== 1) {
    const preampNode = offline.createGain();
    preampNode.gain.value = preampLinear;
    tailNode.connect(preampNode);
    tailNode = preampNode;
  }

  if (Array.isArray(preset.filters)) {
    for (const filter of preset.filters) {
      const biquad = offline.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.value = filter.frequency;
      biquad.Q.value = filter.q;
      biquad.gain.value = filter.gainDb;
      tailNode.connect(biquad);
      tailNode = biquad;
    }
  }

  tailNode.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

function renderPresetWithInPlaceFilters(audioContext, sourceBuffer, preset) {
  const buffer = cloneAudioBuffer(audioContext, sourceBuffer);
  const preampLinear = dbToLinear(preset.preampDb ?? 0);
  applyGainToBuffer(buffer, preampLinear);

  if (Array.isArray(preset.filters)) {
    for (const filter of preset.filters) {
      const coeffs = designBiquad({
        type: filter.type,
        frequency: filter.frequency,
        q: filter.q,
        gainDb: filter.gainDb,
        sampleRate: sourceBuffer.sampleRate,
      });

      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        applyBiquadInPlace(buffer.getChannelData(channel), coeffs);
      }
    }
  }

  return buffer;
}

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.context = null;
    this.masterGain = null;
    this.volume = 1;

    this.variants = [];
    this.variantMap = new Map();

    this.currentNodes = [];
    this.activeVariantId = null;
    this.isPlaying = false;
    this.playbackOffset = 0;
    this.sessionStartOffset = 0;
    this.startedAtContextTime = 0;
    this.duration = 0;
    this.playbackSessionId = 0;

    this.loop = {
      enabled: false,
      startTime: 0,
      endTime: 0,
    };
    this.sessionLoop = {
      enabled: false,
      startTime: 0,
      endTime: 0,
    };
  }

  async ensureContext() {
    if (this.context) {
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      return this.context;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio API is not available in this browser.");
    }

    this.context = new AudioContextCtor();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.context.destination);

    return this.context;
  }

  getState() {
    return {
      isPlaying: this.isPlaying,
      currentTime: this.getCurrentTime(),
      duration: this.duration,
      activeVariantId: this.activeVariantId,
      volume: this.volume,
      loop: this.getLoopState(),
    };
  }

  emitState() {
    this.dispatchEvent(new CustomEvent("state", { detail: this.getState() }));
  }

  async prepareTrack({ trackUrl, presets, onProgress }) {
    const context = await this.ensureContext();

    if (!Array.isArray(presets) || presets.length === 0) {
      throw new Error("Select at least one preset.");
    }

    const totalSteps = presets.length + 2;
    onProgress?.({ done: 0, total: totalSteps, message: "Downloading track..." });
    const response = await fetch(trackUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch track: ${response.status} ${response.statusText}`);
    }

    const encoded = await response.arrayBuffer();
    onProgress?.({ done: 1, total: totalSteps, message: "Decoding track..." });

    const sourceBuffer = await context.decodeAudioData(encoded.slice(0));
    onProgress?.({ done: 2, total: totalSteps, message: "Rendering presets..." });

    let completed = 0;
    const rendered = await mapWithConcurrency(presets, 3, async (preset) => {
      const renderedBuffer = await renderPresetWithOfflineContext(sourceBuffer, preset)
        ?? renderPresetWithInPlaceFilters(context, sourceBuffer, preset);

      const lufs = measureKWeightedLufs(renderedBuffer);
      completed += 1;
      onProgress?.({
        done: 2 + completed,
        total: totalSteps,
        message: `Rendered ${completed}/${presets.length}: ${preset.name}`,
      });

      return {
        id: preset.id,
        name: preset.name,
        buffer: renderedBuffer,
        lufs,
      };
    });

    const targetLufs = Math.min(...rendered.map((variant) => variant.lufs));
    for (const variant of rendered) {
      const normalizationDb = targetLufs - variant.lufs;
      applyGainToBuffer(variant.buffer, dbToLinear(normalizationDb));
      variant.normalizationDb = normalizationDb;
    }

    onProgress?.({
      done: totalSteps,
      total: totalSteps,
      message: "Done.",
    });

    return {
      duration: sourceBuffer.duration,
      sampleRate: sourceBuffer.sampleRate,
      variants: rendered,
    };
  }

  setVariants(variants) {
    this.stop();
    this.variants = variants;
    this.variantMap = new Map(variants.map((variant) => [variant.id, variant]));
    this.activeVariantId = variants[0]?.id ?? null;
    this.duration = variants[0]?.buffer.duration ?? 0;
    this.playbackOffset = 0;
    this.sessionStartOffset = 0;
    this.loop.enabled = false;
    this.loop.startTime = 0;
    this.loop.endTime = 0;
    this.sessionLoop.enabled = false;
    this.sessionLoop.startTime = 0;
    this.sessionLoop.endTime = 0;
    this.emitState();
  }

  getLoopState() {
    return {
      enabled: this.loop.enabled,
      startTime: this.loop.startTime,
      endTime: this.loop.endTime,
    };
  }

  getMinimumLoopLength(duration = this.duration || 0) {
    if (!(duration > 0)) {
      return 0;
    }
    return Math.min(MIN_LOOP_SECONDS, duration);
  }

  normalizeLoopRegion(startTime, endTime) {
    const duration = this.duration || 0;
    if (!(duration > 0)) {
      return {
        startTime: 0,
        endTime: 0,
        isValid: false,
      };
    }

    let safeStart = Number.isFinite(startTime) ? startTime : 0;
    let safeEnd = Number.isFinite(endTime) ? endTime : duration;

    if (safeStart > safeEnd) {
      [safeStart, safeEnd] = [safeEnd, safeStart];
    }

    safeStart = clamp(safeStart, 0, duration);
    safeEnd = clamp(safeEnd, 0, duration);

    const minimumLength = this.getMinimumLoopLength(duration);
    if (minimumLength > LOOP_EPSILON && (safeEnd - safeStart) < minimumLength) {
      if (safeStart + minimumLength <= duration) {
        safeEnd = safeStart + minimumLength;
      } else {
        safeEnd = duration;
        safeStart = Math.max(0, duration - minimumLength);
      }
    }

    return {
      startTime: safeStart,
      endTime: safeEnd,
      isValid: (safeEnd - safeStart) > LOOP_EPSILON,
    };
  }

  getEffectiveLoopForOffset(offset) {
    const normalized = this.normalizeLoopRegion(this.loop.startTime, this.loop.endTime);
    if (!this.loop.enabled || !normalized.isValid) {
      return {
        enabled: false,
        startTime: normalized.startTime,
        endTime: normalized.endTime,
      };
    }

    if (offset >= normalized.endTime - LOOP_EPSILON) {
      return {
        enabled: false,
        startTime: normalized.startTime,
        endTime: normalized.endTime,
      };
    }

    return {
      enabled: true,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
    };
  }

  applyLoopToCurrentNodes(loopConfig) {
    for (const node of this.currentNodes) {
      node.source.loop = Boolean(loopConfig.enabled);
      if (loopConfig.enabled) {
        node.source.loopStart = loopConfig.startTime;
        node.source.loopEnd = loopConfig.endTime;
      }
    }
  }

  rebasePlaybackClock(currentTime) {
    if (!this.context) {
      return;
    }
    const clamped = clamp(currentTime, 0, this.duration || 0);
    this.playbackOffset = clamped;
    this.sessionStartOffset = clamped;
    this.startedAtContextTime = this.context.currentTime;
  }

  setLoopRegion(startTime, endTime) {
    const normalized = this.normalizeLoopRegion(startTime, endTime);
    this.loop.startTime = normalized.startTime;
    this.loop.endTime = normalized.endTime;

    if (this.isPlaying && this.context && this.currentNodes.length > 0 && this.loop.enabled) {
      const currentTime = this.getCurrentTime();
      this.rebasePlaybackClock(currentTime);
      this.sessionLoop = this.getEffectiveLoopForOffset(this.sessionStartOffset);
      this.applyLoopToCurrentNodes(this.sessionLoop);
    }

    this.emitState();
  }

  setLoopEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (this.loop.enabled === nextEnabled) {
      return;
    }

    this.loop.enabled = nextEnabled;

    if (this.loop.enabled) {
      const normalized = this.normalizeLoopRegion(this.loop.startTime, this.loop.endTime);
      if (normalized.isValid) {
        this.loop.startTime = normalized.startTime;
        this.loop.endTime = normalized.endTime;
      } else if (this.duration > 0) {
        this.loop.startTime = 0;
        this.loop.endTime = this.duration;
      }
    }

    if (this.isPlaying && this.context && this.currentNodes.length > 0) {
      const currentTime = this.getCurrentTime();
      this.rebasePlaybackClock(currentTime);
      this.sessionLoop = this.getEffectiveLoopForOffset(this.sessionStartOffset);
      this.applyLoopToCurrentNodes(this.sessionLoop);
    }

    this.emitState();
  }

  setActiveVariant(variantId) {
    if (!this.variantMap.has(variantId)) {
      return;
    }

    this.activeVariantId = variantId;
    const now = this.context?.currentTime ?? 0;
    const fadeTime = 0.005;

    for (const node of this.currentNodes) {
      const isActive = node.id === variantId;
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now);
      node.gain.gain.linearRampToValueAtTime(isActive ? 1 : 0, now + fadeTime);
    }

    this.emitState();
  }

  play() {
    if (!this.context || this.isPlaying || this.variants.length === 0) {
      return;
    }

    this.startSources(this.playbackOffset);
    this.isPlaying = true;
    this.emitState();
  }

  pause() {
    if (!this.isPlaying) {
      return;
    }

    this.playbackOffset = this.getCurrentTime();
    this.isPlaying = false;
    this.stopSources();
    this.emitState();
  }

  stop() {
    this.isPlaying = false;
    this.playbackOffset = 0;
    this.stopSources();
    this.emitState();
  }

  seek(seconds) {
    const target = clamp(seconds, 0, this.duration || 0);

    if (this.isPlaying) {
      this.stopSources();
      this.playbackOffset = target;
      this.startSources(target);
    } else {
      this.playbackOffset = target;
    }

    this.emitState();
  }

  skip(seconds) {
    this.seek(this.getCurrentTime() + seconds);
  }

  restart() {
    this.seek(0);
  }

  setVolume(volume) {
    this.volume = clamp(volume, 0, 1);
    if (this.masterGain && this.context) {
      this.masterGain.gain.setValueAtTime(this.volume, this.context.currentTime);
    }
    this.emitState();
  }

  getCurrentTime() {
    if (!this.isPlaying || !this.context) {
      return clamp(this.playbackOffset, 0, this.duration || 0);
    }

    const now = this.context.currentTime;
    const elapsed = Math.max(0, now - this.startedAtContextTime);

    if (!this.sessionLoop.enabled) {
      return clamp(this.sessionStartOffset + elapsed, 0, this.duration || 0);
    }

    const loopLength = this.sessionLoop.endTime - this.sessionLoop.startTime;
    if (loopLength <= LOOP_EPSILON) {
      return clamp(this.sessionStartOffset + elapsed, 0, this.duration || 0);
    }

    const firstPassDuration = Math.max(0, this.sessionLoop.endTime - this.sessionStartOffset);
    if (elapsed <= firstPassDuration) {
      return clamp(this.sessionStartOffset + elapsed, 0, this.duration || 0);
    }

    const loopElapsed = elapsed - firstPassDuration;
    return clamp(this.sessionLoop.startTime + (loopElapsed % loopLength), 0, this.duration || 0);
  }

  startSources(offset) {
    this.stopSources();
    const sessionId = this.playbackSessionId + 1;
    this.playbackSessionId = sessionId;

    const safeOffset = clamp(offset, 0, this.duration || 0);
    this.playbackOffset = safeOffset;
    this.sessionStartOffset = safeOffset;
    this.sessionLoop = this.getEffectiveLoopForOffset(safeOffset);

    const when = this.context.currentTime + 0.01;
    this.startedAtContextTime = when;

    for (const variant of this.variants) {
      const source = this.context.createBufferSource();
      source.buffer = variant.buffer;
      if (this.sessionLoop.enabled) {
        source.loop = true;
        source.loopStart = this.sessionLoop.startTime;
        source.loopEnd = this.sessionLoop.endTime;
      }

      const gain = this.context.createGain();
      const isActive = variant.id === this.activeVariantId;
      gain.gain.setValueAtTime(isActive ? 1 : 0, when);

      source.connect(gain);
      gain.connect(this.masterGain);
      source.start(when, safeOffset);

      this.currentNodes.push({
        id: variant.id,
        source,
        gain,
      });
    }

    if (this.currentNodes.length > 0) {
      const probe = this.currentNodes[0].source;
      probe.onended = () => {
        if (sessionId !== this.playbackSessionId || !this.isPlaying) {
          return;
        }

        if (this.sessionLoop.enabled) {
          return;
        }

        const current = this.getCurrentTime();
        if (current >= (this.duration || 0) - 0.02) {
          this.isPlaying = false;
          this.playbackOffset = this.duration;
          this.sessionStartOffset = this.duration;
          this.stopSources();
          this.emitState();
        }
      };
    }
  }

  stopSources() {
    this.playbackSessionId += 1;

    for (const node of this.currentNodes) {
      try {
        node.source.stop();
      } catch {
        // node might already be stopped
      }

      node.source.onended = null;
      node.source.disconnect();
      node.gain.disconnect();
    }

    this.currentNodes = [];
    this.sessionLoop = {
      enabled: false,
      startTime: 0,
      endTime: 0,
    };
  }
}
