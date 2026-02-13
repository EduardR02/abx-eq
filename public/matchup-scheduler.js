import { fitBradleyTerry } from "./bradley-terry.js";

const RECENCY_PENALTIES = [0.1, 0.3, 0.6];

function pairKey(firstId, secondId) {
  return firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
}

function buildAllPairs(presetIds) {
  const pairs = [];
  for (let i = 0; i < presetIds.length; i += 1) {
    for (let j = i + 1; j < presetIds.length; j += 1) {
      pairs.push([presetIds[i], presetIds[j]]);
    }
  }
  return pairs;
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeScore(score) {
  if (score === 0 || score === 0.5 || score === 1) {
    return score;
  }
  return null;
}

function normalizeOutcome(outcome) {
  if (typeof outcome === "number") {
    return normalizeScore(outcome);
  }

  if (typeof outcome !== "string") {
    return null;
  }

  const key = outcome.trim().toLowerCase();
  if (key === "a") {
    return 1;
  }
  if (key === "b") {
    return 0;
  }
  if (key === "draw" || key === "tie" || key === "none") {
    return 0.5;
  }
  return null;
}

function normalizeMatch(match, presetSet) {
  if (!match || typeof match !== "object") {
    return null;
  }

  if (typeof match.winnerId === "string" && typeof match.loserId === "string") {
    if (match.winnerId === match.loserId) {
      return null;
    }
    if (!presetSet.has(match.winnerId) || !presetSet.has(match.loserId)) {
      return null;
    }
    return {
      presetA: match.winnerId,
      presetB: match.loserId,
      scoreA: 1,
    };
  }

  if (typeof match.presetA !== "string" || typeof match.presetB !== "string") {
    return null;
  }
  if (match.presetA === match.presetB) {
    return null;
  }
  if (!presetSet.has(match.presetA) || !presetSet.has(match.presetB)) {
    return null;
  }

  let scoreA = normalizeScore(match.scoreA);

  if (scoreA === null) {
    scoreA = normalizeOutcome(match.outcome);
  }

  if (scoreA === null) {
    scoreA = normalizeOutcome(match.choice);
  }

  if (scoreA === null && typeof match.winnerId === "string") {
    if (match.winnerId === match.presetA) {
      scoreA = 1;
    } else if (match.winnerId === match.presetB) {
      scoreA = 0;
    }
  }

  if (scoreA === null) {
    return null;
  }

  return {
    presetA: match.presetA,
    presetB: match.presetB,
    scoreA,
  };
}

function normalizeMatches(matches, presetSet) {
  if (!Array.isArray(matches)) {
    return [];
  }

  const normalized = [];
  for (const match of matches) {
    const parsed = normalizeMatch(match, presetSet);
    if (parsed) {
      normalized.push(parsed);
    }
  }

  return normalized;
}

function sanitizeStrength(value) {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return 1;
}

function recencyPenalty(targetPairKey, recentPairKeys) {
  const index = recentPairKeys.indexOf(targetPairKey);
  if (index < 0 || index >= RECENCY_PENALTIES.length) {
    return 1;
  }
  return RECENCY_PENALTIES[index];
}

function clampTotalMatchups(totalMatchups, pairCount) {
  if (!(pairCount > 0)) {
    return 0;
  }

  const rounded = Number.isFinite(totalMatchups) ? Math.round(totalMatchups) : pairCount;
  return Math.max(pairCount, rounded);
}

export class MatchupScheduler {
  constructor(presetIds, totalMatchups, {
    random = Math.random,
    fitOptions = { maxIterations: 70 },
  } = {}) {
    const uniquePresetIds = [];
    const seen = new Set();

    if (Array.isArray(presetIds)) {
      for (const presetId of presetIds) {
        if (typeof presetId !== "string" || seen.has(presetId)) {
          continue;
        }
        seen.add(presetId);
        uniquePresetIds.push(presetId);
      }
    }

    this.presetIds = uniquePresetIds;
    this.presetSet = new Set(this.presetIds);
    this.pairs = buildAllPairs(this.presetIds);
    this.totalMatchups = clampTotalMatchups(totalMatchups, this.pairs.length);
    this.discoveryCount = Math.min(this.pairs.length, this.totalMatchups);
    this.random = typeof random === "function" ? random : Math.random;
    this.fitOptions = fitOptions;
    this.discoveryPairs = shuffle(this.pairs, this.random);
    this._done = 0;
    this._btPresets = this.presetIds.map((id) => ({ id, name: id }));
  }

  get progress() {
    const phase = this._done >= this.totalMatchups
      ? "complete"
      : this._done < this.discoveryCount
        ? "discovery"
        : "refinement";

    return {
      done: this._done,
      total: this.totalMatchups,
      phase,
    };
  }

  get isComplete() {
    return this._done >= this.totalMatchups;
  }

  next(currentResults) {
    const normalizedResults = normalizeMatches(currentResults, this.presetSet);
    this._done = Math.min(normalizedResults.length, this.totalMatchups);

    if (this.isComplete) {
      return null;
    }

    if (this._done < this.discoveryCount) {
      const pair = this.discoveryPairs[this._done];
      return this.randomizeOrder(pair);
    }

    const pair = this.selectAdaptivePair(normalizedResults);
    if (!pair) {
      return null;
    }

    return this.randomizeOrder(pair);
  }

  randomizeOrder(pair) {
    if (!pair) {
      return null;
    }
    const [first, second] = pair;
    if (this.random() < 0.5) {
      return { presetA: first, presetB: second };
    }
    return { presetA: second, presetB: first };
  }

  selectAdaptivePair(results) {
    if (this.pairs.length === 0) {
      return null;
    }
    if (this.pairs.length === 1) {
      return this.pairs[0];
    }

    let strengths = new Map();
    try {
      strengths = fitBradleyTerry(this._btPresets, results, this.fitOptions);
    } catch {
      strengths = new Map();
    }

    const recentPairKeys = [];
    for (let index = results.length - 1; index >= 0 && recentPairKeys.length < 3; index -= 1) {
      const result = results[index];
      recentPairKeys.push(pairKey(result.presetA, result.presetB));
    }

    const tieEpsilon = 1e-12;
    let bestScore = -Infinity;
    let bestPairs = [];

    for (const pair of this.pairs) {
      const [first, second] = pair;
      const firstStrength = sanitizeStrength(strengths.get(first));
      const secondStrength = sanitizeStrength(strengths.get(second));
      const winProbability = firstStrength / (firstStrength + secondStrength);
      const informationScore = 0.5 - Math.abs(winProbability - 0.5);
      const score = informationScore * recencyPenalty(pairKey(first, second), recentPairKeys);

      if (score > bestScore + tieEpsilon) {
        bestScore = score;
        bestPairs = [pair];
      } else if (Math.abs(score - bestScore) <= tieEpsilon) {
        bestPairs.push(pair);
      }
    }

    if (bestPairs.length === 0) {
      return this.pairs[0];
    }

    const pick = Math.floor(this.random() * bestPairs.length);
    return bestPairs[pick];
  }
}
