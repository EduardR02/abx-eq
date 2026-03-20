import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  browseForDirectory,
  buildBrowseDialogCommands,
  DEFAULT_DIRECTORY_CONFIG,
  safePublicPath,
  startServer,
  toProjectRelativePath,
  updateDirectoryConfig,
} from "../server.ts";

describe("safePublicPath", () => {
  test("resolves in-public files", () => {
    const publicDir = path.join(process.cwd(), "public");

    expect(safePublicPath("/")).toBe(path.join(publicDir, "index.html"));
    expect(safePublicPath("/style.css")).toBe(path.join(publicDir, "style.css"));
  });

  test("blocks path traversal into sibling directories", () => {
    expect(safePublicPath("/../public-evil/index.html")).toBeNull();
  });

  test("blocks direct traversal outside public", () => {
    expect(safePublicPath("/../../server.ts")).toBeNull();
  });
});

describe("folder browse helpers", () => {
  test("toProjectRelativePath converts absolute paths to project-relative", () => {
    const absolutePath = path.join(process.cwd(), "music", "demo");
    expect(toProjectRelativePath(absolutePath)).toBe("music/demo");
  });

  test("toProjectRelativePath returns dot for project root", () => {
    expect(toProjectRelativePath(process.cwd())).toBe(".");
  });

  test("buildBrowseDialogCommands returns platform-specific command list", () => {
    expect(buildBrowseDialogCommands("win32").map((spec) => spec.args[0])).toEqual(["pwsh", "powershell"]);
    expect(buildBrowseDialogCommands("darwin")[0].args[0]).toBe("osascript");
    expect(buildBrowseDialogCommands("linux").map((spec) => spec.args[0])).toEqual(["zenity", "kdialog"]);
  });

  test("browseForDirectory returns selected path when dialog succeeds", async () => {
    const result = await browseForDirectory({
      platform: "win32",
      runCommand: async () => ({
        exitCode: 0,
        stdout: path.join(process.cwd(), "music"),
        stderr: "",
      }),
    });

    expect(result).toEqual({ path: "music" });
  });

  test("browseForDirectory returns cancelled on user cancellation", async () => {
    const result = await browseForDirectory({
      platform: "win32",
      runCommand: async () => ({
        exitCode: 2,
        stdout: "",
        stderr: "",
      }),
    });

    expect(result).toEqual({ cancelled: true });
  });

  test("browseForDirectory falls back to kdialog on linux", async () => {
    const calledCommands: string[] = [];

    const result = await browseForDirectory({
      platform: "linux",
      runCommand: async (args) => {
        calledCommands.push(args[0]);
        if (args[0] === "zenity") {
          throw new Error("zenity not found");
        }

        return {
          exitCode: 0,
          stdout: path.join(process.cwd(), "presets_for_shootout"),
          stderr: "",
        };
      },
    });

    expect(calledCommands).toEqual(["zenity", "kdialog"]);
    expect(result).toEqual({ path: "presets_for_shootout" });
  });

  test("browseForDirectory falls back to powershell on windows", async () => {
    const calledCommands: string[] = [];

    const result = await browseForDirectory({
      platform: "win32",
      runCommand: async (args) => {
        calledCommands.push(args[0]);
        if (args[0] === "pwsh") {
          throw new Error("pwsh not found");
        }

        return {
          exitCode: 0,
          stdout: path.join(process.cwd(), "music"),
          stderr: "",
        };
      },
    });

    expect(calledCommands).toEqual(["pwsh", "powershell"]);
    expect(result).toEqual({ path: "music" });
  });
});

describe("directory config API", () => {
  beforeEach(async () => {
    await updateDirectoryConfig(DEFAULT_DIRECTORY_CONFIG);
  });

  afterEach(async () => {
    await updateDirectoryConfig(DEFAULT_DIRECTORY_CONFIG);
  });

  test("GET /api/config returns current runtime config", async () => {
    const server = startServer(0);
    try {
      const response = await fetch(`http://localhost:${server.port}/api/config`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(DEFAULT_DIRECTORY_CONFIG);
    } finally {
      server.stop(true);
    }
  });

  test("POST /api/config rejects invalid directories", async () => {
    const server = startServer(0);
    try {
      const response = await fetch(`http://localhost:${server.port}/api/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          musicDir: "tests/does-not-exist/music",
          presetsDir: "tests/does-not-exist/presets",
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Directory does not exist");
    } finally {
      server.stop(true);
    }
  });

  test("POST /api/config updates presets and tracks sources", async () => {
    const tempRoot = await mkdtemp(path.join(process.cwd(), "tests", "tmp-config-"));
    const musicDir = path.join(tempRoot, "music-files");
    const presetsDir = path.join(tempRoot, "preset-files");
    await mkdir(musicDir, { recursive: true });
    await mkdir(presetsDir, { recursive: true });

    await writeFile(path.join(musicDir, "sample.wav"), "");
    await writeFile(
      path.join(presetsDir, "custom.txt"),
      "Preamp: 0 dB\nFilter 1: ON PK Fc 1000 Hz Gain 1.0 dB Q 1.0\nChannel: L\nPreamp: -1.5 dB\nFilter 1: ON PK Fc 3200 Hz Gain 1.5 dB Q 3.0\n",
    );

    const musicRel = path.relative(process.cwd(), musicDir).replace(/\\/g, "/");
    const presetsRel = path.relative(process.cwd(), presetsDir).replace(/\\/g, "/");

    const server = startServer(0);

    try {
      const configResponse = await fetch(`http://localhost:${server.port}/api/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ musicDir: musicRel, presetsDir: presetsRel }),
      });

      expect(configResponse.status).toBe(200);
      expect(await configResponse.json()).toEqual({
        musicDir: musicRel,
        presetsDir: presetsRel,
      });

      const tracksResponse = await fetch(`http://localhost:${server.port}/api/tracks`);
      expect(tracksResponse.status).toBe(200);
      expect(await tracksResponse.json()).toEqual(["sample.wav"]);

      const presetsResponse = await fetch(`http://localhost:${server.port}/api/presets`);
      expect(presetsResponse.status).toBe(200);
      const presets = await presetsResponse.json();
      expect(presets).toHaveLength(1);
      expect(presets[0].filename).toBe("custom.txt");
      expect(presets[0].name).toBe("custom");
      expect(presets[0].leftPreampDb).toBe(-1.5);
      expect(presets[0].leftFilters).toHaveLength(1);
      expect(presets[0].rightPreampDb).toBe(0);
      expect(presets[0].rightFilters).toEqual([]);
    } finally {
      server.stop(true);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("POST /api/browse proxies folder picker result", async () => {
    const server = startServer(0, {
      browseDirectory: async () => ({ path: "music" }),
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/api/browse`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ path: "music" });
    } finally {
      server.stop(true);
    }
  });

  test("POST /api/browse returns cancelled payload", async () => {
    const server = startServer(0, {
      browseDirectory: async () => ({ cancelled: true }),
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/api/browse`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ cancelled: true });
    } finally {
      server.stop(true);
    }
  });

  test("GET /api/browse returns method not allowed", async () => {
    const server = startServer(0, {
      browseDirectory: async () => ({ path: "music" }),
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/api/browse`);

      expect(response.status).toBe(405);
      expect(await response.json()).toEqual({ error: "Method not allowed." });
    } finally {
      server.stop(true);
    }
  });
});
