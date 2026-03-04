import { fitBradleyTerry } from "./bradley-terry.js";

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

function clampTotalMatchups(totalMatchups, pairCount) {
  if (!(pairCount > 0)) {
    return 0;
  }

  const rounded = Number.isFinite(totalMatchups) ? Math.round(totalMatchups) : 1;
  return Math.max(1, rounded);
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
    this.random = typeof random === "function" ? random : Math.random;
    this.fitOptions = fitOptions;
    this._done = 0;
    this._btPresets = this.presetIds.map((id) => ({ id, name: id }));
  }

  get progress() {
    const phase = this._done >= this.totalMatchups ? "complete" : "adaptive";

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

    const appearanceCounts = new Map(this.presetIds.map((presetId) => [presetId, 0]));
    const pairCounts = new Map();
    for (const result of results) {
      appearanceCounts.set(result.presetA, (appearanceCounts.get(result.presetA) ?? 0) + 1);
      appearanceCounts.set(result.presetB, (appearanceCounts.get(result.presetB) ?? 0) + 1);

      const key = pairKey(result.presetA, result.presetB);
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }

    const N = this.presetIds.length;
    const T = this.totalMatchups;
    const r = results.length;
    const t = r / Math.max(1, T - 1);

    const maxCoverage = Math.floor((2 * T) / N);
    const rawCoverage = Math.floor(0.35 * ((2 * T) / N));
    const coverageFloor = Math.min(4, Math.max(1, rawCoverage));
    const F = Math.min(coverageFloor, maxCoverage);

    const deficits = new Map();
    let hasDeficit = false;
    for (const presetId of this.presetIds) {
      if (F <= 0) {
        deficits.set(presetId, 0);
        continue;
      }

      const seenCount = appearanceCounts.get(presetId) ?? 0;
      const deficit = Math.max(0, F - seenCount) / F;
      deficits.set(presetId, deficit);
      if (deficit > 0) {
        hasDeficit = true;
      }
    }

    const previousPairKey = results.length > 0
      ? pairKey(results[results.length - 1].presetA, results[results.length - 1].presetB)
      : null;

    let candidatePairs = this.pairs;
    if (hasDeficit) {
      const deficitPairs = [];
      for (const pair of this.pairs) {
        const [first, second] = pair;
        if ((deficits.get(first) ?? 0) > 0 || (deficits.get(second) ?? 0) > 0) {
          deficitPairs.push(pair);
        }
      }

      if (deficitPairs.length > 0) {
        const allRecentlyPlayed = previousPairKey !== null
          && deficitPairs.every((pair) => pairKey(pair[0], pair[1]) === previousPairKey);
        candidatePairs = allRecentlyPlayed ? this.pairs : deficitPairs;
      }
    }

    const uncertainties = new Map();
    const strengthsById = new Map();
    const contenderOptimism = new Map();

    let optimismMax = 1;
    for (const presetId of this.presetIds) {
      const m = appearanceCounts.get(presetId) ?? 0;
      const u = 1 / Math.sqrt(1 + m);
      const s = sanitizeStrength(strengths.get(presetId));
      const opt = s * Math.exp(0.9 * u);

      uncertainties.set(presetId, u);
      strengthsById.set(presetId, s);
      contenderOptimism.set(presetId, opt);
      if (opt > optimismMax) {
        optimismMax = opt;
      }
    }

    const contenderScores = new Map();
    for (const presetId of this.presetIds) {
      contenderScores.set(presetId, (contenderOptimism.get(presetId) ?? 0) / optimismMax);
    }

    const wTop = 0.65 + (0.25 * t);

    const tieEpsilon = 1e-12;
    let bestScore = -Infinity;
    let bestDeficit = -Infinity;
    let bestPairCount = Infinity;
    let bestPairs = [];

    for (const pair of candidatePairs) {
      const [first, second] = pair;
      const pairCount = pairCounts.get(pairKey(first, second)) ?? 0;

      const firstUncertainty = uncertainties.get(first) ?? 1;
      const secondUncertainty = uncertainties.get(second) ?? 1;

      const firstStrength = strengthsById.get(first) ?? 1;
      const secondStrength = strengthsById.get(second) ?? 1;
      const gamma = 1 / (1 + (1.5 * (firstUncertainty + secondUncertainty)));

      const adjustedFirst = Math.pow(firstStrength, gamma);
      const adjustedSecond = Math.pow(secondStrength, gamma);
      const winProbability = adjustedFirst / (adjustedFirst + adjustedSecond);
      const information = 4 * winProbability * (1 - winProbability);

      const topScore = Math.sqrt((contenderScores.get(first) ?? 0) * (contenderScores.get(second) ?? 0));
      const rankScore = (firstUncertainty + secondUncertainty) / 2;
      const relevance = (wTop * topScore) + ((1 - wTop) * rankScore);

      const novelty = 1 / Math.sqrt(1 + pairCount);
      const deficit = (deficits.get(first) ?? 0) + (deficits.get(second) ?? 0);
      const deficitBoost = 1 + (0.8 * deficit);

      const key = pairKey(first, second);
      const repeatPenalty = previousPairKey !== null && key === previousPairKey ? 0.35 : 1;

      const score = information * relevance * novelty * deficitBoost * repeatPenalty;

      if (score > bestScore + tieEpsilon) {
        bestScore = score;
        bestDeficit = deficit;
        bestPairCount = pairCount;
        bestPairs = [pair];
        continue;
      }

      if (Math.abs(score - bestScore) > tieEpsilon) {
        continue;
      }

      if (deficit > bestDeficit + tieEpsilon) {
        bestDeficit = deficit;
        bestPairCount = pairCount;
        bestPairs = [pair];
        continue;
      }

      if (Math.abs(deficit - bestDeficit) > tieEpsilon) {
        continue;
      }

      if (pairCount < bestPairCount) {
        bestPairCount = pairCount;
        bestPairs = [pair];
        continue;
      }

      if (pairCount === bestPairCount) {
        bestPairs.push(pair);
      }
    }

    if (bestPairs.length === 0) {
      return candidatePairs[0] ?? this.pairs[0] ?? null;
    }

    const pick = Math.floor(this.random() * bestPairs.length);
    return bestPairs[pick];
  }
}
