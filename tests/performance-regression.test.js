import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const serverSource = readFileSync(join(import.meta.dir, "..", "server.ts"), "utf8");

describe("performance regression checks", () => {
  test("round-complete interstitial delay remains short", () => {
    expect(appSource).toContain("const ROUND_COMPLETE_MS = 600;");
  });

  test("Bradley-Terry standings skip unused confidence bootstrap", () => {
    expect(appSource).toContain("confidenceSamples: 0,");
  });

  test("playback render loop is state-driven instead of always running", () => {
    expect(appSource).toContain("let playbackRafId = null;");
    expect(appSource).toContain("if (audio.isPlaying && playbackRafId === null) {");
    expect(appSource).toContain("if (!audio.isPlaying) {");

    const initFunction = appSource.match(/async function init\(\) \{[\s\S]*?\n\}\n\ninit\(\);/)?.[0] ?? "";
    expect(initFunction).not.toContain("startRenderLoop(");
  });

  test("store persistence is debounced", () => {
    expect(appSource).toContain("let saveStoreTimer = null;");
    expect(appSource).toContain("saveStoreTimer = setTimeout(() => {");
    expect(appSource).toContain("}, 300);");
  });

  test("server preset loading reads files in parallel", () => {
    expect(serverSource).toContain("const presets = await Promise.all(");
    expect(serverSource).toContain("files.map(async (filename) => {");
  });
});
