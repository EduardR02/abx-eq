import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

type EqFilter = {
  index: number;
  type: "peaking" | "lowshelf" | "highshelf";
  frequency: number;
  gainDb: number;
  q: number;
};

type ParsedPreset = {
  name: string;
  filename: string;
  preampDb: number;
  filters: EqFilter[];
};

type DirectoryConfig = {
  musicDir: string;
  presetsDir: string;
};

type BrowseResponse =
  | { path: string }
  | { cancelled: true };

type BrowseCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type BrowseCommandSpec = {
  args: string[];
  isCancelled: (result: BrowseCommandResult) => boolean;
};

type BrowseCommandRunner = (args: string[]) => Promise<BrowseCommandResult>;

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
export const DEFAULT_DIRECTORY_CONFIG: DirectoryConfig = {
  musicDir: "music",
  presetsDir: "presets_for_shootout",
};

let directoryConfig: DirectoryConfig = { ...DEFAULT_DIRECTORY_CONFIG };

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
};

const PREAMP_RE = /^\s*Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB\s*$/i;
const FILTER_RE = /^\s*Filter\s+(\d+):\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+([+-]?\d+(?:\.\d+)?)\s*Hz\s+Gain\s+([+-]?\d+(?:\.\d+)?)\s*dB\s+Q\s+([+-]?\d+(?:\.\d+)?)\s*$/i;

function parsePresetContent(text: string, filename: string): ParsedPreset {
  const lines = text.split(/\r?\n/);
  const filters: EqFilter[] = [];
  let preampDb = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const preampMatch = line.match(PREAMP_RE);
    if (preampMatch) {
      preampDb = Number(preampMatch[1]);
      continue;
    }

    const filterMatch = line.match(FILTER_RE);
    if (filterMatch) {
      const index = Number(filterMatch[1]);
      const enabled = filterMatch[2].toUpperCase() === "ON";
      const rawType = filterMatch[3].toUpperCase();
      const frequency = Number(filterMatch[4]);
      const gainDb = Number(filterMatch[5]);
      const q = Number(filterMatch[6]);

      if (!enabled) {
        continue;
      }

      if (!Number.isFinite(index) || !Number.isFinite(frequency) || !Number.isFinite(gainDb) || !Number.isFinite(q) || q <= 0 || frequency <= 0) {
        throw new Error(`${filename}: invalid numeric values on line ${lineIndex + 1}`);
      }

      const typeMap: Record<string, EqFilter["type"]> = {
        PK: "peaking",
        PEQ: "peaking",
        LSC: "lowshelf",
        HSC: "highshelf",
      };

      const type = typeMap[rawType];
      if (!type) {
        throw new Error(`${filename}: unsupported filter type '${rawType}' on line ${lineIndex + 1}`);
      }

      filters.push({
        index,
        type,
        frequency,
        gainDb,
        q,
      });
      continue;
    }

    if (/^\s*Filter\s+/i.test(line) || /^\s*Preamp:/i.test(line)) {
      throw new Error(`${filename}: failed to parse line ${lineIndex + 1}: ${rawLine}`);
    }
  }

  return {
    name: path.basename(filename, path.extname(filename)),
    filename,
    preampDb,
    filters,
  };
}

function normalizeDirectoryInput(rawValue: unknown, fieldName: string): string {
  if (typeof rawValue !== "string") {
    throw new Error(`'${fieldName}' must be a string.`);
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error(`'${fieldName}' cannot be empty.`);
  }

  if (path.isAbsolute(trimmed)) {
    throw new Error(`'${fieldName}' must be a relative path from the project root.`);
  }

  const normalized = path.normalize(trimmed).replace(/^([/\\])+/, "");
  if (!normalized || normalized === ".") {
    throw new Error(`'${fieldName}' must point to a directory below the project root.`);
  }

  const resolved = path.resolve(ROOT, normalized);
  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`'${fieldName}' must stay inside the project root.`);
  }

  return relative.replace(/\\/g, "/");
}

function normalizeDirectoryConfig(rawConfig: unknown): DirectoryConfig {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const payload = rawConfig as Record<string, unknown>;
  return {
    musicDir: normalizeDirectoryInput(payload.musicDir, "musicDir"),
    presetsDir: normalizeDirectoryInput(payload.presetsDir, "presetsDir"),
  };
}

function resolveFromRoot(relativePath: string): string {
  return path.resolve(ROOT, relativePath);
}

