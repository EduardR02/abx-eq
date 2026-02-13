import { readdir } from "node:fs/promises";
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

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const MUSIC_DIR = path.join(ROOT, "music");
const PRESETS_DIR = path.join(ROOT, "presets_for_shootout");

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

async function listPresets(): Promise<ParsedPreset[]> {
  const entries = await readdir(PRESETS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const presets: ParsedPreset[] = [];

  for (const filename of files) {
    const file = Bun.file(path.join(PRESETS_DIR, filename));
    const text = await file.text();
    presets.push(parsePresetContent(text, filename));
  }

  return presets;
}

async function listTracks(): Promise<string[]> {
  const entries = await readdir(MUSIC_DIR, { withFileTypes: true });
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

  const fullPath = path.resolve(MUSIC_DIR, safeName);
  if (!fullPath.startsWith(MUSIC_DIR)) {
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

function startServer(port: number) {
  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const { pathname } = url;

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
