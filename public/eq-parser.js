const PREAMP_RE = /^\s*Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB\s*$/i;
const FILTER_RE = /^\s*Filter\s+(\d+):\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+([+-]?\d+(?:\.\d+)?)\s*Hz\s+Gain\s+([+-]?\d+(?:\.\d+)?)\s*dB\s+Q\s+([+-]?\d+(?:\.\d+)?)\s*$/i;

const FILTER_TYPE_MAP = {
  PK: "peaking",
  PEQ: "peaking",
  LSC: "lowshelf",
  HSC: "highshelf",
};

export function parseEqualizerApo(text, sourceName = "preset") {
  const lines = text.split(/\r?\n/);
  const filters = [];
  let preampDb = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
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
      const filterIndex = Number(filterMatch[1]);
      const enabled = filterMatch[2].toUpperCase() === "ON";
      const rawType = filterMatch[3].toUpperCase();
      const frequency = Number(filterMatch[4]);
      const gainDb = Number(filterMatch[5]);
      const q = Number(filterMatch[6]);

      if (!enabled) {
        continue;
      }

      const type = FILTER_TYPE_MAP[rawType];
      if (!type) {
        throw new Error(`${sourceName}: unsupported filter type '${rawType}' on line ${index + 1}`);
      }

      if (!Number.isFinite(filterIndex) || !Number.isFinite(frequency) || !Number.isFinite(gainDb) || !Number.isFinite(q) || frequency <= 0 || q <= 0) {
        throw new Error(`${sourceName}: invalid filter values on line ${index + 1}`);
      }

      filters.push({
        index: filterIndex,
        type,
        frequency,
        gainDb,
        q,
      });
      continue;
    }

    if (/^\s*Filter\s+/i.test(line) || /^\s*Preamp:/i.test(line)) {
      throw new Error(`${sourceName}: failed to parse line ${index + 1}: ${rawLine}`);
    }
  }

  return {
    preampDb,
    filters,
  };
}
