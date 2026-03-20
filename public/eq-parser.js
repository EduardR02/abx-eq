const PREAMP_RE = /^\s*Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB\s*$/i;
const FILTER_RE = /^\s*Filter\s+(\d+):\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+([+-]?\d+(?:\.\d+)?)\s*Hz\s+Gain\s+([+-]?\d+(?:\.\d+)?)\s*dB\s+Q\s+([+-]?\d+(?:\.\d+)?)\s*$/i;
const CHANNEL_RE = /^\s*Channel:\s*(.*?)\s*$/i;

const FILTER_TYPE_MAP = {
  PK: "peaking",
  PEQ: "peaking",
  LSC: "lowshelf",
  HSC: "highshelf",
};

/**
 * @typedef {object} EqFilter
 * @property {number} index
 * @property {"peaking" | "lowshelf" | "highshelf"} type
 * @property {number} frequency
 * @property {number} gainDb
 * @property {number} q
 */

/**
 * @typedef {object} ParsedEqualizerApo
 * @property {number} preampDb
 * @property {EqFilter[]} filters
 * @property {number} leftPreampDb
 * @property {EqFilter[]} leftFilters
 * @property {number} rightPreampDb
 * @property {EqFilter[]} rightFilters
 */

function getSectionState(parsed, section) {
  if (section === "left") {
    return {
      filters: parsed.leftFilters,
      addPreampDb(value) {
        parsed.leftPreampDb += value;
      },
    };
  }

  if (section === "right") {
    return {
      filters: parsed.rightFilters,
      addPreampDb(value) {
        parsed.rightPreampDb += value;
      },
    };
  }

  return {
    filters: parsed.filters,
    addPreampDb(value) {
      parsed.preampDb += value;
    },
  };
}

function parseChannelIdentifier(rawChannel, sourceName, lineNumber) {
  const identifiers = rawChannel.trim().split(/\s+/).filter(Boolean);
  let includesLeft = false;
  let includesRight = false;

  if (identifiers.length === 0) {
    throw new Error(`${sourceName}: unsupported channel identifier '${rawChannel}' on line ${lineNumber}`);
  }

  for (const identifier of identifiers) {
    const normalized = identifier.toLowerCase();

    if (normalized === "all") {
      includesLeft = true;
      includesRight = true;
      continue;
    }

    if (normalized === "l" || normalized === "1") {
      includesLeft = true;
      continue;
    }

    if (normalized === "r" || normalized === "2") {
      includesRight = true;
      continue;
    }

    throw new Error(`${sourceName}: unsupported channel identifier '${identifier}' on line ${lineNumber}`);
  }

  if (includesLeft && includesRight) {
    return "global";
  }

  if (includesLeft) {
    return "left";
  }

  if (includesRight) {
    return "right";
  }

  throw new Error(`${sourceName}: unsupported channel identifier '${rawChannel}' on line ${lineNumber}`);
}

/**
 * @param {string} text
 * @param {string} [sourceName="preset"]
 * @returns {ParsedEqualizerApo}
 */
export function parseEqualizerApo(text, sourceName = "preset") {
  const lines = text.split(/\r?\n/);
  const parsed = {
    preampDb: 0,
    filters: [],
    leftPreampDb: 0,
    leftFilters: [],
    rightPreampDb: 0,
    rightFilters: [],
  };
  let section = "global";

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const channelMatch = line.match(CHANNEL_RE);
    if (channelMatch) {
      section = parseChannelIdentifier(channelMatch[1], sourceName, index + 1);
      continue;
    }

    const currentSection = getSectionState(parsed, section);

    const preampMatch = line.match(PREAMP_RE);
    if (preampMatch) {
      currentSection.addPreampDb(Number(preampMatch[1]));
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

      currentSection.filters.push({
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

  return parsed;
}
