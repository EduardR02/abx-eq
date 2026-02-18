import { parseEqualizerApo } from "./eq-parser.js";

function getErrorMessage(body, fallbackMessage) {
  if (body && typeof body === "object" && typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }
  return fallbackMessage;
}

async function fetchJson(url, options = {}, fallbackMessage) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getErrorMessage(body, fallbackMessage));
  }
  return body;
}

function toPresetName(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function normalizeExtension(name) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return name.slice(dotIndex).toLowerCase();
}

export class ServerSource {
  supportsDirectoryConfig = true;

  async listPresets() {
    const presets = await fetchJson("/api/presets", {}, "Failed to load presets.");
    return Array.isArray(presets) ? presets : [];
  }

  async listTracks() {
    const tracks = await fetchJson("/api/tracks", {}, "Failed to load tracks.");
    return Array.isArray(tracks) ? tracks : [];
  }

  getTrackUrl(filename) {
    return `/music/${encodeURIComponent(filename)}`;
  }

  async loadTrackArrayBuffer(filename) {
    const response = await fetch(this.getTrackUrl(filename));
    if (!response.ok) {
      throw new Error(`Failed to fetch track: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  async getConfig() {
    return fetchJson("/api/config", {}, "Failed to load directory config.");
  }

  async setConfig(config) {
    return fetchJson(
      "/api/config",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(config),
      },
      "Failed to apply directory config.",
    );
  }

  async browse() {
    const body = await fetchJson(
      "/api/browse",
      { method: "POST" },
      "Failed to open folder picker.",
    );

    if (body?.cancelled) {
      return null;
    }

    if (typeof body?.path !== "string" || !body.path.trim()) {
      throw new Error("Folder picker returned an invalid path.");
    }

    return body.path;
  }
}

export class LocalSource {
  supportsDirectoryConfig = false;

  constructor() {
    this.trackFiles = new Map();
    this.trackObjectUrls = new Map();
    this.presetFiles = new Map();
    this.presets = new Map();
  }

  async addFiles(fileList) {
    if (!fileList) {
      return;
    }

    const files = Array.from(fileList);

    await Promise.all(files.map(async (file) => {
      const extension = normalizeExtension(file.name);

      if (extension === ".wav") {
        this.trackFiles.set(file.name, file);
        const previousUrl = this.trackObjectUrls.get(file.name);
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
          this.trackObjectUrls.delete(file.name);
        }
        return;
      }

      if (extension === ".txt") {
        const text = await file.text();
        const parsed = parseEqualizerApo(text, file.name);
        this.presetFiles.set(file.name, file);
        this.presets.set(file.name, {
          id: file.name,
          name: toPresetName(file.name),
          filename: file.name,
          preampDb: parsed.preampDb,
          filters: parsed.filters,
        });
      }
    }));
  }

  async listPresets() {
    return [...this.presets.values()].sort((a, b) => a.filename.localeCompare(b.filename));
  }

  async listTracks() {
    return [...this.trackFiles.keys()].sort((a, b) => a.localeCompare(b));
  }

  getTrackUrl(filename) {
    const file = this.trackFiles.get(filename);
    if (!file) {
      throw new Error(`Track not found: ${filename}`);
    }

    const existing = this.trackObjectUrls.get(filename);
    if (existing) {
      return existing;
    }

    const nextUrl = URL.createObjectURL(file);
    this.trackObjectUrls.set(filename, nextUrl);
    return nextUrl;
  }

  async loadTrackArrayBuffer(filename) {
    const file = this.trackFiles.get(filename);
    if (!file) {
      throw new Error(`Track not found: ${filename}`);
    }
    return file.arrayBuffer();
  }

  async getConfig() {
    return null;
  }

  async setConfig() {
    throw new Error("Directory configuration is not supported in local mode.");
  }

  async browse() {
    throw new Error("Directory browsing is not supported in local mode.");
  }
}

export async function detectSource({ timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("/api/config", {
      method: "GET",
      signal: controller.signal,
    });

    if (response.ok) {
      return new ServerSource();
    }

    return new LocalSource();
  } catch {
    return new LocalSource();
  } finally {
    clearTimeout(timeoutId);
  }
}