function getResolvedDirectoryPaths(config = directoryConfig): { musicDirPath: string; presetsDirPath: string } {
  return {
    musicDirPath: resolveFromRoot(config.musicDir),
    presetsDirPath: resolveFromRoot(config.presetsDir),
  };
}

async function ensureDirectoryExists(relativePath: string, fieldName: string): Promise<void> {
  const absolutePath = resolveFromRoot(relativePath);
  try {
    await access(absolutePath);
    const directoryStat = await stat(absolutePath);
    if (!directoryStat.isDirectory()) {
      throw new Error(`'${fieldName}' is not a directory: ${relativePath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("'")) {
      throw error;
    }
    throw new Error(`Directory does not exist: ${relativePath}`);
  }
}

export function getDirectoryConfig(): DirectoryConfig {
  return { ...directoryConfig };
}

export async function updateDirectoryConfig(rawConfig: unknown): Promise<DirectoryConfig> {
  const nextConfig = normalizeDirectoryConfig(rawConfig);
  await Promise.all([
    ensureDirectoryExists(nextConfig.musicDir, "musicDir"),
    ensureDirectoryExists(nextConfig.presetsDir, "presetsDir"),
  ]);
  directoryConfig = nextConfig;
  return getDirectoryConfig();
}

export function toProjectRelativePath(rawPath: string): string {
  const firstLine = rawPath.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) {
    throw new Error("Folder picker returned an empty path.");
  }

  const absolutePath = path.isAbsolute(firstLine)
    ? firstLine
    : path.resolve(ROOT, firstLine);
  const relativePath = path.relative(ROOT, absolutePath).replace(/\\/g, "/");
  return relativePath || ".";
}

export function buildBrowseDialogCommands(platform: NodeJS.Platform): BrowseCommandSpec[] {
  if (platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Select folder'",
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "  Write-Output $dialog.SelectedPath",
      "  exit 0",
      "}",
      "exit 2",
    ].join("; ");

    return [
      {
        args: ["pwsh", "-NoProfile", "-STA", "-Command", script],
        isCancelled: (result) => result.exitCode === 2,
      },
      {
        args: ["powershell", "-NoProfile", "-STA", "-Command", script],
        isCancelled: (result) => result.exitCode === 2,
      },
    ];
  }

  if (platform === "darwin") {
    return [{
      args: [
        "osascript",
        "-e",
        "try",
        "-e",
        'POSIX path of (choose folder with prompt "Select folder")',
        "-e",
        "on error number -128",
        "-e",
        "return \"\"",
        "-e",
        "end try",
      ],
      isCancelled: () => false,
    }];
  }

  if (platform === "linux") {
    return [
      {
        args: ["zenity", "--file-selection", "--directory", "--title=Select folder"],
        isCancelled: (result) => result.exitCode === 1,
      },
      {
        args: ["kdialog", "--getexistingdirectory", ".", "Select folder"],
        isCancelled: (result) => result.exitCode === 1,
      },
    ];
  }

  throw new Error(`Folder browsing is not supported on platform '${platform}'.`);
}

async function runBrowseCommand(args: string[]): Promise<BrowseCommandResult> {
  const process = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
}

export async function browseForDirectory(options: {
  platform?: NodeJS.Platform;
  runCommand?: BrowseCommandRunner;
} = {}): Promise<BrowseResponse> {
  const platform = options.platform ?? process.platform;
  const runCommand = options.runCommand ?? runBrowseCommand;
  const commands = buildBrowseDialogCommands(platform);

  let lastFailureMessage = "";

  for (const command of commands) {
    let result: BrowseCommandResult;
    try {
      result = await runCommand(command.args);
    } catch (error) {
      lastFailureMessage = error instanceof Error ? error.message : String(error);
      continue;
    }

    if (result.exitCode === 0) {
      const selectedPath = result.stdout.trim();
      if (!selectedPath) {
        return { cancelled: true };
      }
      return { path: toProjectRelativePath(selectedPath) };
    }

    if (command.isCancelled(result)) {
      return { cancelled: true };
    }

    const stderr = result.stderr.trim();
    lastFailureMessage = stderr || `Command exited with code ${result.exitCode}: ${command.args[0]}`;
  }

  throw new Error(lastFailureMessage || "No supported folder picker command is available.");
}

async function listPresets(): Promise<ParsedPreset[]> {
  const { presetsDirPath } = getResolvedDirectoryPaths();
  const entries = await readdir(presetsDirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const presets: ParsedPreset[] = [];

  for (const filename of files) {
    const file = Bun.file(path.join(presetsDirPath, filename));
    const text = await file.text();
    presets.push(parsePresetContent(text, filename));
  }

  return presets;
}

async function listTracks(): Promise<string[]> {
  const { musicDirPath } = getResolvedDirectoryPaths();
  const entries = await readdir(musicDirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wav"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function jsonError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status });
}

export function safePublicPath(urlPath: string): string | null {
  const requested = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const normalized = path.normalize(requested).replace(/^([/\\])+/, "");
  const resolved = path.resolve(PUBLIC_DIR, normalized);
  const relative = path.relative(PUBLIC_DIR, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

function parseRangeHeader(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (!startRaw && !endRaw) {
    return null;
  }

  let start: number;
  let end: number;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startRaw);
    if (!Number.isFinite(start) || start < 0) {
      return null;
    }

    if (!endRaw) {
      end = size - 1;
    } else {
      end = Number(endRaw);
      if (!Number.isFinite(end)) {
        return null;
      }
    }
  }

  if (start >= size || end < start) {
    return null;
  }

  end = Math.min(end, size - 1);
  return { start, end };
}

async function serveMusicFile(filename: string, request: Request): Promise<Response> {
  const safeName = path.basename(filename);
  if (!safeName.toLowerCase().endsWith(".wav")) {
    return notFound();
  }

  const { musicDirPath } = getResolvedDirectoryPaths();
  const fullPath = path.resolve(musicDirPath, safeName);
  const relative = path.relative(musicDirPath, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return notFound();
  }

  const file = Bun.file(fullPath);
  if (!(await file.exists())) {
    return notFound();
  }

  const size = file.size;
  const contentType = MIME_TYPES[".wav"];
  const rangeHeader = request.headers.get("range");

  if (!rangeHeader) {
    return new Response(file, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
        "Content-Type": contentType,
      },
    });
  }

  const parsedRange = parseRangeHeader(rangeHeader, size);
  if (!parsedRange) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  const { start, end } = parsedRange;
  const chunk = file.slice(start, end + 1);

  return new Response(chunk, {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Type": contentType,
    },
  });
}

async function serveStatic(urlPath: string): Promise<Response> {
  const fullPath = safePublicPath(urlPath);
  if (!fullPath) {
    return notFound();
  }

  const file = Bun.file(fullPath);
  if (!(await file.exists())) {
    return notFound();
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
    },
  });
}

const preferredPort = Number(process.env.PORT ?? "3000");

export function startServer(
  port: number,
  options: {
    browseDirectory?: () => Promise<BrowseResponse>;
  } = {},
) {
  const browseDirectory = options.browseDirectory ?? (() => browseForDirectory());

  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const { pathname } = url;

      if (pathname === "/api/config") {
        if (request.method === "GET") {
          return Response.json(getDirectoryConfig());
        }

        if (request.method === "POST") {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return jsonError("Invalid JSON body.", 400);
          }

          try {
            const config = await updateDirectoryConfig(body);
            return Response.json(config);
          } catch (error) {
            return jsonError((error as Error).message, 400);
          }
        }

        return jsonError("Method not allowed.", 405);
      }

      if (pathname === "/api/browse") {
        if (request.method !== "POST") {
          return jsonError("Method not allowed.", 405);
        }

        try {
          const result = await browseDirectory();
          return Response.json(result);
        } catch (error) {
          return jsonError(`Failed to open folder picker: ${(error as Error).message}`);
        }
      }

      if (pathname === "/api/presets") {
        try {
          const presets = await listPresets();
          return Response.json(presets);
        } catch (error) {
          return jsonError(`Failed to parse presets: ${(error as Error).message}`);
        }
      }

      if (pathname === "/api/tracks") {
        try {
          const tracks = await listTracks();
          return Response.json(tracks);
        } catch (error) {
          return jsonError(`Failed to list tracks: ${(error as Error).message}`);
        }
      }

      if (pathname.startsWith("/music/")) {
        const filename = decodeURIComponent(pathname.slice("/music/".length));
        return serveMusicFile(filename, request);
      }

      return serveStatic(pathname);
    },
  });
}

if (import.meta.main) {
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = startServer(preferredPort);
  } catch {
    server = startServer(0);
  }

  console.log(`ABX EQ app running on http://localhost:${server.port}`);
}
